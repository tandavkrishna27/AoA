# M4 engineering execution

Started 2026-10-08 under the user's explicit goal to finish M4. This is a mutable
working ledger, not a milestone pass, release authorization or operational proof.

## Scope and constraints

- Reconcile WRK-016 replicated-fleet identity/storage and retirement/replacement.
- Reconcile HA correctness against D5-HA01..04 and quota/load behavior against
  D5-L01..06; preserve tenant boundaries, fencing and single execution ownership.
- Exercise the existing operator backup/restore path and recovered object
  reconciliation, quarantine and stale-fence denial against D5-DR01..07.
- Keep the full operational requirements visible. Local tests cannot establish
  production failover time, production load behavior or live staging RPO/RTO.
- The user's exclusion of extra certification campaigns persists. Paid calls,
  deployment, rollout and main merge are not authorized by this engineering goal.
- M3 remains unresolved for provider-wide egress, production application-session
  compatibility and associated live provider lifecycle proof. M4 engineering may
  advance independently; this does not waive the M3 milestone dependency.

## Initial authoritative observations

Baseline: program merge 06b47679f48943f0904c543dc3a33bf737dabf2f.

1. `docker-compose.staging.yml` is a dormant deployment-intent template, not a
   topology brought up by ordinary CI. Worker services declare `replicas: 2`,
   autoscaling labels 2..8, `mounted_secret` custody and the same enrollment-code
   path. They do not declare separate durable worker identity volumes.
2. `packages/db/src/repositories/tenant/worker-enrollment.ts` searches the binding
   by target, scope, organization and owner without excluding revoked workers.
   Independent replicas cannot safely pretend to be one enrolled worker.
3. `packages/worker-daemon/src/enrollment/enroll-once.ts` persists a complete
   identity before enrollment and adopts the winner of compare-and-set. Preserve
   these crash/replay invariants; sharing that record is not fleet isolation.
4. WRK-016 is still a scoping stub: per-replica identity and retirement policy
   need a concrete design against the current runtime. No locked choice between
   a stateful ordinal model and other fleet mechanisms was found in the reviewed
   decision sources. Do not silently reduce autoscaling to a singleton.
5. `cli/src/commands/db-restore.ts` already calls `runDatabaseRestore`, and
   `cli/src/__tests__/db-restore-input.test.ts` covers input resolution. DBR-001 and
   the REL-003 runbook still contain obsolete claims that the command is absent.
   Audit real invocation and restore coverage before proposing new machinery.

## Work sequence

1. Trace worker boot/custody, enrollment, state ownership, drain and target
   retirement. Specify the fleet design and its failure cases before code changes.
2. Trace the actual CLI backup/restore invocation and current PostgreSQL/object
   reconciliation tests; identify missing behavior from source and execution.
3. Implement confirmed gaps with failing regressions first, then focused checks.
4. Run recursive typecheck, full tests and build serially; use normal PR CI and
   integrate into `docs/replatform-program` after required checks pass.
5. Audit every M4 requirement against its actual evidence, recording operational
   prerequisites separately and never calling the full goal complete on fixtures.

## Verification status

Read-only reconciliation and branch isolation are complete for this initial
checkpoint. No product code changed and no tests, infrastructure, provider calls
or restore operations were run during this audit.

### Current-code baseline, 2026-10-08

The follow-up audit ran 92 existing focused tests, all passing without skips:

- 69 tests across worker enrollment/idempotency, custody, file-record persistence,
  CLI restore input and rollback completeness.
- 23 recovery tests across manifest reconciliation, staging rollout invariants,
  stale fences and re-enrollment/revocation. Windows PostgreSQL execution was
  explicitly enabled for the two integration files; those seven cases executed.

Important evidence limits and concrete next work:

- The stale-fence integration suite models restored state with older/absent lease
  rows. It exercises the real fence guard, but does not call backup or restore.
- The database package has a genuine JavaScript-format restore round-trip suite,
  but it skips Windows unconditionally and invokes the library directly. CLI
  restore-input tests do not exercise the actual operator command.
- The staging image default remains the inert daemon. The opt-in
  `worker-networked-host` composes `runContainerHost` and the networked per-run
  provider. Fleet design must bind identity, event outbox and lease-candidate
  state to the same exclusive worker slot and preserve opt-in dispatch.
- The current template's `AOA_WORKER_TARGET_PROFILE_ID` is not an identity source
  consumed by the daemon configuration. Enrollment obtains the target UUID from
  the ticket. A service name or environment label cannot replace a unique ticket
  and target binding.
- The native organization target revoke route exists. Reuse its authorization,
  generation and revocation machinery rather than deleting worker rows to enable
  transfer or resetting identity files.

The selected fleet direction is distinct target/ticket/durable state per worker
slot, bounded scale-out, drain and revoke on retirement, and restore of the old
identity or a new target on replacement. The user selected Option 1. An independent
sub-agent reviewed the written design; the three findings are corrected in
`m4-docker-worker-slots-design.md`: explicit remote execution placement, an
independently durable slot-binding protocol, and ownership of the remaining M4 HA
evidence reconciliation. The user approved the revised spec and implementation
plan, then requested native execution after review. Implementation is underway in
the isolated worktree; no deployment has been performed. Desktop-local execution
is a separate deliverable, not established by running the networked worker locally.

### HA baseline and runbook correction, 2026-10-08

Another 56 tests passed without skips across shared worker admission, organization
quota/capacity claims, realtime broker recovery and worker polling/outbox drain.
The three PostgreSQL integration files executed 15 cases with Windows integration
explicitly enabled. A further three composition-root tests passed for revocation
fanout wiring. Total focused baseline: 151 passing tests.

The existing D1 two-replica lane proves control-plane HTTP races using a harness
that acts as a worker, not multiple running worker daemons. The realtime lane
proves shared PostgreSQL append/read/notification behavior; it does not measure a
production load balancer's failover or the full D5 load/fairness floors. Preserve
these evidence limits when planning the broader HA tests.

Docker's Linux engine is available. Existing running containers belong to other
work; none were stopped, reconfigured or reused, and no M4 test stack was started.

The mutable DBR-001 design status and REL-003 operator runbook now acknowledge the
shipped restore command. The runbook consumes `aoa db:restore --file`, matches the
library's SQL/compressed-SQL format, and observes production revocation convergence
instead of claiming a missing scheduler and substituting manual ticks. Source,
focused wiring tests and citation integrity support these corrections; no live
rehearsal, recovery timing or finding closure is claimed.

### Worker-slot implementation, 2026-10-08

Fresh slots now have Linux kernel-backed exclusive ownership for both independent
binding storage and worker state, an explicit fresh/initializing/established binding
protocol, wrong-target identity refusal before persistence, and a persisted-receipt
barrier before session acquisition. Recovery databases must be distinct unaliased
regular files beneath the slot volume. Successful bootstrap retains ownership for
the full runtime, including drain/shutdown; ownership loss terminates execution.

The renderer emits distinct single-replica services, digest-pinned images, external
state volumes, separate binding mounts and individual file-backed ticket references.
The dormant staging template now has four distinct slots across its two failure
domains. Fleet growth adds independently provisioned slots within bounds; cloning
one identity by increasing its replicas is rejected. Dispatch remains disabled.

Independent review found two issues: interrupted enrollment could bypass binding
establishment through the legacy session retry, and hard-linked recovery files
could alias state across directory locks. Both were reproduced with failing
regressions and fixed. The rendered dispatch value was corrected to the strict
parser's `0`, also with a failing regression. No repeat review gate was added.

Current focused evidence: 26 daemon tests passing with one existing Windows skip;
90 policy/render/census tests passing without skips; two non-root, networkless Linux
image fixtures passing without skips, including the real worker entrypoint. The
image was built from this worktree. Host fixture bootstrap is injected; it proves
storage/composition, not a real cloud enrollment or desktop-local execution.

Recursive typecheck and build passed. The full ordinary suite passed: 24,306 tests
passed and 2,054 skipped (2,519 files passed, 227 skipped); optional integration
flags were unset. Validated legacy adoption remains unimplemented: current receipt/ticket
contracts have no authenticated organization metadata for it. Fresh guarded mode
refuses nonempty legacy state; existing unguarded embedders remain unchanged.
Operators can retire/revoke and provision a new target instead of resetting a
bound identity. Actual CLI restore and the remaining HA evidence audit still remain.

### Actual CLI recovery probe, 2026-10-08

A manual subprocess rehearsal used the current built `cli/dist/index.js` and a
new disposable Docker PostgreSQL 17 instance bound only to loopback. The CLI
failed before backup began: `ERR_MODULE_NOT_FOUND` for `zod`. The build externalizes
transitive dependencies of bundled workspace packages, but the CLI manifest does
not declare `zod`; this pnpm worktree has no CLI-visible installation of it.
Build success therefore does not establish a runnable packaged CLI. No restore
round trip or recovery timing is claimed. The owned disposable container was
stopped and removed; no existing database or container was reused or changed.

Next recovery work must first correct and regression-test the packaged CLI's
runtime dependency closure, then execute SQL/gzip and full-schema restored-fence
journeys. This defect is separate from the reviewed worker-slot change.

### Recovery fallback correction, 2026-10-08

PR #685 merged into `docs/replatform-program` at
`e1d9950e017a2210206fc3401db4285b409b8a20` after all required CI checks passed.

The packaging conclusion above was too broad: `scripts/build-npm.sh` generates a
publish manifest through `generate-npm-package-json.mjs`, which includes `zod`.
The raw development bundle probe did not exercise that packaged artifact. The
source operator command (`pnpm aoa`) starts successfully. No npm dependency change
is justified by that probe.

Actual CLI backup then exposed a recovery defect: without `pg_dump`, automatic
backup emits COPY blocks, while restore without `psql` treated COPY rows as SQL.
The new Docker CLI regression failed against the original code at the first data
row and passes with streamed PostgreSQL COPY handling. Five parser tests cover
text escapes, null markers, delimiter-like data, lazy row consumption, malformed
terminators and SQL function bodies. SQL and gzip round trips retain a two-company
fixture and the migration journal; missing files, corrupt gzip and truncated COPY
fail, with existing data preserved. The test forces both PostgreSQL tools absent
and is declared in PR CI. Each run owns and removes its disposable PostgreSQL
container; production and development databases are untouched.

Full-schema/security-object recovery, restored-fence execution and remaining HA
requirements still need stronger evidence. This fixture does not establish those
or production recovery timings. Final repository verification and independent
review of this correction are underway.

Independent review reproduced a driver-level hang when PostgreSQL rejected validly
framed COPY data. A new invalid-UUID CLI regression timed out before the fix and
passes with the existing postgres.js patch extended to retain the writable through
backend acknowledgement and complete pending finalization on errors. The DB
manifest pins the already-used patched 3.4.8 version; the lockfile was regenerated
in an isolated manifest-only workspace, and a frozen offline production install
applied the exact tested patch. Shared dependency directories were not modified.

A native full-schema engineering probe then found grants lost by `--no-privileges`:
203 tables, 286 migration entries, 37 policies, 26 FORCE-RLS tables, seven functions
and two company rows restored, but application table grants fell from 187 to zero.
A failing native-backup contract regression pinned this omission. After preserving
native grants, the same source/destination probe matched all those counts, including
187 grants. Current source was mounted into the existing combined Linux image;
this is not a release-image, live D5 or functional restored-fence proof.

Six focused unit cases and the actual CLI journey pass. The first full-suite rerun
hit a native Node out-of-memory error; the reduced-worker rerun also exposed the
expected exhaustive dynamic-SQL inventory change (one SQL execution site became
two explicit SQL/COPY sites). Its exact allowlist was reconciled, without wildcard
exceptions. Final verification remains underway. `m4-requirements-evidence.md`
records every D5 requirement and the remaining evidence/gaps.

The CLI now bundles the patched PostgreSQL driver: npm consumers do not inherit
workspace pnpm patches, so leaving it external would reintroduce the COPY hang.
A new config regression failed before this change and passes afterward; CLI build
passes. Current focused unit total is seven, plus the live Docker CLI journey.
The exact dynamic-SQL inventory regression also passes (one selected case; 19
filtered cases are not claimed executed by that focused command).

### Automatic fallback security guard (in progress)

The reduced-worker full run terminated with ENOSPC while writing Vitest state
(19,454 tests passed, one known inventory failure, seven infrastructure errors;
356 files failed). It is not a passing run. A subsequent recursive typecheck and
build passed, but the new fallback safeguard requires fresh complete verification.

Automatic backup now rejects the portable fallback when omitted security objects
are present. The regression first reproduced a misleading successful backup and
then passed with the guard. An independent review found missing column/schema/type
ACL detection; those catalogs are now included, with the ordinary public-schema
ACL exempted. Four native/fallback unit cases and five COPY-parser cases pass;
the CLI bundle case also passed in the initial focused run (ten total cases).

The actual CLI fixture now checks independent column, schema and type grant cases,
with a successful plain-schema backup before each injection. These added cases
have not run locally: Docker commands remain unresponsive, and the attempted
full-schema JavaScript probe timed out before obtaining a container ID. No Docker
restart, unrelated-container stop or speculative cleanup was performed. Complete
typecheck/tests/build verification is running again with two test workers.

### Stored-byte recovery verification (in progress)

Added `runStoredManifestReconciliation` to read the restored bytes rather than
trust checksum metadata. It applies the existing prefix/scope gate before any
storage access, incrementally computes SHA-256 and byte length, closes streams,
and aborts on read errors. The existing metadata-only verifier remains available
for its callers; the recovery runbook now names the byte-verifying entry point.

The new positive/missing/corrupt cases use real local-disk files. Additional cases
reject foreign scope before access, forged hash/size metadata, interrupted reads
and decoded string streams. The two initial cases failed against the unimplemented
entry point, then passed; the complete manifest suite now passes 17 cases (12
existing, five new). Independent review found no actionable issues. This proves
the byte-verification component, not recovered DB integration, durable quarantine,
serving denial or production D5 timing. Reads remain sequential and callers must
keep services/writers stopped; caller-level cancellation/deadlines remain a gap.

PR #686's first complete CI run passed every required consumer except the actual
CLI fixture, which raced Docker PostgreSQL's temporary socket-only init server.
Readiness now probes TCP, which only the final server exposes. The correction is
in both recovery branches. PR #686 passed required CI and merged into
`docs/replatform-program` as `f77437a43a72be7d368718b4253f432b85197acb`.
The local full run passed 24,318 tests (2,054 skipped) and build, but crossed source
changes and therefore does not verify the latest commit. A subsequent recursive
typecheck passed. PR #687 verification remains pending; its environment-variable
documentation failure has been corrected for the two test-only fixture inputs.

### Native restored-fence regression (implemented, not yet executed)

Added a selected case to the real fence integration scaffold and an owned Docker
PostgreSQL fixture (`tests/d1/m4-native-fence-restore.test.mjs`). It migrates the
current application schema, takes a native backup, mints and admits a real lease,
closes all pools, restores the earlier backup, then checks that the old lease is
absent and its fence is rejected. A freshly minted lease is admitted afterward.
Two further native round trips capture expired authority and a generation cutoff.
Each changes the live state back to admissible after backup, then restores the
captured refusal and checks the real guard. Omitting those restore calls cannot
pass the corresponding negative assertions.
The native tools execute inside that same pinned PostgreSQL container, avoiding
client/server version mismatch. The harness requires one passed selected case;
an all-skipped Vitest result fails. The four existing modelled cases remain.

Independent review found no actionable issues. Syntax, inventory (2,992 files),
execution census (124 mjs files; 121 declared running) and citation checks pass.
The new fixture is declared in PR CI shard one. It has not executed locally while
Docker remains unresponsive; no passing native-fence result is claimed. This case
still needs observed execution and does not prove object quarantine, the live
recovered fleet, or D5 RPO/RTO. Full verification remains pending.

A fourth native round trip backs up an active lease, revokes its target, restores
the older snapshot, then invokes the real enrollment generation authority before
checking rejection of the old fence. Independent review found no actionable
issues. This case is implemented but awaits native execution. Generic SQL restore
does not invalidate authority: the runbook now explicitly blocks worker ingress
and keeps workers stopped until object verification and authority recovery finish
for every restored target. Actual fleet re-enrollment with fresh identity and
enforcement of that isolation still require staging proof.

CI run `37773327517` executed the native selected case at `e24db38fc` successfully:
post-snapshot lease, expired snapshot lease and generation cutoff. The actual CLI
fallback step also passed. The overall run was superseded; this is step-specific
evidence, not a green latest-head claim. The fourth scenario awaits its own run.

### Durable recovered-artifact quarantine

Implemented a separate sticky recovery disposition on committed artifacts with
Drizzle-generated migration `0286_mixed_jigsaw`. Status and the committed unique
identity remain intact, so quarantine does not reopen upload or commit identity.
Tenant repositories bind the company through its job, lock the inspected row and
compare its object key/hash/size before quarantine. The recovery service validates
company ownership, loads the actual authoritative manifest and streams real bytes.
Quarantine and the company activity record commit together. Repairing bytes never
silently releases quarantine; retries do not duplicate its audit.

Download grants, commit replays, required staged inputs, patch apply/base selection,
distributed results, task-output content and service checkpoint reads reject the
recovery disposition. The operator UI surfaces it and removes its evidence link.
The offline operator entry point requires explicit organization/company scope and
`AOA_APP_DATABASE_URL`, asserts the connected bounded `aoa_app` role, uses existing
storage configuration, closes its pool and exits nonzero for failed reconciliation.
It does not isolate traffic or retract signed URLs; those remain runbook prerequisites.

Independent review found and corrected a staged-input bypass and empty successful
reports for missing/foreign companies; re-review found no remaining actionable
issues. Current focused unit/UI coverage passes 51 tests across four files.
With Windows real-PostgreSQL opt-in, the complete artifact transfer/commit,
patch-apply and job-submission suites pass 95 tests. The new corruption/deletion
cases use real files and the operator execution function against a non-owner DB
connection, reject an owner URL, prove sticky download/upload/commit denial and
one company audit. The patch regression refuses before any object read.
This is local DB/object integration, not an actual restored staging journey.
Latest corrected candidate verification is recorded below; this component
integration alone does not establish live M4 completion.

### Combined native database and file recovery regression

At `d0554f2b3`, recursive typecheck, the full reduced-worker suite (2,523
files / 24,334 tests passed; 227 files / 2,058 tests skipped), and production
build passed. This is candidate-specific local verification, not live D5 proof.
Independent review found no remaining actionable quarantine implementation issues.

The native recovery fixture now also selects both real-file quarantine cases.
Each snapshots the migrated database and object directory, deletes both manifest
rows and files, restores both snapshots, and requires successful bounded-role
reconciliation before injecting corruption or deletion. A healthy sibling read
and a successful governed commit replay establish that artifact-specific denial
is not masked by unavailable reads or stale worker authority. Review identified
that downloads alone cannot prove an active fence; the governed replay supplies
that positive control. The complete local artifact suite passes 39 tests, and the
two updated positive controls pass separately. Server typecheck passes.

Native execution of this combined extension passed CI at `d40998068`, reporting
exactly two executed DB/file recovery cases plus the four fence scenarios. Local Docker's
existing read-only process query remains unresponsive; no engine restart or
unrelated container cleanup was attempted. The existing four-scenario native
fence restore and CLI restore steps passed in CI at `b61e4e766`; that run's
unrelated logging failure was corrected separately. External object storage,
fleet reenrollment, signed-URL isolation and measured D5 recovery/HA/load remain
unproven.

PR #687 CI exposed a logging assertion failure reproduced locally: its placement
namespace loaded before the test configured its log capture. Moving that runtime
import after capture configuration passes the same assertion and the complete
42-case job submission suite; no logging/redaction assertion was removed.

### Corrected candidate verification and landing

PR #687 merged into `docs/replatform-program` at
`22fd322d9c6ae7e91058303f834c45b544dd6370` with all required CI green. Its native
CLI restore and four-scenario fence restore steps both passed at `068a74d23`.

PR #688's prior head exposed a real migration replay failure: generated migration
0286 tried to add an existing column after the readiness fixture removed the last
journal row. The unchanged opt-in integration suite reproduced it (1 failed,
3 passed). C14 `IF NOT EXISTS` guards on the generated column additions correct
the failure; the same suite then passes 4/4. No readiness assertion was removed.
The correction is pushed to #688 at `8706b989d` and #689 at `d40998068`.

At `d40998068`, recursive typecheck, full local tests (2,523 files / 24,334 tests
passed; 227 files / 2,058 tests skipped), and production build all pass. The
complete artifact integration suite separately passes 39 cases, including the
healthy governed replay control. Required CI and native combined execution are
green at `d40998068`, including native combined execution. PR #688 merged at
`493e016285c692b334893f8513be42487879d93e`; PR #689 merged at
`b0576a77213089e4a073562bdbc72d012bf568ca`. Live staging access/results are outstanding;
REL-003 reserves that substrate and spend to the operator. M4 remains open.

### Existing testing host inspection

The operator clarified that the September replatform server was deleted; only
the main testing server remains, and authorized inspecting it and preparing a
replatform deployment with recovery tests in a separate database. The existing
testing deployment workflow now has an explicit read-only inspection mode using
its existing GitHub-held SSH credentials. This mode skips the deployment job and
reports only image/release metadata, disk space, backup file metadata, PostgreSQL
version/migration count and HTTP status codes. It does not print runtime env or
health bodies, create backups, restore data, migrate, restart or prune services.
The normal deployment path still requires a tested main-history SHA; no branch
deployment bypass is introduced. Inspection results and a concrete deployment
path remain pending. One host cannot prove two-failure-domain HA.

### Local desktop execution — 2026-10-08

The user authorized moving local M4 execution forward while remote server access
is unavailable. Docker is now responsive. Started the current worktree app on
`http://127.0.0.1:3210` with `AOA_HOME=C:\Users\TK\.aoa-m4-local`,
`AOA_INSTANCE_ID=m4-local`, loopback `local_trusted`, and no `DATABASE_URL`.
This creates a separate embedded PostgreSQL instance and storage. Health and UI
returned HTTP 200; the company list was empty. This is a local app instance,
not proof of distributed worker enrollment or cloud control.

Actual CLI SQL/gzip recovery passed locally, including rollback on truncated or
invalid COPY, absent/corrupt backup refusal and security ACL fallback refusal.
The native full-schema fixture initially failed because Windows skipped the suite;
with `AOA_RUN_WIN_INTEGRATION=1` it exposed direct `.mjs` execution (`spawn EFTYPE`).
Configured `.mjs`/`.cjs` PostgreSQL tool wrappers now execute through the current
Node executable with separate arguments and no shell. Native binary behavior is
unchanged. Focused regression: RED two failures / four passes, then GREEN six passes.
Independent review found no actionable issue. The actual native restore then passed:
four stale-authority scenarios, two DB + file fault cases and the healthy sibling
control. The fixture owns disposable PostgreSQL containers and did not restore
into the running local application database.

Reproduce from the worktree in PowerShell:

```powershell
$env:AOA_RUN_WIN_INTEGRATION = '1'
node --test tests/d1/m4-cli-restore.test.mjs
node --test tests/d1/m4-native-fence-restore.test.mjs
```

Restart the isolated app in a separate terminal:

```powershell
$env:AOA_HOME = 'C:\Users\TK\.aoa-m4-local'
$env:AOA_INSTANCE_ID = 'm4-local'
$env:HOST = '127.0.0.1'
$env:PORT = '3210'
$env:AOA_DEPLOYMENT_MODE = 'local_trusted'
$env:AOA_MIGRATION_AUTO_APPLY = 'true'
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
pnpm.cmd dev:once
```

Recursive typecheck passed. Full tests passed: 2,523 files / 24,338 tests, with
227 files / 2,058 tests skipped. Production build passed after repairing the
worktree-only postgres dependency junction: its old temporary target was gone.
The replacement is isolated under C:\Users\TK\.codex\m4-local-runtime and uses
postgres 3.4.8 with the repository patch; shared dependencies were not edited.
Linux slot ownership/host fixtures passed 2/2 using the existing local worker
image (supporting regression evidence, not a rebuilt candidate fleet). Anthropic live verification remains
excluded. Single-desktop recovery is not two-failure-domain HA, external object
store recovery, fleet reenrollment, or full D5 load/RPO/RTO evidence. Those remain
open under the original M4 requirements.

### Local distributed worker execution — 2026-10-08

Built control-plane, worker and deterministic provider images from application
commit `480b30000` under `*:m4-local-480b30000` tags. Started the isolated Compose
project `aoa-m4-local-480b`, using D1 + spine topology and an ignored local override
that adds independent guarded binding storage to the actual networked worker.
All services became healthy. This stack has its own PostgreSQL, MinIO and test
keys; it is separate from the native onboarding app on port 3210. No model API
secrets, paid model calls, remote deployments or production image admission claims.

The live spine run first passed 9/10 cases: its topology observation alone ignored
the harness project/files/environment binding and failed to parse a render that
lacked the required local environment. Added a regression in the existing harness
binding suite (RED), switched topology observation to `composeBaseArgs()` while
preserving the historical default spine override, and reran GREEN 21/21 binding
checks. The actual full spine run then passed 10/10, zero skipped, in 43.2 seconds.
This includes execution by the deployed guarded worker, usage/cost/audit projection,
terminal events, cross-tenant refusal, disabled-tenant refusal and attributed drain.
Independent review found no actionable finding. This is real local worker execution
against the deterministic provider, not production E2B or desktop coding execution.

A second organization-scoped target and guarded slot were explicitly provisioned
with a distinct ticket, binding volume and state volume. Both slots became healthy,
with distinct worker and target IDs and established bindings. Restarted both and
compared identity hashes/IDs and binding state before/after: unchanged. A duplicate
Compose worker process sharing the first slot refused startup; a direct call to the
real ownership helper independently verified the held live lock. Refused startup
left both established identities unchanged. The second slot keeps dispatch off;
only the first slot's task execution is established by the spine run.

Local evidence (outside version control; no tickets/private keys in these reports):
- `C:\Users\TK\.codex\m4-local-evidence\spine\m1-spine-evidence.json`
- `C:\Users\TK\.codex\m4-local-evidence\slots.json`
- ignored configuration/keys under this worktree's `docker/d1/runtime-keys/`

The original native app remains healthy on port 3210; its empty onboarding DB is
not connected to these test workers. Full application typecheck/tests/build passed
at `480b30000` as recorded above. This follow-up changes the harness and docs only;
the binding suite and actual distributed journey were rerun after that harness fix.
Full D5 load/fairness, two-domain HA, external recovery objectives and live fleet
recovery/rollout remain open. One desktop cannot establish two independent failure
domains. These successful tests do not shrink the M4 requirements.

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

### 2026-10-08 — local load diagnostic exposes an open fairness failure

Added opt-in `scripts/m4-local-load.mjs` and
`docker/d1/m4-load.override.yml`. The driver requires a disposable
`aoa-m4-load-*` Compose project, seeds separate organizations, enrolls signed
fixture workers, schedules quiet arrivals at 2/s and noisy arrivals at 20/s,
and drives actual poll, lease ACK and terminal-event routes. It verifies durable
**attempt** terminals, not end-to-end job/task completion. A shared database
origin controls availability; request metrics include requests started in the
fixed window and their late responses, with drain starts counted separately.
The generator runs separately from both serving replicas.

Application candidate: `f7077a695`; diagnostic source remains a follow-up to
that candidate. Fresh owned project: `aoa-m4-load-f7077`. The previous worker
project/images/volumes were absent from the Docker engine at this session's
start; earlier successful slot restart evidence remains historical, not proof
that those identities still exist. The native onboarding app is separate.

Executed quota/admission/retry/rate-limit PostgreSQL regressions: **16/16 pass**.
Measurement/binding regressions: **25/25 pass**, including RED then GREEN for
the request-window regression. Independent review found no remaining issue in
the measurement fixes. Three 5-second live diagnostics **failed**; preserving
the first failure, corrected measurements, and separate-generator comparison.

Separate-generator result (one quiet org plus one noisy org):

| Measurement | Quiet baseline | Loaded |
|---|---:|---:|
| Quiet attempt terminals per second | 1.8 | 0.2 |
| Quiet queue-to-lease-ACK p95 | 510 ms | 2,609 ms |
| Poll p95 | 214 ms | 2,412 ms |
| Event ACK p95 | 197 ms | 1,923 ms |
| HTTP 5xx / request starts within window | 0 / 29 | 0 / 37 |

Quiet throughput ratio **0.111**, delay ratio **5.115**: below the 0.9
throughput floor and above the 2x delay ceiling. The driver
also recorded 11 stream-deadline failures; 41 accepted terminal uploads matched
41 durable succeeded attempts after draining, with zero unresolved active
attempts tracked by the driver. This does not establish completion of all
scheduled jobs. SQL snapshots during load
observed target/worker authority queries waiting on transaction/tuple locks;
the serving pool is configured with four connections. Lock contention and
pool queuing are a hypothesis, not a confirmed root cause or a reason to
increase pool size without testing. No production behavior was changed.

Next: profile connection wait versus transaction/authority-lock time, reproduce
with realistic worker poll/event concurrency and both serving replicas, then
add a failing regression for the confirmed cause before implementing a fix.
Retest the same arrival ratio and thresholds before increasing tenant count.

Evidence outside version control:
`C:\Users\TK\.codex\m4-local-evidence\load-smoke\report.json`,
`load-smoke-corrected\report.json`, and `load-separated\report.json` under
the same evidence directory, with corresponding sanitized raw measurements.
The diagnostic always reports `fullD5Satisfied: false`: SQL queue scheduling
does not measure submit latency, fixture workers do not execute providers,
and this run does not establish 20 organizations, 100 active leases,
10,000 events/minute, 60 minutes plus churn, HA or external recovery objectives.

Repeat against the existing disposable stack (PowerShell; use a fresh output
directory to preserve failures):

```powershell
$env:AOA_D1_LIVE='1'
$env:AOA_E6F_COMPOSE_PROJECT='aoa-m4-load-f7077'
$env:AOA_E6F_COMPOSE_ENV_FILE='docker/d1/runtime-keys/m4-load.env'
$env:AOA_E6F_COMPOSE_FILES='docker-compose.d1.yml;docker/d1/m4-load.override.yml'
$env:AOA_M4_LOAD_DURATION_MS='5000'
# Optional: AOA_M4_LOAD_OUTPUT; otherwise a fresh UUID directory under TEMP.
node scripts/m4-local-load.mjs
```

The overlay's `load-runner` must already be started with these same Compose
files, project and candidate-image env file. The driver never starts production
services or uses provider credentials. A nonzero exit preserves the report and
does not waive the failed thresholds.

Verification for this diagnostic follow-up: recursive typecheck passed; the
full Vitest invocation returned nonzero with 2,522 files / 24,337 tests passed,
227 files / 2,059 tests skipped and one suite setup timeout:
`cloud-plugin-process-composition.test.ts` exceeded its 30-second app-import
hook under full-suite load. Its isolated rerun passed all 7 tests in 8.66 s.
No timeout setting was increased. This records a passing rerun, not a fully
green full-suite invocation. Citation checks (397 enforced) and test inventory
(2,993 files across 22 trees) passed. Production build passed.

### 2026-10-09 — profiling and controlled concurrency comparisons

Continued diagnosis without changing production behavior. A read-only diagnostic
overlay timed repository calls and connection acquisition on the owned fixture
candidate; it logged method names, counts and elapsed time only. Direct and
proxied PostgreSQL `SELECT 1` p95 were 0.31 and 0.51 ms. During the profiled run,
authority locking averaged 209 ms (max 849 ms), accepted-event processing
131 ms (max 423 ms), and transaction acquisition 82 ms (max 914 ms). These
aggregates include background transactions and are diagnostic observations,
not request-level causal attribution. The profiled load still failed.

Added bounded `AOA_M4_LOAD_NOISY_STREAMS` (1–10, default 10) so concurrency is
explicit and can be varied independently of the unchanged 20/s versus 2/s
scheduled arrival ratio. Invalid values failed the new assertion before the
implementation, then the 25-test harness suite passed. The shipped worker's
poll loop awaits each poll; ten overlapping poll loops for one identity are
therefore an adversarial case, not a faithful model of its normal poll loop.
The diagnostic still waits for terminal upload before its next poll, whereas
the daemon hands execution to its supervisor; neither diagnostic variant
establishes real-daemon throughput.

| Experiment, 5-second window | Quiet throughput / baseline | Quiet delay / baseline | Poll / event ACK p95 | Result |
|---|---:|---:|---:|---|
| One noisy stream, original candidate/pool | 0.625 | 2.454x | 384 / 348 ms | FAIL |
| Ten noisy streams, fixture pool 4→16 only | 0.111 | 2.448x | 2,464 / 2,190 ms | FAIL |

The pool-size experiment produced 8 HTTP 5xx out of 37 request starts inside
the measurement window. Increasing pool size alone did not fix the finding
and is not being proposed as a production change. Both ignored temporary
overlays were removed from the running service configuration afterward;
the control plane was recreated from the original candidate and became healthy.
No existing application data or unrelated Docker projects were changed.

Sanitized evidence directories under `C:\Users\TK\.codex\m4-local-evidence`:
`load-profile-methods-final` (including `method-timings.json`),
`load-single-stream`, and `load-pool16`. Partial setup attempts are not counted
as completed load runs. Full D5 remains open. Next investigation must separate
whole transaction duration, time holding target/worker locks and request
admission time, then reproduce using actual daemon polling/execution semantics.
The earlier typecheck/build/full-suite results apply to the parent diagnostic
slice; this follow-up reran the 25-test Node harness and live experiments,
not another repository-wide typecheck/test/build invocation.

### 2026-10-09 — confirmed readiness overhead and product correction

Detailed profiling separated service/transaction time from middleware time.
With one noisy stream, poll service averaged 33 ms and lease ACK 31 ms;
the readiness gate before every API request averaged about 163 ms at baseline
and 268–278 ms under load. It repeatedly read and hashed image migration files
and opened short-lived PostgreSQL pools for schema inspection and ping. Thus
the earlier lock/pool observations did not identify the whole root cause.

Changed distributed readiness to retain the immutable image identity once and
read live `drizzle.__drizzle_migrations` hashes, in ID order, through the
existing owner pool on **every request**. The canonical ledger is already
required by distributed startup. The PostgreSQL ping also reuses that pool.
There is no cached successful readiness verdict or skipped database check.
Legacy flag-off schema loading is unchanged. No schema, permissions or API
response contract changed.

RED: two new reader tests failed before implementation. GREEN: 17 focused
readiness/gate tests, plus 5 actual Windows PostgreSQL tests, including a
previously compatible ledger becoming divergent/newer and recovering after
repair. Independent review found no actionable findings.

Executed the compiled server correction as two read-only file mounts over
the existing `f7077a695` fixture image, with all profiling/pool experiments
removed. This is a tested source correction, not a newly built release image.
Evidence includes source/compiled SHA-256 values in each `candidate.json`.
Both comparisons retained 2/s quiet versus 20/s noisy scheduled arrivals and
the original thresholds:

| Five-second comparison | Quiet throughput / baseline | Quiet delay / baseline | Loaded poll / event ACK p95 | Result |
|---|---:|---:|---:|---|
| Ten overlapping noisy poll loops | 0.900 | 3.382x | 316 / 274 ms | FAIL: delay |
| One noisy poll loop | 1.000 | 0.863x | 42 / 55 ms | PASS: bounded diagnostic |

Both runs observed zero HTTP 5xx/transport errors. The ten-loop case improves
substantially over 0.111 throughput and 2,412/1,923 ms poll/event p95, but its
queue-delay failure remains open. The single-loop PASS must not replace or
erase that adversarial failure. Neither simulates actual provider execution;
the generator still waits for terminal upload before polling again. Full D5,
the 20-org/duration/workload floors, both-replica load distribution, actual
daemon execution and independent failure domains remain unproven.

Evidence under `C:\Users\TK\.codex\m4-local-evidence`:
`load-profile-transactions`, `load-profile-middleware`,
`load-profile-readiness`, `load-readiness-fix`, and
`load-readiness-fix-single`. Reports and raw measurements preserve failures.
Repository-wide typecheck passed. The full Vitest invocation passed all
2,523 executed files / 24,340 tests, with 227 files / 2,059 tests skipped.
Production build passed. The final native PostgreSQL regression rerun passed all five tests, including live ledger changes and migration recovery. Independent review found no actionable issues in this correction.

### Startup regression and longer contention probe

CI at `c56fdb654` failed the native startup test
`performs zero migration-loader, E3 environment, or serving-pool work in real flag-off bootstrap`:
the new readiness construction loaded the image identity a second time. The
correction shares the single startup-loaded identity with the readiness reader;
flag-off still does not invoke that loader. The exact previously failing test
passed locally with native PostgreSQL (one selected test; 76 unrelated tests
skipped by the selection). This does not describe the latest CI as green.

A separate 15-second, ten-loop run at `c56fdb654` reproduced the outstanding
queue-delay failure: quiet throughput was 1.000 of baseline, queue-to-ACK p95
was 365.49 ms versus 74.27 ms baseline (4.921x), and loaded poll/event ACK p95
were 303.94/255.24 ms. It observed no HTTP 5xx or transport errors. The measured
peak was eight active leases; this remains far below full D5's floor.

Temporary transaction/repository profiling recorded mean pool-begin waits of
49.6/51.0/51.5 ms for poll/ACK/admission operations and mean worker-authority
lock calls of 32.9/35.1 ms for poll/ACK. These aggregate timing windows include
setup and background work; they identify contention for further investigation,
not a clean per-tenant causal attribution. Timing instrumentation was removed
from the running control plane afterward. Evidence is preserved in
`C:\Users\TK\.codex\m4-local-evidence\load-readiness-profile-15s`.

The current adversarial generator runs ten poll loops against the same noisy
worker. The production daemon awaits each poll and ACK, then hands execution to
its supervisor without waiting for the terminal event (`poll-loop.ts`,
`trackHandoff` and the main `pollOnce` loop). Therefore neither the ten-loop nor
the one-loop generator is a substitute for a real daemon workload. Preserve
this failure while adding actual-daemon evidence; do not weaken authority locks
or raise fairness thresholds to make the synthetic case pass.

Correction verification: repository typecheck passed; the full suite passed
2,523 files / 24,340 tests, with 227 files / 2,059 tests skipped. The targeted
native PostgreSQL startup regression passed. Production build passed.

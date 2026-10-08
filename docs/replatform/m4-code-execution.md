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

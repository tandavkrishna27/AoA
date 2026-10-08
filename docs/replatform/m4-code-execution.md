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

The proposed fleet direction is distinct target/ticket/durable state per worker
slot, bounded scale-out, drain and revoke on retirement, and restore of the old
identity or a new target on replacement. Architectural design approval is
pending; no implementation or deployment topology change has started.

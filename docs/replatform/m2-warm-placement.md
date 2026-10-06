# M2 warm placement and worker affinity

The trusted Commander warm runner requires explicit enablement and protected
provider/tool handles. Placement requires a verified snapshot provider with
checkpoint/restore support and thirty minutes of idle capacity. The runtime
demand includes the execution window plus that retention window.

The existing placement transaction claims private conversation ownership after
the source handoff and both handle writes. Any refusal rolls the transaction
back. Replay keeps the same reservation and audit. An existing reservation pins
its target and generation; conflicting target requests refuse before placement
or handle commits. Enablement is checked again immediately before reservation.

Eligible-worker selection filters private resumed ownership before taking the
bounded global head. A retained resource stays on its original worker. A first
claim has no worker yet, and retired or quarantined reservations deny all workers.
The existing static rejection predicate remains unchanged.

The PostgreSQL placement/leasing/property group passed 105 tests without skips.
It covers atomic first claims and replay, stale-source rollback, conflicting
target rollback, worker affinity, quarantined ownership and ordinary jobs. The
twenty existing leasing contract tests and server/database typechecks passed.
Recursive typecheck and build passed. The full suite passed 23,862 tests across
2,468 files, with 1,919 tests skipped by existing environment guards. The
PostgreSQL group is also rerun against the freshly built database package.
Rollout and paid provider calls remain off.

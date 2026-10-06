# M2 Commander warm consumer and rollback ownership

The Commander consumer selects the warm runner only when distributed execution
and the explicit warm flag are enabled and conversation warming is requested.
Existing paid turns are rejoined before budget, rollout or new placement checks.
Replay chooses the expected runner from the persisted job, rather than today's
flag, and still verifies the exact committed staged input hashes.

A retained distributed reservation remains an owner while claimed, paused,
quarantined or retired. A scoped database check prevents legacy acquisition and
spawning even when the distributed port is missing or declines a turn. Only the
authenticated resource-cleanup path clears ownership after capability expiry.
An existing legacy warm lease stays with its legacy executor until cleanup
succeeds. Missing provider IDs on paused leases and pending/failed cleanup do
not establish physical absence.

Once an armed Commander dispatch reaches placement, refusal surfaces an error
instead of selecting another executor. This preserves credential ownership and
refuses unsupported personal/device placement without copying an auth home or
substituting a company provider key. Rollout-off behavior remains available.

Focused tests cover explicit warm selection, rollback, paid-turn rejoin, legacy
ownership, cloud and self-hosted suppression, ordinary behavior, and real
PostgreSQL staged-input replay and cleanup status. The focused CLI/consumer group
passed 110 tests; the PostgreSQL placement/replay group passed all 39 tests with
Windows integration explicitly enabled against the built database package.
Recursive typecheck and build passed. The full suite passed 23,926 tests across
2,473 files, with 1,918 tests skipped by existing environment guards. Its first
attempt caught duplicate provider error classes loaded through local worktree
junctions; those links were corrected and the full suite passed on rerun.
Citation integrity, test inventory and whitespace checks passed.
Rollout and paid provider calls remain off.

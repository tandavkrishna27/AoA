# M2 accepted warm checkpoint recovery

Worker terminal ingestion projects warm state only after its event transaction
commits. Projection reads the accepted checkpoint and a later successful terminal
under the exact job, attempt, lease and fence. It preserves original physical VM
labels separately from the latest checkpoint owner. Checkpoint-only evidence
cannot retain a VM. Revoked membership quarantines it. Idle expiry comes from the
accepted server timestamp and cannot be extended by replay.

The existing convergence timer recovers claimed warm state, including completed
Commander turns. Reads and lock waits are bounded; paging shares concurrent ticks
and contains per-turn errors. Projection failure cannot suppress other terminal
consumers. These operations do not dispatch providers or alter accepted events.

Retention may project before database lease retirement because the accepted
terminal closes the online fence. Resume and credential issuance still require
the retired lease and the previous capability deadline. The non-effect projection
option does not relax those checks.

The focused recovery, authority, issuer and placement group passed 71 tests with
`AOA_RUN_WIN_INTEGRATION=1`, without skips. Real PostgreSQL assertions cover
completed-turn recovery, checkpoint-only refusal, exact third-generation labels,
replay, strict resume refusal before lease retirement, and revoked membership.
Recursive typecheck, citation integrity and production build passed. The full
suite passed 23,861 tests with 1,917 skipped across 2,468 passing files. Rollout flags and paid provider calls remain off.

Exact-resource retention and authenticated cleanup confirmation, placement and
affinity, consumer routing and personal/device execution remain incomplete.

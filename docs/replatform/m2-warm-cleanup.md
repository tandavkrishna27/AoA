# M2 durable warm cleanup

Adapter Manager registers each warm VM by exact resource ID and original physical
labels before returning create. Warm create requires actual checkpoint/restore
support, protected cleanup storage and an enabled warm guard. Signed ownership
inspection precedes effects; the guard is checked again immediately before warm
execute, checkpoint and restore. Destroy remains available during rollback.

Worker destroy and fleet reaping plan cleanup durably before provider effects and
persist successful provider receipts before control-plane acknowledgement. Restart
recovery retries planned cleanup only after fresh positive orphan truth. Confirmed
receipts retry acknowledgement without repeating physical cleanup, including when
the VM no longer appears in fleet listing. Failed acknowledgement retains the
receipt. Immutable stage files use write/fsync/link publication and exact identity
checks. Bounded sweeps rotate past blocked records.

The optional resource-truth wrapper protects one warm VM rather than every sibling
on its physical lease. Wrong labels, duplicate verdicts, older peers and outages
remain unknown. The frozen lease-truth contract and default ephemeral behavior
are preserved. The existing reaper timer runs cleanup recovery; no timer is added.

Warm boot defaults off and requires the authenticated reaper, configured durable
ledger and explicit pause support. Protected metadata remains separate from worker
credentials. A signalled warm command cannot checkpoint or retain a VM merely
because its exit code is zero.

The Adapter Manager and warm-supervisor group passed 280 tests across 27 files.
Recursive typecheck, citation integrity and production build passed. The full
suite passed 23,877 tests with 1,916 skipped across 2,469 passing files.
Rollout and paid provider calls remain off. The control-plane resource endpoints
are developed separately; placement, worker affinity, consumer routing, personal
and device execution and final integration remain incomplete.

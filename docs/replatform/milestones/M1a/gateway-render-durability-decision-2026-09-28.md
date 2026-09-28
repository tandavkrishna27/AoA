# M1a Render Journal Durability Decision (Draft)

Status: proposed amendment to the approved render projection spec and plan. This document does not yet authorize implementation of the amended Task 4 persistence protocol, installation, a campaign, or certification. Existing authorization for other offline source work is unchanged.

## Conflict found in Task 4

The approved spec says that a crash before durable terminal acknowledgement recovers `outcome-unknown`, while a crash after acknowledgement replays exact terminal metadata. If acknowledgement means the caller received a successful reply, no local POSIX journal can distinguish the two histories after a crash. A terminal rename may be visible after a failed directory `fsync`; a successful `fsync` may be followed by a lost reply. Both leave the same files on recovery. Re-syncing a visible terminal on recovery can make it durable, but cannot prove which history occurred.

The existing execution-v1 journal is not changed. A render-v2 record validator is committed, but no render persistence or socket route is approved or active. A prototype that replayed a visible terminal after recovery-side re-sync was rejected in independent review and removed before commit.

## Recommended contract

Define recovery by **validated journal state**, not delivery of the response. A render operation enters `dispatching` durably before Compose starts. Its private terminal metadata is written and file-synced before any marker is created. A closed commit marker binds the exact terminal record hash, schema/mode, session, operation ID, request hash, protected profile hash and input identity. Recovery validates both complete closed records and syncs the terminal file and containing directory before returning a verdict. Only a terminal with a valid matching marker can replay. An operation durably in `dispatching` with an **absent** marker recovers `outcome-unknown` and is never re-run under that identity. A **present but invalid** marker refuses closed without a verdict or redispatch. An `accepted` operation that never entered Compose remains `accepted`. Send a terminal response only after the marker's directory sync succeeds. If that response is lost, the validated terminal may replay with `renderAvailable: false`.

A failed marker sync may leave a marker visible. Recovery **adopts** a valid surviving marker after validation and re-sync, even if the writer saw an error. This does not prove pre-crash durability or receipt of a reply; both histories can leave identical files. An absent, malformed, mismatched or unverifiable marker never promotes a terminal; a present invalid marker refuses rather than being treated as absent. No raw render, resolved env, stderr or validator prose may enter either file. The v2 root remains disjoint from execution-v1, and the old records are byte-identical.

## Verification required before implementation is accepted

- Fault-inject terminal payload write, payload file sync, marker creation and marker directory sync. A durably dispatching operation with an absent marker recovers unknown; a present invalid marker refuses; a valid surviving marker is adopted and replays exact metadata without Compose redispatch. A sync error alone does not determine which recovery outcome applies.
- Fault-inject a lost reply after commit. Replay returns the committed digest and stable codes with `renderAvailable: false`, never raw bytes or a fresh-render assertion.
- Corrupt or remove either half of the committed pair, change the protected profile/input identity, and introduce an execution-v1 record into the render root; each must refuse without promoting an outcome.
- Run actual Linux ownership, lock, file-sync and directory-sync tests in ordinary PR CI. Windows platform skips are not Linux proof.

## Owner decision

TK, as accountable Integration/Security owner, must approve or reject this validated-marker recovery interpretation before source implementation is treated as satisfying Task 4. Independent review must then amend the spec and plan wording together. No change to the production hold, exact protected profile decisions, raw evidence custody, or M1a gate follows from this decision alone.

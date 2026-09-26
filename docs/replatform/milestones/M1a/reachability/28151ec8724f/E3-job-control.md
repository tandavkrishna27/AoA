# E3 job-control reachability ledger

**Candidate:** `28151ec8724fc94d3774845d9d23cac5411a489a`
**Baseline ledger:** `../E3-job-control.md` at `7be35ae6b7719877e61f54ab552de84de8491e7d`

| Mechanism group | Candidate source reachability | Fresh evidence allocation |
|---|---|---|
| Submit, lease, ACK, renew/fence, event outbox | Reachable from mounted job/worker routes behind distributed execution. Current caller census retains the baseline production callers; job-admission changes preserve tenant-bound submission. | Cross-tenant submit/lease/event denial: `M1-D1-SPINE` only. Normal mechanism journey: both. |
| Cancellation | `dispatchCancel` remains production-reachable from heartbeat/issues paths. | Leased and unleased cancellation: both; no `7be` campaign result carries forward. |
| Output, artifact, activity, usage/cost projection | Reachable through accepted-event and worker export wiring. Candidate adds output-root/refusal and redaction enforcement without bypassing Organization attribution. | Output/artifact and tenant-suppression cases: `M1a-D2-MECHANISM`; hostile cross-tenant reads/visibility: `M1-D1-SPINE` where allocated by the frozen matrix. |
| Operator drain/rollback | `createDistributedExecutionDrain` has one production caller and remains an operator path. | Rollback rehearsal: `M1-D1-SPINE` only. |

Dormant register entries remain dormant; this ledger does not promote `createFenceAwareEgressProxy`,
`createPatchApplyService`, `createResultCommitter`, or `jobApprovalBridge`. Fresh retained artifacts
must prove every allocated case before any E3 claim is used by the M1a handoff.

# E3 job-control reachability ledger

**Candidate:** `28151ec8724fc94d3774845d9d23cac5411a489a`
**Baseline ledger:** `../E3-job-control.md` at `7be35ae6b7719877e61f54ab552de84de8491e7d`

| Mechanism group | Candidate source reachability | Fresh evidence allocation |
|---|---|---|
| Submit, lease, ACK, renew/fence, event outbox | Reachable from mounted job/worker routes behind distributed execution. Current caller census retains the baseline production callers; job-admission changes preserve tenant-bound submission. | Per-tenant journeys: `d1.tenant.journey.A/.B` on the D1 reference-provider profile and `d2m.tenant.journey.A/.B` on the real-provider mechanism profile. Cross-tenant lease and event denials are required separately as `d1.tenant.cross.lease/.events` and `d2m.tenant.cross.lease/.events`; neither profile certifies the other. |
| Cancellation | `dispatchCancel` remains production-reachable from heartbeat/issues paths. | D1 owes required `d1.cancel.leased_attempt` and `d1.cancel.unleased_attempt`; the mechanism profile separately carries pending `d2m.cancellation.leased_attempt`. No `7be` campaign result carries forward. |
| Output, artifact, activity, usage/cost projection | Reachable through accepted-event and worker export wiring. Candidate adds output-root/refusal and redaction enforcement without bypassing Organization attribution. | Cross-tenant read/output/cost and legacy-table cases are required under both prefixes (`d1.tenant.*` and `d2m.tenant.*`) where each appears in the frozen matrix. Candidate output/refusal checks in the mechanism lane do not replace D1's cases. |
| Operator drain/rollback | `createDistributedExecutionDrain` has one production caller and remains an operator path. | Rollback rehearsal: `M1-D1-SPINE` only. |

Dormant register entries remain dormant; this ledger does not promote `createFenceAwareEgressProxy`,
`createPatchApplyService`, `createResultCommitter`, or `jobApprovalBridge`. Fresh retained artifacts
must prove every allocated case before any E3 claim is used by the M1a handoff.

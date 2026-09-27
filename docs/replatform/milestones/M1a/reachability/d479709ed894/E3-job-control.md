# E3 job-control reachability ledger

**Candidate:** `d479709ed8940fe69ef28539daadb90b9b29310b`
**Prior candidate ledger:** `../28151ec8724f/E3-job-control.md`

PR #628 changes no E3 production source. Submit, lease, ACK, renew/fence, event, cancellation,
output, activity, usage/cost, and operator-drain reachability therefore remain as measured in the
prior ledger, but none of its campaign result is inherited.

| Mechanism | Fresh exact-candidate allocation |
|---|---|
| Submit/lease/event | Per-tenant journeys and cross-tenant lease/event denials must run separately under the `d1.*` and `d2m.*` IDs listed in the candidate README. |
| Cancellation | D1 requires `d1.cancel.leased_attempt` and `d1.cancel.unleased_attempt`; mechanism cancellation remains pending as `d2m.cancellation.leased_attempt`. |
| Output/read/cost/legacy projections | Every required cross-tenant and legacy-table case under both profile prefixes must be freshly observed. |
| Operator drain | The rollback rehearsal belongs to `M1-D1-SPINE` and must be rerun on this candidate. |

Dormant clauses remain dormant. Source reachability is not a pass for tenancy, authority, or
rollback behavior.

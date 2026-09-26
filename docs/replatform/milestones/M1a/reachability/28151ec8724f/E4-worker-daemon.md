# E4 worker-daemon reachability ledger

**Candidate:** `28151ec8724fc94d3774845d9d23cac5411a489a`
**Baseline ledger:** `../E4-worker-daemon.md` at `7be35ae6b7719877e61f54ab552de84de8491e7d`

| Mechanism group | Candidate source reachability | Fresh evidence allocation |
|---|---|---|
| Poll, supervisor, sandbox execution | `createPollLoop` and `createSupervisor` each retain two production callers and are composed by the daemon boot path. | D1 owes its worker-driven reference journey through the gated fake provider on `fake-provider:8082` (`d1.tenant.journey.A/.B`). Only `M1a-D2-MECHANISM` owes the worker-driven real-E2B journey (`d2m.tenant.journey.A/.B`). Cross-tenant lease/offer denial is required separately as `d1.tenant.cross.lease` and `d2m.tenant.cross.lease`. |
| Startup reconciliation | `createStartupReconciler` retains one production caller before polling. Source reachability does not prove a live lease survived restart. | Live-lease restart/reconcile injection: `M1-D1-SPINE` only. Empty-store red control is required. |
| Usage observation | Production wiring remains present and Organization-attributed. | The mechanism journey owes its real-provider usage/cardinality observations. Cross-tenant cost visibility remains separately required as `d1.tenant.cross.cost_rows` and `d2m.tenant.cross.cost_rows`; neither can be inferred from usage production alone. |
| Output and artifact export | Candidate adds run-output probing, export secret scanning, output-root confinement, and redacting log destination wiring. These are production-reachable from the worker lifecycle/export sequencer. | Output/refusal/redaction cases: `M1a-D2-MECHANISM`; no prior output bundle is adopted. |
| Cleanup | Sandbox teardown and adapter-manager orphan reclamation remain separate paths. | Destroy-on-success/failure/cancel and orphan sweep require fresh injected cases; source presence is not certification. |

The container-path narrowing remains: worker-side sandbox teardown is not substituted for the
adapter-manager reaper. The candidate's new protections strengthen the path but materially change
what must be observed, so the `7be` campaign verdicts cannot certify this ledger.

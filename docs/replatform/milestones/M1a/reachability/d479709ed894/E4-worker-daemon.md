# E4 worker-daemon reachability ledger

**Candidate:** `d479709ed8940fe69ef28539daadb90b9b29310b`
**Prior candidate ledger:** `../28151ec8724f/E4-worker-daemon.md`

PR #628 changes no worker-daemon production source. Poll, supervisor, startup reconciliation,
usage observation, output/export, and cleanup remain source-reachable exactly as previously
measured. The workflow now provisions the host-side AST compiler before topology evaluation; that
is harness readiness, not worker-runtime evidence.

| Mechanism | Fresh exact-candidate allocation |
|---|---|
| Worker journeys | D1 must use the separately deployed worker and gated fake provider; mechanism must use real E2B. Each owes its own tenant journeys and lease denial. |
| Restart/reconciliation | D1 retains the live-lease restart/reconcile obligation and empty-store red control; declared pending status is not certification. |
| Usage/output/redaction | Profile-specific usage, output, refusal, redaction, and cross-tenant cost cases require fresh artifacts. |
| Cleanup | Required orphan/terminal cleanup cases and all pending mechanism destroy paths retain their matrix status. |

No image, runtime observation, or worker verdict from `28151ec...` carries forward.

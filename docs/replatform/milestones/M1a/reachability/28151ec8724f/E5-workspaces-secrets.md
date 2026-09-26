# E5 workspaces and secrets reachability ledger

**Candidate:** `28151ec8724fc94d3774845d9d23cac5411a489a`
**Baseline ledger:** `../E5-workspaces-secrets.md` at `7be35ae6b7719877e61f54ab552de84de8491e7d`

| Mechanism group | Candidate source reachability | Fresh evidence allocation |
|---|---|---|
| Staged inputs and grants | `stageJobInputFiles` retains two production callers; `createStagedInputResolver` and `recordObjectAccessGrant` retain one each. | Tenant-scoped staging and hostile access: both according to the frozen matrix. |
| Run secrets and environment absence | `synthesiseRunSecrets` retains one production caller. Candidate redaction and output probes do not replace the planted env-absence controls. | Secret/env absence plus positive controls: both; exact candidate observations required. |
| Artifact/output export | Worker and provider export paths are reachable and now enforce output-root and secret-scan refusal boundaries. | Seven-clause E5 matrix and export refusal cases: `M1a-D2-MECHANISM`; cross-tenant visibility as allocated to `M1-D1-SPINE`. |
| Audit, cost, and tool surface | Audit/cost projectors remain reachable. The tool surface remains disarmed for M1a and is not promoted by this review. | Fresh attribution/cardinality evidence required. Deferred tool-call case needs the existing reviewed disposition, not an unauthorized runner. |
| Object cleanup | Object-store cleanup/reclamation mechanisms remain present. | Orphan/object cleanup injections: `M1-D1-SPINE` only where named by the matrix. |

This ledger is the source/reachability half of M1a entry. It does not satisfy any clause of the
frozen seven-clause audit matrix. A successor E5 audit must cite fresh immutable campaign records
for this exact candidate and be certified by a different eligible session.

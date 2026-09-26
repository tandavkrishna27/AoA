# E5 workspaces and secrets reachability ledger

**Candidate:** `28151ec8724fc94d3774845d9d23cac5411a489a`
**Baseline ledger:** `../E5-workspaces-secrets.md` at `7be35ae6b7719877e61f54ab552de84de8491e7d`

| Mechanism group | Candidate source reachability | Fresh evidence allocation |
|---|---|---|
| Staged inputs and grants | `stageJobInputFiles` retains two production callers; `createStagedInputResolver` and `recordObjectAccessGrant` retain one each. | Hostile staged-input access is required separately as `d1.tenant.cross.staged_inputs` and `d2m.tenant.cross.staged_inputs`. |
| Run secrets and environment absence | `synthesiseRunSecrets` retains one production caller. Candidate redaction and output probes do not replace the planted env-absence controls. | Each profile owes its own exact-candidate secret/env observations and positive controls. Cross-tenant secret denial is separately required as `d1.tenant.cross.secrets` and `d2m.tenant.cross.secrets`. |
| Artifact/output export | Worker and provider export paths are reachable and now enforce output-root and secret-scan refusal boundaries. | The mechanism campaign owes the E5 export/refusal observations. Cross-tenant output visibility is independently required as `d1.tenant.cross.outputs` and `d2m.tenant.cross.outputs`; neither profile's result may be substituted for the other. |
| Audit, cost, and tool surface | Audit/cost projectors remain reachable. The distributed tool surface remains disarmed for M1a and is not promoted by this review. The per-Organization resolver is nevertheless reachable and testable without arming that surface. | `d1.tenant.cross.tool_calls` and `d2m.tenant.cross.tool_calls` are both **required**. Each must deny B presenting A's run while the same resolver admits A's own company/run pair as the positive control. This proves resolver isolation under the M1a off posture; it is distinct from the pending M1b `d2c.tenant.cross.tool_calls` case, which requires the surface armed. |
| Object cleanup | Object-store cleanup/reclamation mechanisms remain present. | Orphan/object cleanup injections: `M1-D1-SPINE` only where named by the matrix. |

This ledger is the source/reachability half of M1a entry. It does not satisfy any clause of the
frozen seven-clause audit matrix. A successor E5 audit must cite fresh immutable campaign records
for this exact candidate and be certified by a different eligible session.

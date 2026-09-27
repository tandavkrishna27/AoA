# M1a candidate reachability review: d479709ed894

**Candidate:** `d479709ed8940fe69ef28539daadb90b9b29310b`
**Measured (UTC):** `2026-09-27`
**Scope:** candidate-specific source reachability and campaign allocation; not campaign evidence or a gate verdict

These additive ledgers supersede the candidate applicability of the preserved `28151ec8724f`
ledgers without editing them. The review compared the two exact candidate trees. The only new
non-document source is the D1 workflow and its assertion self-test: the workflow installs the
lockfile-pinned host-side AST compiler before host evaluators and gives the matrix job a bounded
50-minute timeout. Product paths, topology, protocol, provider identity, and fault declarations are
byte-identical to the prior candidate.

No result from D1 run `36275492975` or any older candidate is carried forward. Its D1 dispositions
are retained as attempts 19, 20, and 21 on PR #627, which must land before this freeze approval becomes
effective. Their bytes remain historical evidence for `28151ec...`, never evidence for this candidate.
The profiles remain distinct: `M1-D1-SPINE` uses the gated fake provider; `M1a-D2-MECHANISM` uses
real E2B. `required` means a fresh exact-candidate campaign must fire the case; `pending` remains
recorded debt and is never silently promoted.

| Ledger | Candidate-current conclusion |
|---|---|
| [E3](./E3-job-control.md) | Production job-control paths are source-unchanged; all campaign-only tenancy, fencing, cancellation, and rollback claims require fresh evidence. |
| [E4](./E4-worker-daemon.md) | Worker runtime paths are source-unchanged; the host dependency repair makes the D1 evaluator runnable but proves no worker behavior. |
| [E5](./E5-workspaces-secrets.md) | Workspace, secret, output, audit, and cost mechanisms are source-unchanged; the seven-clause audit still requires fresh evidence. |
| [E6](./E6-deployment-test-harness.md) | The D1 workflow is repaired and must be exercised fresh; the prior failed campaign is not reusable. |

## Complete frozen matrix inventory

This is the exhaustive two-profile M1a inventory transcribed from
`tests/d1/fault-matrix.json` at the candidate.

| Profile | State | Count | Exact case IDs |
|---|---:|---:|---|
| `M1-D1-SPINE` | required | 29 | `d1.fault.link_cut.worker_to_control_plane`, `d1.fault.link_cut.control_plane_to_postgres`, `d1.fault.object_store.truncated_upload`, `d1.restart.control_plane_process`, `d1.reconcile.expired_lease_reaped`, `d1.cancel.leased_attempt`, `d1.cancel.unleased_attempt`, `d1.provider.execute_deadline_exceeded`, `d1.provider.worker_terminal_mapping`, `d1.cleanup.orphan_object_swept`, `d1.tenant.journey.A`, `d1.tenant.journey.B`, `d1.tenant.cross.lease`, `d1.tenant.cross.read`, `d1.tenant.cross.cancel`, `d1.tenant.cross.events`, `d1.tenant.cross.secrets`, `d1.tenant.cross.staged_inputs`, `d1.tenant.cross.outputs`, `d1.tenant.cross.cost_rows`, `d1.tenant.cross.tool_calls`, `d1.tenant.control_refused`, `d1.tenant.legacy.cost_events`, `d1.tenant.legacy.activity_log`, `d1.tenant.legacy.task_outputs`, `d1.tenant.legacy.provider_credentials`, `d1.credential.lease_expired_redemption_refused`, `d1.credential.wrong_lease_redemption_refused`, `d1.redaction.planted_canary_scrubbed` |
| `M1-D1-SPINE` | pending | 2 | `d1.reconcile.worker_startup_lease_probe`, `d1.credential.production_reader_company_predicate` |
| `M1a-D2-MECHANISM` | required | 17 | `d2m.tenant.journey.A`, `d2m.tenant.journey.B`, `d2m.tenant.cross.lease`, `d2m.tenant.cross.read`, `d2m.tenant.cross.cancel`, `d2m.tenant.cross.events`, `d2m.tenant.cross.secrets`, `d2m.tenant.cross.staged_inputs`, `d2m.tenant.cross.outputs`, `d2m.tenant.cross.cost_rows`, `d2m.tenant.cross.tool_calls`, `d2m.tenant.control_refused`, `d2m.tenant.legacy.cost_events`, `d2m.tenant.legacy.activity_log`, `d2m.tenant.legacy.task_outputs`, `d2m.tenant.legacy.provider_credentials`, `d2m.credential.wrong_lease_redemption_refused` |
| `M1a-D2-MECHANISM` | pending | 9 | `d2m.cancellation.leased_attempt`, `d2m.provider_failure.e2b_create_refused`, `d2m.reconcile.daemon_restart_with_live_lease`, `d2m.cleanup.sandbox_destroyed_on_terminal`, `d2m.cleanup.sandbox_destroyed_on_cancel`, `d2m.cleanup.sandbox_destroyed_on_lease_loss`, `d2m.credential.production_reader_company_predicate`, `d2m.credential.lease_expired_redemption_refused`, `d2m.redaction.planted_canary_scrubbed` |

The two M1a profiles total **46 required and 11 pending**. The repository-wide three-profile
checker reports 46 required and 37 pending because the additional 26 pending cases belong to the
M1b-only `M1-D2-CODING` profile.

**Entry disposition:** source and allocation review is current for this candidate. Freeze approval,
dispatch, campaign results, audit certification, and milestone status remain pending.

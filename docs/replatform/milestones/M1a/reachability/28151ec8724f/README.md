# M1a candidate reachability review: 28151ec8724f

**Candidate:** `28151ec8724fc94d3774845d9d23cac5411a489a`
**Measured (UTC):** `2026-09-27`
**Scope:** candidate-specific source reachability and campaign-allocation ledger; not campaign evidence or a gate verdict

These additive ledgers supersede the candidate applicability of the preserved `7be35ae6b771...`
ledgers without editing them. The earlier ledgers remain historical evidence for their named
candidate only. No earlier campaign result, runtime identifier, image digest, or provider identity
is adopted for `28151ec8724f`.

The review compared `7be35ae6b7719877e61f54ab552de84de8491e7d..28151ec8724fc94d3774845d9d23cac5411a489a`,
re-read every changed production path that can alter an E3-E6 row, reran the wiring caller census,
and inspected the frozen workflows, topology, fault matrix, provider-identity resolver, and campaign
verdict code. The current wiring guard reports **28 wired clauses, 6 declared dormant, and 2
intentionally deferred clauses**. The caller census is retained by the freeze review logs.

The profiles have distinct provider topology. `M1-D1-SPINE` runs the worker-driven reference
journey against the gated fake provider on port `8082`; `M1a-D2-MECHANISM` runs its worker-driven
journey against real E2B. A row applies to both profiles only when it names both frozen case IDs.

| Ledger | Candidate conclusion |
|---|---|
| [E3](./E3-job-control.md) | Production routes remain reachable; campaign-only tenant/cancellation claims remain campaign obligations. |
| [E4](./E4-worker-daemon.md) | Worker boot reachability remains, with new output/redaction paths; restart and cleanup injections still require fresh execution. |
| [E5](./E5-workspaces-secrets.md) | Staging/secrets/output mechanisms are source-reachable where declared; all seven audit clauses still require fresh candidate evidence. |
| [E6](./E6-deployment-test-harness.md) | The candidate harness includes material post-`7be` repairs and must be exercised fresh; old runs are not transferable. |

`M1-D1-SPINE only` below means the clause is allocated only to that fresh candidate campaign. It
does not mean the clause has passed. `M1a-D2-MECHANISM only` has the corresponding meaning. Where
both profiles owe analogous evidence, the ledger names the `d1.*` and `d2m.*` case IDs separately;
the shorthand `both` is not an allocation authority.

## Frozen matrix obligations

This table is a mechanical transcription of `tests/d1/fault-matrix.json` at the candidate. It is
the exhaustive allocation inventory for the two M1a profiles. `required` and `pending` retain
their matrix meanings: pending is recorded debt and never a pass, while required must appear in a
fresh exact-candidate campaign record. The M1b-only `M1-D2-CODING` profile is intentionally not an
M1a obligation and is not listed here.

| Profile | State | Count | Exact case IDs |
|---|---:|---:|---|
| `M1-D1-SPINE` | required | 29 | `d1.fault.link_cut.worker_to_control_plane`, `d1.fault.link_cut.control_plane_to_postgres`, `d1.fault.object_store.truncated_upload`, `d1.restart.control_plane_process`, `d1.reconcile.expired_lease_reaped`, `d1.cancel.leased_attempt`, `d1.cancel.unleased_attempt`, `d1.provider.execute_deadline_exceeded`, `d1.provider.worker_terminal_mapping`, `d1.cleanup.orphan_object_swept`, `d1.tenant.journey.A`, `d1.tenant.journey.B`, `d1.tenant.cross.lease`, `d1.tenant.cross.read`, `d1.tenant.cross.cancel`, `d1.tenant.cross.events`, `d1.tenant.cross.secrets`, `d1.tenant.cross.staged_inputs`, `d1.tenant.cross.outputs`, `d1.tenant.cross.cost_rows`, `d1.tenant.cross.tool_calls`, `d1.tenant.control_refused`, `d1.tenant.legacy.cost_events`, `d1.tenant.legacy.activity_log`, `d1.tenant.legacy.task_outputs`, `d1.tenant.legacy.provider_credentials`, `d1.credential.lease_expired_redemption_refused`, `d1.credential.wrong_lease_redemption_refused`, `d1.redaction.planted_canary_scrubbed` |
| `M1-D1-SPINE` | pending | 2 | `d1.reconcile.worker_startup_lease_probe`, `d1.credential.production_reader_company_predicate` |
| `M1a-D2-MECHANISM` | required | 17 | `d2m.tenant.journey.A`, `d2m.tenant.journey.B`, `d2m.tenant.cross.lease`, `d2m.tenant.cross.read`, `d2m.tenant.cross.cancel`, `d2m.tenant.cross.events`, `d2m.tenant.cross.secrets`, `d2m.tenant.cross.staged_inputs`, `d2m.tenant.cross.outputs`, `d2m.tenant.cross.cost_rows`, `d2m.tenant.cross.tool_calls`, `d2m.tenant.control_refused`, `d2m.tenant.legacy.cost_events`, `d2m.tenant.legacy.activity_log`, `d2m.tenant.legacy.task_outputs`, `d2m.tenant.legacy.provider_credentials`, `d2m.credential.wrong_lease_redemption_refused` |
| `M1a-D2-MECHANISM` | pending | 9 | `d2m.cancellation.leased_attempt`, `d2m.provider_failure.e2b_create_refused`, `d2m.reconcile.daemon_restart_with_live_lease`, `d2m.cleanup.sandbox_destroyed_on_terminal`, `d2m.cleanup.sandbox_destroyed_on_cancel`, `d2m.cleanup.sandbox_destroyed_on_lease_loss`, `d2m.credential.production_reader_company_predicate`, `d2m.credential.lease_expired_redemption_refused`, `d2m.redaction.planted_canary_scrubbed` |

The counts are `46 required` and `11 pending` across the two M1a profiles. The repository checker
also reports the full three-profile matrix as `46 required` and `37 pending`; the additional 26
pending cases belong to `M1-D2-CODING` and do not silently become M1a obligations.

**Entry disposition:** the E3-E6 candidate-ledger entry bullet is covered for this candidate's
source and allocation review. Freeze approval, dispatch, campaign pass, audit certification, and
milestone status are unchanged and remain pending.

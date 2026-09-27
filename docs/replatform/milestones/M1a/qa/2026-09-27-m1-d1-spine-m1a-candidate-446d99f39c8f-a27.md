# QA Result - Historical M1-D1-SPINE correction, 446d99f39c8f, attempt 27

**Date (UTC):** `2026-09-27`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-27-m1-d1-spine-m1a-candidate-446d99f39c8f-a27.md`
**Scope slug:** `m1a-candidate`
**Revision:** `446d99f39c8f8f9bece2138252fe48c839fbc7a6`
**Attempt:** `27`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-27-m1-d1-spine-m1a-candidate-446d99f39c8f-a25.md`
**Lane:** `M1-D1-SPINE`
**Result:** `fail`
**Failure class:** `harness`
**Campaign start (UTC):** `not_applicable`
**Campaign end (UTC):** `not_applicable`

This record is immutable from its first commit. It is an author self-review of historical documentation, not independent campaign QA, new execution, planning approval, or current-candidate clearance. See [historical disposition](../2026-09-27-pr610-pr615-historical-qa-disposition.md) for original blobs, review findings, conditional chains and allocation.

## Topology and environment

Protocol identity recovered with `git show <exact revision>:docs/contracts/worker-protocol/v1/manifest.sha256` (same values on both named candidates):

- `conformance.json`: `872f4e47dc036f6491adbfe8200647ce9dc39955a83277d52ae17f28a7772f71`
- `operations.md`: `57d7b048ab65972558029105ccbef30ae9fc1c7e8cb962a54029fad97b4ce775`

No aggregate topology digest is required by EVID-01. Unknown runtime values are unresolved, not fabricated.

No same-candidate D1 run was found in the exact-head Actions API query. It returned keyed/keyless shipped-boot, PR and verdict-reconcile runs; these are not D1 campaigns. The older f8 D1 execution is not evidence for this candidate, and its formal retention correction is attempt 24.

D1 runtime topology, image digests, provider/template versions, feature/config hashes and campaign observations are `not_observed` for this exact candidate. Source protocol identity is known above; source identity is not execution identity. Do not borrow the 446d mechanism images or later d479 campaign data. D4/D6 schedules and desktop artifacts are not applicable.

## Commands

| Command | Exit code | Duration | Result summary |
|---|---:|---|---|---|
| `gh api 'repos/MeteoriteLabs/AoA/actions/runs?head_sha=446d99f39c8f8f9bece2138252fe48c839fbc7a6&per_page=100'` | 0 | not_recorded | Four exact-head runs; none D1. Read-only query on September 27, 2026; no universal absence claim beyond returned inventory. |
| `git show 446d99f39c8f8f9bece2138252fe48c839fbc7a6:docs/contracts/worker-protocol/v1/manifest.sha256` | 0 | not_recorded | Source protocol identity recovered. |

## Review correction and applicability

McClintock P2 confirmed that the template's final clause requires individual scope, observed value and decision even for FAIL records. This successor preserves the immediate predecessor's known identity and observations verbatim below; inherited Commands describe that predecessor's review, not commands newly executed here. No artifact or campaign was newly measured by this successor.

H-01 through H-05 and H-07 apply to security/correctness within the historical partial tenant/workload topology. Untested surfaces are unproven, not exemptions. H-06 remains an unresolved partial-gate residual, not a HARD waiver. Full D1/D2 volume, two-worker D1 promotion, capability, HA and D4/D6 schedules are outside this partial certification scope; their full-lane thresholds are not silently imported. Applicable partial conditions are separately recorded below.

## Assertions and evidence

| Requirement ID | Class | Required value/condition | Observed value | Evidence | Result |
|---|---|---|---|---|---|
| `H-01` | HARD | Tenant isolation in this partial tenant set: zero unauthorized cross-Organization/Company reads, writes, deletes, disclosures, subscriptions, object-key, secret or provider access | No exact-candidate D1 campaign observed in the predecessor's inspected inventory; no tenant isolation measurement. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1-d1-spine-m1a-candidate-446d99f39c8f-a25.md); candidate-specific originals cited there | fail |
| `H-02` | HARD | Lease authority in exercised partial paths: zero accepted mutation/event/artifact/secret/checkpoint/completion/external effect from stale or replaced fence | No exact-candidate D1 stale/replaced-fence measurement. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1-d1-spine-m1a-candidate-446d99f39c8f-a25.md); candidate-specific originals cited there | fail |
| `H-03` | HARD | Single executor in partial topology: zero overlapping authoritative leases or simultaneously effectful service generations absent approved overlap | No exact-candidate D1 authoritative lease or executor overlap measurement. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1-d1-spine-m1a-candidate-446d99f39c8f-a25.md); candidate-specific originals cited there | fail |
| `H-04` | HARD | Secret containment: zero known canaries in envelopes, argv, URLs, events, logs, metrics, traces, browser artifacts, metadata, SQLite outboxes or QA artifacts | No exact-candidate D1 secret-canary surface census. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1-d1-spine-m1a-candidate-446d99f39c8f-a25.md); candidate-specific originals cited there | fail |
| `H-05` | HARD | Sandbox boundary: zero host tenant commands; workers have no DB credential; control-plane replicas have no Docker/provider-control socket | No exact-candidate D1 worker-host, worker credential or control-plane socket measurement. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1-d1-spine-m1a-candidate-446d99f39c8f-a25.md); candidate-specific originals cited there | fail |
| `H-07` | HARD | Hosted exclusions: disabled public ingress, cloud-plugin execution and unsafe process-wide multitenant override remain impossible | D1 runtime flags and disabled-surface refusal evidence not observed for this candidate. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1-d1-spine-m1a-candidate-446d99f39c8f-a25.md); candidate-specific originals cited there | fail |
| `EVID-01` | REQUIRED | Exact-candidate campaign identity | No D1 run; runtime identity not observed | Exact-head Actions inventory | fail |
| `RET-01` | INITIAL | At least 180-day controlled D1 evidence | No exact-candidate D1 campaign/controlled retention proof | Original attempt 22 and run query | fail |
| `H-08` | HARD | Approved verified executed digests | No exact-candidate D1 execution/approval evidence | Run query | fail |
| `H-09` | HARD | Final resources absent within cleanup deadline | No exact-candidate D1 cleanup measurement | Run query | fail |
| `EVID-02` | REQUIRED | Append-only correction and requirement mapping | Original paths unchanged; this higher attempt links its historical predecessor | Git blobs and disposition inventory | pass |
| `EVID-03` | REQUIRED | Use normative stable IDs verbatim | This table uses EVID, RET and H IDs; predecessor SPINE-/MECH- labels are local aliases, not replacement normative IDs | `docs/replatform/test-gates.md` | pass |
| `EVID-04` | REQUIRED | Milestone QA path, exact SHA and higher attempt | Header and filename identify the historical candidate and allocated attempt | This record | pass |
| `H-06` | HARD | Deny metadata/private/control destinations for full promotion | Accepted partial-gate residual remains unresolved; no full-lane pass or waiver | Predecessor observations | recorded |
| `H-10` | HARD | Never hide or rewrite failed records | All ten originals retained; FAIL corrections appended | Git blob inventory | pass |

## Applicable partial-gate conditions

Labels below are descriptive traceability names, not substitute normative requirement IDs. Normative EVID/RET/H IDs remain in the assertion table. A recorded predecessor observation is not renewed independent certification; unresolved REQUIRED conditions continue to block pass.

| Partial condition | Class | Required condition | Preserved observation / decision | Result |
|---|---|---|---|---|
| Exact D1 binding and jobs | REQUIRED | Same candidate and successful D1 jobs | Predecessor 25 found no same-candidate D1 run in inspected inventory | fail |
| Required fault matrix | REQUIRED | Required cases fire/classify with zero violations; pending declared under candidate-time amendment | No exact-candidate D1 matrix observed | fail |
| Partial F10 | REQUIRED | A/B enabled, C off; crew/tool off and tenant-scoped rollout | No exact-candidate D1 runtime flags observed | fail |
| Worker-driven journey and negative control | REQUIRED | Deployed executor and wrong-executor control red | No exact-candidate D1 execution/control observed | fail |
| Audit and authoritative priced cost | REQUIRED | Journey lifecycle/audit and cost receipts | No exact-candidate D1 audit/cost observed; mechanism data not borrowed | fail |
| Rollback rehearsal | REQUIRED | No failed cancellations | No exact-candidate D1 rollback observation | fail |
| Stage-in-env observation | OBSERVED | Credential observation scoped | not_observed | recorded |
| Partial teardown | REQUIRED | Stack/test resource cleanup evidenced | No D1 cleanup measurement is not final resource census or deadline proof; H-09 fails | fail |

## Failures

Harness/evidence deficiency, not a product failure. Original attempt 22's unsupported `missing_evidence` failure class becomes `harness`; unsupported timestamp prose becomes `not_applicable`. No new campaign was started, and this record is a formal FAIL disposition rather than blocked_external or a dispatch request.

## Cleanup

No resources created by this documentation review. Historical sandbox termination, object cleanup/quarantine and database cleanup are not certified by job success. Controlled local copies are not a 180-day archive. No raw logs enter Git.

## Gate effect

Formal FAIL, historical and nonpromoting. Does not satisfy M1a criterion 8 or clear any current candidate. No D1/D2/E6/E7/M1b capability, HA, release, cutover or milestone closure is granted. D4/D6 schedule/samples and desktop/mobility evidence are not applicable. A future candidate requires its own approved scope and exact-candidate evidence; this review authorizes no dispatch.

# QA Result - Historical M1-D1-SPINE correction, 446d99f39c8f, attempt 25

**Date (UTC):** `2026-09-27`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-27-m1-d1-spine-m1a-candidate-446d99f39c8f-a25.md`
**Scope slug:** `m1a-candidate`
**Revision:** `446d99f39c8f8f9bece2138252fe48c839fbc7a6`
**Attempt:** `25`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-26-m1-d1-spine-m1a-candidate-446d99f39c8f-a22.md`
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

## Assertions and evidence

| Requirement ID | Class | Required value/condition | Observed value | Evidence | Result |
|---|---|---|---|---|---|
| `EVID-01` | REQUIRED | Exact-candidate campaign identity | No D1 run; runtime identity not observed | Exact-head Actions inventory | fail |
| `RET-01` | INITIAL | At least 180-day controlled D1 evidence | No exact-candidate D1 campaign/controlled retention proof | Original attempt 22 and run query | fail |
| `H-08` | HARD | Approved verified executed digests | No exact-candidate D1 execution/approval evidence | Run query | fail |
| `H-09` | HARD | Final resources absent within cleanup deadline | No exact-candidate D1 cleanup measurement | Run query | fail |
| `EVID-02` | REQUIRED | Append-only correction and requirement mapping | Original paths unchanged; this higher attempt links its historical predecessor | Git blobs and disposition inventory | pass |
| `EVID-03` | REQUIRED | Use normative stable IDs verbatim | This table uses EVID, RET and H IDs; predecessor SPINE-/MECH- labels are local aliases, not replacement normative IDs | `docs/replatform/test-gates.md` | pass |
| `EVID-04` | REQUIRED | Milestone QA path, exact SHA and higher attempt | Header and filename identify the historical candidate and allocated attempt | This record | pass |
| `H-06` | HARD | Deny metadata/private/control destinations for full promotion | Accepted partial-gate residual remains unresolved; no full-lane pass or waiver | Predecessor observations | recorded |
| `H-10` | HARD | Never hide or rewrite failed records | All ten originals retained; FAIL corrections appended | Git blob inventory | pass |

## Failures

Harness/evidence deficiency, not a product failure. Original attempt 22's unsupported `missing_evidence` failure class becomes `harness`; unsupported timestamp prose becomes `not_applicable`. No new campaign was started, and this record is a formal FAIL disposition rather than blocked_external or a dispatch request.

## Cleanup

No resources created by this documentation review. Historical sandbox termination, object cleanup/quarantine and database cleanup are not certified by job success. Controlled local copies are not a 180-day archive. No raw logs enter Git.

## Gate effect

Formal FAIL, historical and nonpromoting. Does not satisfy M1a criterion 8 or clear any current candidate. No D1/D2/E6/E7/M1b capability, HA, release, cutover or milestone closure is granted. D4/D6 schedule/samples and desktop/mobility evidence are not applicable. A future candidate requires its own approved scope and exact-candidate evidence; this review authorizes no dispatch.

# QA Result - Historical M1-D1-SPINE correction, f8cdbe92e1cd, attempt 26

**Date (UTC):** `2026-09-27`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-27-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a26.md`
**Scope slug:** `m1a-candidate`
**Revision:** `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
**Attempt:** `26`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-27-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a24.md`
**Lane:** `M1-D1-SPINE`
**Result:** `fail`
**Failure class:** `harness`
**Campaign start (UTC):** `2026-09-25T15:11:13Z`
**Campaign end (UTC):** `2026-09-25T15:51:37Z`

This record is immutable from its first commit. It is an author self-review of historical documentation, not independent campaign QA, new execution, planning approval, or current-candidate clearance. See [historical disposition](../2026-09-27-pr610-pr615-historical-qa-disposition.md) for original blobs, review findings, conditional chains and allocation.

## Topology and environment

Protocol identity recovered with `git show <exact revision>:docs/contracts/worker-protocol/v1/manifest.sha256` (same values on both named candidates):

- `conformance.json`: `872f4e47dc036f6491adbfe8200647ce9dc39955a83277d52ae17f28a7772f71`
- `operations.md`: `57d7b048ab65972558029105ccbef30ae9fc1c7e8cb962a54029fad97b4ce775`

No aggregate topology digest is required by EVID-01. Unknown runtime values are unresolved, not fabricated.

Historical run [36152472861](https://github.com/MeteoriteLabs/AoA/actions/runs/36152472861) completed successfully; the predecessor reports 29/29 required fault cases, two pending cases, worker-driven audit/cost receipts and rollback rehearsal. Those execution observations are preserved without certifying retention or cleanup.

Known image digests from original attempt 21:

- Control plane: `sha256:d0a3cbfcafd53f30d869de95d334aaa42db6d084299d3239c42442fb2abf38a4`
- Worker: `sha256:069298056d2930a3a81cfac44285ad59745075b00fdd0792c2de8de0d6af170f`
- Adapter manager: `sha256:34c81e299abb2315ea3d0417a94739bddb06ecd919915abe8520ff6ccf1de9c6`
- MinIO source-built image is referenced; immutable object-store digest unresolved here.

Spine topology: one control-plane replica, one separately deployed worker executor, PostgreSQL and MinIO; two enabled Organizations and one control. A/B canary, C off; authenticated deployment; crew false and distributed tool surface false. Organization/company IDs are preserved in original attempt 21. The reference provider is not E2B; real-provider template identity is not applicable to this reference arm. Exact reference-provider version and per-component failure domains are unresolved in this review.

Configuration hashes carried from attempt 21:

- Rollout: `02cebb95542abbd49ff4b646d8ee1dc730ce584e49d6287c08b04f1160a9012f`
- Target profile: `6edeaf5119809e4970a743eebe1aafcfceed77fe261a4b2495ecd98ec88d1b74`
- Provider constraint: `6806f456d41a7608b6cef8db6115d2c1e7f53781ffbcecceaf0031df12823e2f`
- Enabled A input/policy: `dd2c53b8563a2af477a5dc6870b6c92246d6c983e3bedecf3b76e281b4aa8cfd`
- Control legacy input/policy: `c7ae207c727f8a6b3dd503ba13407000653801b62154fc5015ea58769c32d0a5`

## Commands

| Command | Exit code | Duration | Result summary |
|---|---:|---|---|
| `gh api repos/MeteoriteLabs/AoA/actions/runs/36152472861/artifacts` | 0 | not_recorded | Three artifacts created September 25 expire October 9, 2026; 14 days. |
| `git show f8cdbe92e1cdc263876734d06618fae39a07e0ba:docs/contracts/worker-protocol/v1/manifest.sha256` | 0 | not_recorded | Exact-tree protocol hashes recovered. |

## Review correction and applicability

McClintock P2 confirmed that the template's final clause requires individual scope, observed value and decision even for FAIL records. This successor preserves the immediate predecessor's known identity and observations verbatim below; inherited Commands describe that predecessor's review, not commands newly executed here. No artifact or campaign was newly measured by this successor.

H-01 through H-05 and H-07 apply to security/correctness within the historical partial tenant/workload topology. Untested surfaces are unproven, not exemptions. H-06 remains an unresolved partial-gate residual, not a HARD waiver. Full D1/D2 volume, two-worker D1 promotion, capability, HA and D4/D6 schedules are outside this partial certification scope; their full-lane thresholds are not silently imported. Applicable partial conditions are separately recorded below.

## Assertions and evidence

| Requirement ID | Class | Required value/condition | Observed value | Evidence | Result |
|---|---|---|---|---|---|
| `H-01` | HARD | Tenant isolation in this partial tenant set: zero unauthorized cross-Organization/Company reads, writes, deletes, disclosures, subscriptions, object-key, secret or provider access | Original D1 21 reports A/B canary and C off, with tenant tripwires; zero violations across every H-01 surface not established here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a24.md); candidate-specific originals cited there | fail |
| `H-02` | HARD | Lease authority in exercised partial paths: zero accepted mutation/event/artifact/secret/checkpoint/completion/external effect from stale or replaced fence | Original D1 21 reports 29/29 required matrix cases; complete stale/replaced-fence mutation and effect census not regraded here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a24.md); candidate-specific originals cited there | fail |
| `H-03` | HARD | Single executor in partial topology: zero overlapping authoritative leases or simultaneously effectful service generations absent approved overlap | One deployed executor and wrong-executor negative control are reported; zero authoritative lease overlap across the partial topology not certified here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a24.md); candidate-specific originals cited there | fail |
| `H-04` | HARD | Secret containment: zero known canaries in envelopes, argv, URLs, events, logs, metrics, traces, browser artifacts, metadata, SQLite outboxes or QA artifacts | Original D1 21 reports stage_in_env_only credential observation; all H-04 canary surfaces not certified here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a24.md); candidate-specific originals cited there | fail |
| `H-05` | HARD | Sandbox boundary: zero host tenant commands; workers have no DB credential; control-plane replicas have no Docker/provider-control socket | Deployed-worker journey/control reported; no complete host-command, worker DB credential and control-plane socket census reviewed here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a24.md); candidate-specific originals cited there | fail |
| `H-07` | HARD | Hosted exclusions: disabled public ingress, cloud-plugin execution and unsafe process-wide multitenant override remain impossible | Crew/tool false and C off reported; all disabled ingress, cloud-plugin and unsafe multitenant refusal variants not certified here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a24.md); candidate-specific originals cited there | fail |
| `EVID-01` | REQUIRED | Record known immutable identity and unresolved fields | Known image/protocol/config values above; remaining identity explicitly unresolved | Original attempt 21 and exact tree | recorded |
| `RET-01` | INITIAL | Controlled evidence retained at least 180 days | Three CI artifacts expire after 14 days; no controlled archive locator, custody/policy and 180-day proof | Run artifact metadata | fail |
| `H-08` | HARD | Approved digest plus verified project signature/provider provenance; roots/policy recorded | Image metadata/SBOM or in-job test key is not digest approval; no approval/provenance policy established by this review | Original attempts 18-21 | fail |
| `H-09` | HARD | Zero resources after cleanup deadline/final reconciliation | Job SUCCESS and no reported error do not assert resource absence or deadline; unresolved | Original attempt 21 | fail |
| `EVID-02` | REQUIRED | Append-only correction and requirement mapping | Original paths unchanged; this higher attempt links its historical predecessor | Git blobs and disposition inventory | pass |
| `EVID-03` | REQUIRED | Use normative stable IDs verbatim | This table uses EVID, RET and H IDs; predecessor SPINE-/MECH- labels are local aliases, not replacement normative IDs | `docs/replatform/test-gates.md` | pass |
| `EVID-04` | REQUIRED | Milestone QA path, exact SHA and higher attempt | Header and filename identify the historical candidate and allocated attempt | This record | pass |
| `H-06` | HARD | Deny metadata/private/control destinations for full promotion | Accepted partial-gate residual remains unresolved; no full-lane pass or waiver | Predecessor observations | recorded |
| `H-10` | HARD | Never hide or rewrite failed records | All ten originals retained; FAIL corrections appended | Git blob inventory | pass |

## Applicable partial-gate conditions

Labels below are descriptive traceability names, not substitute normative requirement IDs. Normative EVID/RET/H IDs remain in the assertion table. A recorded predecessor observation is not renewed independent certification; unresolved REQUIRED conditions continue to block pass.

| Partial condition | Class | Required condition | Preserved observation / decision | Result |
|---|---|---|---|---|
| Exact D1 binding and jobs | REQUIRED | Same candidate and successful D1 jobs | Original 21 reports run 36152472861 bound to f8 and all three jobs success | recorded |
| Required fault matrix | REQUIRED | Required cases fire/classify with zero violations; pending declared under candidate-time amendment | Original 21 reports 29/29 required, 2 pending, zero violations; not full D1 completion | recorded |
| Partial F10 | REQUIRED | A/B enabled, C off; crew/tool off and tenant-scoped rollout | Original 21 reports A/B canary, C off and flags false | recorded |
| Worker-driven journey and negative control | REQUIRED | Deployed executor and wrong-executor control red | Original 21 reports deployed executor, empty passing verdict and nonempty negative-control verdict | recorded |
| Audit and authoritative priced cost | REQUIRED | Journey lifecycle/audit and cost receipts | Original 21 reports activity_audit, started/terminal, costCents 81 and applied authoritative_cost receipt | recorded |
| Rollback rehearsal | REQUIRED | No failed cancellations | Original 21 reports exit 0, Organizations scanned 3, cancellations 5, failedCancellations empty | recorded |
| Stage-in-env observation | OBSERVED | Credential observation scoped | Original 21: observed true, stage_in_env_only, logMessages 1; not full containment | recorded |
| Partial teardown | REQUIRED | Stack/test resource cleanup evidenced | Original job success/no reported error is not final resource census or deadline proof; H-09 fails | fail |

## Failures

Harness/evidence deficiency: RET-01 is unproven, and H-08/H-09 certification is not established. This does not assert a measured product, supply-chain compromise, or actual resource leak. The original assertion table conflated downloadability with retention and workflow success with cleanup.

## Cleanup

No resources created by this documentation review. Historical sandbox termination, object cleanup/quarantine and database cleanup are not certified by job success. Controlled local copies are not a 180-day archive. No raw logs enter Git.

## Gate effect

Formal FAIL, historical and nonpromoting. Does not satisfy M1a criterion 8 or clear any current candidate. No D1/D2/E6/E7/M1b capability, HA, release, cutover or milestone closure is granted. D4/D6 schedule/samples and desktop/mobility evidence are not applicable. A future candidate requires its own approved scope and exact-candidate evidence; this review authorizes no dispatch.

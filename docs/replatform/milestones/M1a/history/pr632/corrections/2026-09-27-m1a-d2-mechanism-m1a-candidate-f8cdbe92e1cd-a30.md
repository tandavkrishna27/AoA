# QA Result - Historical M1a-D2-MECHANISM correction, f8cdbe92e1cd, attempt 30

**Date (UTC):** `2026-09-27`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-27-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a30.md`
**Scope slug:** `m1a-candidate`
**Revision:** `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
**Attempt:** `30`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-25-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a28.md`
**Lane:** `M1a-D2-MECHANISM`
**Result:** `fail`
**Failure class:** `harness`
**Campaign start (UTC):** `2026-09-25T16:39:51Z`
**Campaign end (UTC):** `2026-09-25T17:01:33Z`

This record is immutable from its first commit. It is an author self-review of historical documentation, not independent campaign QA, new execution, planning approval, or current-candidate clearance. See [historical disposition](../2026-09-27-pr610-pr615-historical-qa-disposition.md) for original blobs, review findings, conditional chains and allocation.

## Topology and environment

Protocol identity recovered with `git show <exact revision>:docs/contracts/worker-protocol/v1/manifest.sha256` (same values on both named candidates):

- `conformance.json`: `872f4e47dc036f6491adbfe8200647ce9dc39955a83277d52ae17f28a7772f71`
- `operations.md`: `57d7b048ab65972558029105ccbef30ae9fc1c7e8cb962a54029fad97b4ce775`

No aggregate topology digest is required by EVID-01. Unknown runtime values are unresolved, not fabricated.

Historical keyed run [36162184337](https://github.com/MeteoriteLabs/AoA/actions/runs/36162184337), keyless rehearsal 36153039186. Known identity from original attempt 28:

- Control plane: `sha256:8dc2a79ed32748f2a6721a628e20a486d8b2ee90fbd319431830dcfeb60fb0db`
- Worker: `sha256:90f218fd3dc86af1c5383153fd1f7f342b19b7e844b55c45b3d21f79a5983964`
- Adapter manager: `sha256:5204ef8b68aac9f0320cd9e9ccacb897fd4ff68810bb5b8c21bf17a76d8d450a`
- MinIO: `aoa-m1-minio:RELEASE.2025-09-07T16-13-09Z`, source build; immutable digest unresolved.

Two control-plane replicas, three Organization-target workers, PostgreSQL, MinIO and adapter manager; enabled Organizations `a2bb888f-5e27-4322-a078-2e47178cb027` and `67d46191-7673-42ae-be5d-690c7dc781f9`, control `b908e08e-4ea6-42e9-9a90-799bdea060b1`. Crew false; tool surface null/off. Real E2B requested alias `aoa-base`; immutable template build, service release, exact SDK version and complete target/config hashes unresolved in these originals. Public test-key hash `fdce73f3d01a54cd9a4688efbeb859e1c710b12f5884f35226790e38cc9e539f` is not H-08 approval. No private key inspected or generated.

## Commands

| Command | Exit code | Duration | Result summary |
|---|---:|---|---|---|
| `git show f8cdbe92e1cdc263876734d06618fae39a07e0ba:docs/contracts/worker-protocol/v1/manifest.sha256` | 0 | not_recorded | Recovered source hashes. |
| `git show f8cdbe92e1cdc263876734d06618fae39a07e0ba:docs/replatform/epics/E6-deployment-test-harness/implementation-plan.md` | 0 | not_recorded | Candidate-time required/pending amendment and broader gate allocation audited. |

## Assertions and evidence

| Requirement ID | Class | Required value/condition | Observed value | Evidence | Result |
|---|---|---|---|---|---|
| `EVID-01` | REQUIRED | Real-provider immutable identity | Known identity above; unresolved immutable template/service/target configuration | Original attempt 28 | fail |
| `RET-01` | INITIAL | At least 180-day controlled evidence | Upload/download is not custody/retention proof; no verified controlled archive | Original attempt 28 | fail |
| `H-08` | HARD | Approved verified digest with roots/policy | In-job sign/verify probe does not supply approved-image provenance | Original attempt 28 | fail |
| `H-09` | HARD | Deadline-bound provider resource absence | Teardown step success is not all three cleanup paths/final resource census | Original attempt 28 | fail |
| `EVID-02` | REQUIRED | Append-only correction and requirement mapping | Original paths unchanged; this higher attempt links its historical predecessor | Git blobs and disposition inventory | pass |
| `EVID-03` | REQUIRED | Use normative stable IDs verbatim | This table uses EVID, RET and H IDs; predecessor SPINE-/MECH- labels are local aliases, not replacement normative IDs | `docs/replatform/test-gates.md` | pass |
| `EVID-04` | REQUIRED | Milestone QA path, exact SHA and higher attempt | Header and filename identify the historical candidate and allocated attempt | This record | pass |
| `H-06` | HARD | Deny metadata/private/control destinations for full promotion | Accepted partial-gate residual remains unresolved; no full-lane pass or waiver | Predecessor observations | recorded |
| `H-10` | HARD | Never hide or rewrite failed records | All ten originals retained; FAIL corrections appended | Git blob inventory | pass |

## Failures

Original FAIL stands. Harness/evidence deficiencies include unresolved real-provider identity, journey-local audit arrays empty and costEventsForRun zero (original attempt 28). D1 reference-provider receipts cannot fill these keyed gaps. Current matrix approval cannot retroactively amend the historical gate. Pending count alone is not the blanket passing/failing rule: the candidate-time two-tier amendment is acknowledged in the inventory.

## Cleanup

No resources created by this documentation review. Historical sandbox termination, object cleanup/quarantine and database cleanup are not certified by job success. Controlled local copies are not a 180-day archive. No raw logs enter Git.

## Gate effect

Formal FAIL, historical and nonpromoting. Does not satisfy M1a criterion 8 or clear any current candidate. No D1/D2/E6/E7/M1b capability, HA, release, cutover or milestone closure is granted. D4/D6 schedule/samples and desktop/mobility evidence are not applicable. A future candidate requires its own approved scope and exact-candidate evidence; this review authorizes no dispatch.

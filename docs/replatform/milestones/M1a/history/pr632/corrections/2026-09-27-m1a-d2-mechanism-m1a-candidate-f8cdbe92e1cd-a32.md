# QA Result - Historical M1a-D2-MECHANISM correction, f8cdbe92e1cd, attempt 32

**Date (UTC):** `2026-09-27`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-27-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a32.md`
**Scope slug:** `m1a-candidate`
**Revision:** `f8cdbe92e1cdc263876734d06618fae39a07e0ba`
**Attempt:** `32`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-27-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a30.md`
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

## Review correction and applicability

McClintock P2 confirmed that the template's final clause requires individual scope, observed value and decision even for FAIL records. This successor preserves the immediate predecessor's known identity and observations verbatim below; inherited Commands describe that predecessor's review, not commands newly executed here. No artifact or campaign was newly measured by this successor.

H-01 through H-05 and H-07 apply to security/correctness within the historical partial tenant/workload topology. Untested surfaces are unproven, not exemptions. H-06 remains an unresolved partial-gate residual, not a HARD waiver. Full D1/D2 volume, two-worker D1 promotion, capability, HA and D4/D6 schedules are outside this partial certification scope; their full-lane thresholds are not silently imported. Applicable partial conditions are separately recorded below.

## Assertions and evidence

| Requirement ID | Class | Required value/condition | Observed value | Evidence | Result |
|---|---|---|---|---|---|
| `H-01` | HARD | Tenant isolation in this partial tenant set: zero unauthorized cross-Organization/Company reads, writes, deletes, disclosures, subscriptions, object-key, secret or provider access | Original mechanism observations report 14 cross-tenant cases and suppression control; this successor has not regraded all H-01 access/disclosure surfaces. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a30.md); candidate-specific originals cited there | fail |
| `H-02` | HARD | Lease authority in exercised partial paths: zero accepted mutation/event/artifact/secret/checkpoint/completion/external effect from stale or replaced fence | Original mechanism observations include wrong-lease redemption probes; stale/replaced-fence mutation and effect census not established here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a30.md); candidate-specific originals cited there | fail |
| `H-03` | HARD | Single executor in partial topology: zero overlapping authoritative leases or simultaneously effectful service generations absent approved overlap | Three Organization-target workers are reported; zero overlapping authoritative leases/effectful service generations not established here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a30.md); candidate-specific originals cited there | fail |
| `H-04` | HARD | Secret containment: zero known canaries in envelopes, argv, URLs, events, logs, metrics, traces, browser artifacts, metadata, SQLite outboxes or QA artifacts | Original f8 mechanism 28 reports 18-class env probes and planted-canary scrubbing; standalone probes do not certify every H-04 surface or promote pending matrix redaction. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a30.md); candidate-specific originals cited there | fail |
| `H-05` | HARD | Sandbox boundary: zero host tenant commands; workers have no DB credential; control-plane replicas have no Docker/provider-control socket | Env probes report forbidden datastore credentials absent; zero host-executed tenant commands and absence of control-plane provider/Docker sockets not established here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a30.md); candidate-specific originals cited there | fail |
| `H-07` | HARD | Hosted exclusions: disabled public ingress, cloud-plugin execution and unsafe process-wide multitenant override remain impossible | Two rendered/running replicas report crew false and tool surface null/off; disabled ingress, cloud-plugin and unsafe multitenant refusal coverage not established here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a30.md); candidate-specific originals cited there | fail |
| `EVID-01` | REQUIRED | Real-provider immutable identity | Known identity above; unresolved immutable template/service/target configuration | Original attempt 28 | fail |
| `RET-01` | INITIAL | At least 180-day controlled evidence | Upload/download is not custody/retention proof; no verified controlled archive | Original attempt 28 | fail |
| `H-08` | HARD | Approved verified digest with roots/policy | In-job sign/verify probe does not supply approved-image provenance | Original attempt 28 | fail |
| `H-09` | HARD | Deadline-bound provider resource absence | Teardown step success is not all three cleanup paths/final resource census | Original attempt 28 | fail |
| `EVID-02` | REQUIRED | Append-only correction and requirement mapping | Original paths unchanged; this higher attempt links its historical predecessor | Git blobs and disposition inventory | pass |
| `EVID-03` | REQUIRED | Use normative stable IDs verbatim | This table uses EVID, RET and H IDs; predecessor SPINE-/MECH- labels are local aliases, not replacement normative IDs | `docs/replatform/test-gates.md` | pass |
| `EVID-04` | REQUIRED | Milestone QA path, exact SHA and higher attempt | Header and filename identify the historical candidate and allocated attempt | This record | pass |
| `H-06` | HARD | Deny metadata/private/control destinations for full promotion | Accepted partial-gate residual remains unresolved; no full-lane pass or waiver | Predecessor observations | recorded |
| `H-10` | HARD | Never hide or rewrite failed records | All ten originals retained; FAIL corrections appended | Git blob inventory | pass |

## Applicable partial-gate conditions

Labels below are descriptive traceability names, not substitute normative requirement IDs. Normative EVID/RET/H IDs remain in the assertion table. A recorded predecessor observation is not renewed independent certification; unresolved REQUIRED conditions continue to block pass.

| Partial condition | Class | Required condition | Preserved observation / decision | Result |
|---|---|---|---|---|
| Run and rehearsal binding | REQUIRED | Same-candidate keyed run and keyless suppressed control | Original mechanism 28 reports keyed 36162184337 and keyless 36153039186, 14 suppressed cases; no new verification | recorded |
| Required matrix and broader allocation | REQUIRED | Required cases fire/classify with zero violations; pending have kind/reason and no reported evidence | 17/17 required, 9 pending, complete false in original mechanism 28; broader cancellation/provider failure/reconciliation/cleanup/credential/redaction allocation unresolved. Pending count alone is not a blanket failure or exemption | fail |
| Partial F10 and cross-tenant controls | REQUIRED | A/B distributed, C refuses distributed, crew/tool off; cross-tenant probes and suppressed control | Original reports A/B success, C no distributed job (legacy CLI failure is not legacy health), replica flags off, 14 cross-tenant observations/control; does not certify H-01 entirety | recorded |
| Journey audit and priced cost | REQUIRED | Same keyed journey operator-visible audit and priced-cost receipts | Original 28: jobSubmitted/securityDenials empty; costEventsForRun zero despite parsed usage; D1 receipts cannot substitute | fail |
| Credential environment and planted controls | REQUIRED | Allowed provider credential only; forbidden classes absent and planted controls red | Original env probes report 18 classes absent and planted datastore/cross-tenant/provider mismatch controls red; no new measurement or all-surface credential certification | recorded |
| Standalone redaction / matrix coverage | REQUIRED | Planted canaries scrubbed on both streams; required matrix declarations respected | Original f8 28 reports standalone redaction probe; matrix redaction remains pending in 446d observations. No automatic pending-row promotion or comprehensive H-04 proof | fail |
| Capability | OBSERVED | Partial M1a capability value recorded | capabilityProven false; expected nonblocking partial observation | recorded |
| Partial teardown | REQUIRED | Stack, volumes, keypair/secrets and resource cleanup evidenced | Original teardown success retained; complete provider paths and deadline-bound resource census absent; H-09 fails | fail |

## Failures

Original FAIL stands. Harness/evidence deficiencies include unresolved real-provider identity, journey-local audit arrays empty and costEventsForRun zero (original attempt 28). D1 reference-provider receipts cannot fill these keyed gaps. Current matrix approval cannot retroactively amend the historical gate. Pending count alone is not the blanket passing/failing rule: the candidate-time two-tier amendment is acknowledged in the inventory.

## Cleanup

No resources created by this documentation review. Historical sandbox termination, object cleanup/quarantine and database cleanup are not certified by job success. Controlled local copies are not a 180-day archive. No raw logs enter Git.

## Gate effect

Formal FAIL, historical and nonpromoting. Does not satisfy M1a criterion 8 or clear any current candidate. No D1/D2/E6/E7/M1b capability, HA, release, cutover or milestone closure is granted. D4/D6 schedule/samples and desktop/mobility evidence are not applicable. A future candidate requires its own approved scope and exact-candidate evidence; this review authorizes no dispatch.

# QA Result - Historical M1a-D2-MECHANISM correction, 446d99f39c8f, attempt 33

**Date (UTC):** `2026-09-27`
**Milestone:** `M1a`
**Record path:** `docs/replatform/milestones/M1a/qa/2026-09-27-m1a-d2-mechanism-m1a-candidate-446d99f39c8f-a33.md`
**Scope slug:** `m1a-candidate`
**Revision:** `446d99f39c8f8f9bece2138252fe48c839fbc7a6`
**Attempt:** `33`
**Supersedes:** `docs/replatform/milestones/M1a/qa/2026-09-27-m1a-d2-mechanism-m1a-candidate-446d99f39c8f-a31.md`
**Lane:** `M1a-D2-MECHANISM`
**Result:** `fail`
**Failure class:** `harness`
**Campaign start (UTC):** `2026-09-25T20:39:51Z`
**Campaign end (UTC):** `2026-09-25T21:01:12Z`

This record is immutable from its first commit. It is an author self-review of historical documentation, not independent campaign QA, new execution, planning approval, or current-candidate clearance. See [historical disposition](../2026-09-27-pr610-pr615-historical-qa-disposition.md) for original blobs, review findings, conditional chains and allocation.

## Topology and environment

Protocol identity recovered with `git show <exact revision>:docs/contracts/worker-protocol/v1/manifest.sha256` (same values on both named candidates):

- `conformance.json`: `872f4e47dc036f6491adbfe8200647ce9dc39955a83277d52ae17f28a7772f71`
- `operations.md`: `57d7b048ab65972558029105ccbef30ae9fc1c7e8cb962a54029fad97b4ce775`

No aggregate topology digest is required by EVID-01. Unknown runtime values are unresolved, not fabricated.

Historical keyed run [36187103782](https://github.com/MeteoriteLabs/AoA/actions/runs/36187103782), exact head verified by API. Structured local evidence was read at `C:/Users/TK/AppData/Local/Temp/aoa-m1a-keyed-36187103782/m1-shipped-boot-keyed-36187103782`; it is a local copy, not RET-01 proof. No raw logs were opened or committed.

- Control plane: `sha256:fa3ce6e1013714151810a27196d95c455a85ef35879a45bd475708951fc2e873`
- Worker: `sha256:53c75ded390f97cf2dd82ea9294100ef8bf4d9d63f25caf206e3d67eb95555c7`
- Adapter manager: `sha256:8ba2f03b0148c0c8b1e0d3dc562484c2cf89a856d67340dd0c85a3b16c12e283`
- MinIO source image: `aoa-m1-minio:RELEASE.2025-09-07T16-13-09Z`; immutable digest unresolved.
- Provider E2B; requested alias `aoa-base`; SDK `e2b@2.30.5`; endpoint `api.e2b.dev`. Immutable template ID/build and service release unresolved. Alias, endpoint and sandbox IDs are not a build pin.
- Public test-key hash: `1d73f5fbf85e5ec2428642fcd202e72fef265cc10c05da02463295e8f710f1bb`; no signing/approval operation performed.

Two control-plane replicas, three Organization-target workers, PostgreSQL, MinIO and adapter manager. Enabled A Organization `6a6ff0a1-b79e-4878-b4d5-231abc0a3808`, B `4651d76b-e0a2-4cb5-97d1-61fca6957e0c`, control C `f24343a6-9bbd-4628-bb36-1e62b8486a2e`. A/B canary, C off, crew false, tool surface null/off in rendered/running replicas. Realtime/admission store and component failure-domain runtime identities unresolved; no HA claim. Desktop artifact not applicable.

Known configuration SHA-256 values from candidate.json:

- Workflow: `2fdf666a39c93a0aa39042bc98717cb527a98d085ade788ebcb580a78b1d0e0b`
- Compose: `5320565a9324a0545a35b06f725f7b7e72c8cf016e36c3214abc5ce5461cf2c1`
- Journey: `8e9cb5854671315b6d6ad1fde04c44943088193d06ebc4ee1f4f09f2b8149d6c`

Complete execution-target/policy hashes unresolved. Source protocol recovery closes that narrow omission, not the provider build gap.

## Commands

| Command | Exit code | Duration | Result summary |
|---|---:|---|---|---|
| `gh run view 36187103782 --json createdAt,updatedAt,headSha` | 0 | not_recorded | Exact SHA and original campaign timestamps confirmed. |
| `gh api repos/MeteoriteLabs/AoA/actions/runs/36187103782/artifacts` | 0 | not_recorded | Bundle expires October 25, 2026, after 30 days. |
| `git show 446d99f39c8f8f9bece2138252fe48c839fbc7a6:docs/contracts/worker-protocol/v1/manifest.sha256` | 0 | not_recorded | Source protocol recovered. |
| PowerShell structured JSON parse of candidate, journey, flags and matrix verdict | 0 | not_recorded | Same-journey audit/cost corroborated; no raw logs accessed. |

## Review correction and applicability

McClintock P2 confirmed that the template's final clause requires individual scope, observed value and decision even for FAIL records. This successor preserves the immediate predecessor's known identity and observations verbatim below; inherited Commands describe that predecessor's review, not commands newly executed here. No artifact or campaign was newly measured by this successor.

H-01 through H-05 and H-07 apply to security/correctness within the historical partial tenant/workload topology. Untested surfaces are unproven, not exemptions. H-06 remains an unresolved partial-gate residual, not a HARD waiver. Full D1/D2 volume, two-worker D1 promotion, capability, HA and D4/D6 schedules are outside this partial certification scope; their full-lane thresholds are not silently imported. Applicable partial conditions are separately recorded below.

## Assertions and evidence

| Requirement ID | Class | Required value/condition | Observed value | Evidence | Result |
|---|---|---|---|---|---|
| `H-01` | HARD | Tenant isolation in this partial tenant set: zero unauthorized cross-Organization/Company reads, writes, deletes, disclosures, subscriptions, object-key, secret or provider access | Original 29 lists same-tenant-positive-control cross-tenant classifications and legacy query-predicate filtering; same-candidate suppression control and all H-01 access/disclosure surfaces not regraded here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1a-d2-mechanism-m1a-candidate-446d99f39c8f-a31.md); candidate-specific originals cited there | fail |
| `H-02` | HARD | Lease authority in exercised partial paths: zero accepted mutation/event/artifact/secret/checkpoint/completion/external effect from stale or replaced fence | Original mechanism observations include wrong-lease redemption probes; stale/replaced-fence mutation and effect census not established here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1a-d2-mechanism-m1a-candidate-446d99f39c8f-a31.md); candidate-specific originals cited there | fail |
| `H-03` | HARD | Single executor in partial topology: zero overlapping authoritative leases or simultaneously effectful service generations absent approved overlap | Three Organization-target workers are reported; zero overlapping authoritative leases/effectful service generations not established here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1a-d2-mechanism-m1a-candidate-446d99f39c8f-a31.md); candidate-specific originals cited there | fail |
| `H-04` | HARD | Secret containment: zero known canaries in envelopes, argv, URLs, events, logs, metrics, traces, browser artifacts, metadata, SQLite outboxes or QA artifacts | Predecessor preserves env/credential observations and an unresolved pending matrix redaction family; no all-surface H-04 secret-canary census regraded here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1a-d2-mechanism-m1a-candidate-446d99f39c8f-a31.md); candidate-specific originals cited there | fail |
| `H-05` | HARD | Sandbox boundary: zero host tenant commands; workers have no DB credential; control-plane replicas have no Docker/provider-control socket | Env probes report forbidden datastore credentials absent; zero host-executed tenant commands and absence of control-plane provider/Docker sockets not established here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1a-d2-mechanism-m1a-candidate-446d99f39c8f-a31.md); candidate-specific originals cited there | fail |
| `H-07` | HARD | Hosted exclusions: disabled public ingress, cloud-plugin execution and unsafe process-wide multitenant override remain impossible | Two rendered/running replicas report crew false and tool surface null/off; disabled ingress, cloud-plugin and unsafe multitenant refusal coverage not established here. Unproven, not certified; no measured product violation asserted. | [immediate predecessor](2026-09-27-m1a-d2-mechanism-m1a-candidate-446d99f39c8f-a31.md); candidate-specific originals cited there | fail |
| `EVID-01` | REQUIRED | Immutable provider/template and execution identity | Protocol recovered; template build and complete policy/target identity unresolved | candidate.json; exact tree | fail |
| `RET-01` | INITIAL | At least 180-day controlled raw evidence | 30-day CI expiry, local copy only; no verified archive custody/retention | Actions artifact API | fail |
| `H-08` | HARD | Approved verified images; roots and policy recorded | Test key sign/verify, SDK/endpoint and alias are insufficient for approval/provenance | candidate.json | fail |
| `H-09` | HARD | Zero provider resources at cleanup deadline/final reconciliation | Terminal/teardown success and preflight reconcile are not post-run resource absence; cleanup families pending | journey.json; reconcile-and-preflight.json; matrix | fail |
| `EVID-02` | REQUIRED | Append-only correction and requirement mapping | Original paths unchanged; this higher attempt links its historical predecessor | Git blobs and disposition inventory | pass |
| `EVID-03` | REQUIRED | Use normative stable IDs verbatim | This table uses EVID, RET and H IDs; predecessor SPINE-/MECH- labels are local aliases, not replacement normative IDs | `docs/replatform/test-gates.md` | pass |
| `EVID-04` | REQUIRED | Milestone QA path, exact SHA and higher attempt | Header and filename identify the historical candidate and allocated attempt | This record | pass |
| `H-06` | HARD | Deny metadata/private/control destinations for full promotion | Accepted partial-gate residual remains unresolved; no full-lane pass or waiver | Predecessor observations | recorded |
| `H-10` | HARD | Never hide or rewrite failed records | All ten originals retained; FAIL corrections appended | Git blob inventory | pass |

## Journey observations

A: run `e304c2d3-f652-4ad8-be69-08731319f4a3`, attempt `485147a7-fb39-4605-a34b-e74c21378fef`; B: run `0d8191bb-1846-4b8a-b87c-604698c935fb`, attempt `23e33a4f-9a2f-4bf1-895b-451815319817`. Both have one job.submitted row, started/terminal lifecycle rows, two applied activity receipts, one priced cost event (`costCents:1`, rateVersion 1) and one applied cost receipt bound to that tenant's accepted usage event. A cost event `3561ef59-2872-4ee0-918c-2690c4ca2f3e` binds usage `6edd4208-1609-419a-9c77-5b2901c0a2ff`; B cost event `60f07251-52d9-4db9-a27c-cc0cdf85c666` binds usage `57e94f32-0b82-4c77-85c4-a4d24823ec37`. securityDenials arrays remain empty; no denial-audit coverage inferred. Control C has zero distributed jobs; failed legacy CLI is not legacy health. capabilityProven remains false.

## Applicable partial-gate conditions

Labels below are descriptive traceability names, not substitute normative requirement IDs. Normative EVID/RET/H IDs remain in the assertion table. A recorded predecessor observation is not renewed independent certification; unresolved REQUIRED conditions continue to block pass.

| Partial condition | Class | Required condition | Preserved observation / decision | Result |
|---|---|---|---|---|
| Run and rehearsal binding | REQUIRED | Same-candidate keyed run and keyless suppressed control | Original mechanism 29 and predecessor 31 preserve keyed 36187103782; same-candidate keyless rehearsal/suppressed control not established by those records, not borrowed from f8 | fail |
| Required matrix and broader allocation | REQUIRED | Required cases fire/classify with zero violations; pending have kind/reason and no reported evidence | 17/17 required, 9 pending, complete false in original mechanism 29; broader cancellation/provider failure/reconciliation/cleanup/credential/redaction allocation unresolved. Pending count alone is not a blanket failure or exemption | fail |
| Partial F10 and cross-tenant controls | REQUIRED | A/B distributed, C refuses distributed, crew/tool off; cross-tenant probes and suppressed control | Original 29 reports A/B success, C no distributed job, and listed cross-tenant classifications; predecessor 31 records replica flags off. Same-candidate suppressed control not established here; does not certify H-01 entirety | fail |
| Journey audit and priced cost | REQUIRED | Same keyed journey operator-visible audit and priced-cost receipts | Predecessor 31: A/B submitted/started/terminal rows, two activity receipts each, costCents 1/rateVersion 1 with same-usage applied receipts; securityDenials empty | recorded |
| Credential environment and planted controls | REQUIRED | Allowed provider credential only; forbidden classes absent and planted controls red | Original 29 reports expected credential classes absent, allowed runtime credential present, and planted datastore/cross-tenant/provider mismatch controls red; no new measurement or all-surface credential certification | recorded |
| Standalone redaction / matrix coverage | REQUIRED | Planted canaries scrubbed on both streams; required matrix declarations respected | Original f8 28 reports standalone redaction probe; matrix redaction remains pending in 446d observations. No automatic pending-row promotion or comprehensive H-04 proof | fail |
| Capability | OBSERVED | Partial M1a capability value recorded | capabilityProven false; expected nonblocking partial observation | recorded |
| Partial teardown | REQUIRED | Stack, volumes, keypair/secrets and resource cleanup evidenced | Original teardown success retained; complete provider paths and deadline-bound resource census absent; H-09 fails | fail |

## Failures

Harness/evidence deficiency: attempt 29's PASS is withdrawn by this higher historical correction for unresolved immutable identity, RET-01 and H-08/H-09 evidence. Successful audit/cost improvements are retained; they do not amend historical scope or establish current-candidate certification. No actual compromise or resource leak is asserted.

## Cleanup

No resources created by this documentation review. Historical sandbox termination, object cleanup/quarantine and database cleanup are not certified by job success. Controlled local copies are not a 180-day archive. No raw logs enter Git.

## Gate effect

Formal FAIL, historical and nonpromoting. Does not satisfy M1a criterion 8 or clear any current candidate. No D1/D2/E6/E7/M1b capability, HA, release, cutover or milestone closure is granted. D4/D6 schedule/samples and desktop/mobility evidence are not applicable. A future candidate requires its own approved scope and exact-candidate evidence; this review authorizes no dispatch.

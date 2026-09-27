# PR610/PR615 Historical QA Disposition

**Date:** 2026-09-27. **Decision:** historical preservation and non-adoption; overall formal **FAIL**. This is not current-candidate clearance or a milestone handoff.

## Source and authority

Isolated branch `codex/m1a-historical-qa-disposition` starts at verified remote `docs/replatform-program` SHA `0510d482798e62672a8f6085915231c5f8578e87`. [PR610](https://github.com/MeteoriteLabs/AoA/pull/610) head is `f6e5dfc120f2749e6cbcad457e7eec6b9ea7a9c9`; [PR615](https://github.com/MeteoriteLabs/AoA/pull/615) head is `af3ca5ceb49f7bcb7d7012ab8f100d5e38894f1d`. These were unmerged historical proposals absent from the starting integration tree. Ten absent paths were restored mechanically from the exact PR615 head. All eight shared paths must match both heads.

The dirty user checkout and parent archive worktree were not edited. PR631 remains the parent's separate scope. No publication, external comment, branch deletion, PR closing, push, merge, campaign, AWS/Hubble, IAM, credential or signing work occurs here.

AGENTS, CLAUDE, locked decisions and roadmap were read. The QA template and candidate-time test-gates are the record contract. The 85 baseline immutable records comprise **69 QA records and 16 handoffs** under the guard's epic/milestone pattern; they are all protected, not merely a presumed 85-file QA subset.

## Original inventory

Paths below are relative to `docs/replatform/milestones/M1a/qa/`. Every blob is preserved at its original path; no corrected text is inserted into these files.

| Original filename | Git blob | Historical claim and audit |
|---|---|---|
| 2026-09-25-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a18.md | `0c48e733525bd8f9e135ce9d1ca106fbab153155` | PASS with artifact-only identity; superseded by original 19. |
| 2026-09-25-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a19.md | `e3da2fdacea1156cf8b6e4351d128d74add17685` | FAIL; unsupported evidence_identity class and false protocol-unavailable/aggregate-digest premise; superseded by original 20. |
| 2026-09-25-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a20.md | `871f9b5de8c44fc471c0eb671099a7284baa7ea5` | PASS; protocol recovered, assertion map missing; superseded by original 21. |
| 2026-09-25-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a21.md | `b575bbee8b3fc6f8f5ebb4307484ef1b8f3a9ca6` | PASS; map added but local SPINE IDs replace normative IDs, download treated as retention, SUCCESS treated as cleanup; corrected by new 24. |
| 2026-09-25-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a25.md | `1946fbd3c4778f2b3645ece277978b4a79864f52` | PASS; keyed audit/cost borrowed from D1, provider identity incomplete, broader mechanism coverage unresolved; superseded by original 26. |
| 2026-09-25-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a26.md | `6053ed394c2ea1569fc0d59c0e9409352ca83ee4` | FAIL with unsupported evidence_incomplete class; superseded by original 27. |
| 2026-09-25-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a27.md | `fe0de4162d6d8034eb7b6ef28d52ac458478a9ab` | FAIL/harness but identity deferred to future PASS; superseded by original 28. |
| 2026-09-25-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a28.md | `9829f550db25bdebe4b6ef62ddd834ae59cca860` | FAIL/harness with known identity; still overstated retention/cleanup and blanket pending rule; clarified by new 30. |
| 2026-09-26-m1-d1-spine-m1a-candidate-446d99f39c8f-a22.md | `27708d480781adf8c033e7ab5b18df1f7293e35f` | FAIL with invalid class/timestamps and no exact D1 run; corrected by new 25. |
| 2026-09-26-m1a-d2-mechanism-m1a-candidate-446d99f39c8f-a29.md | `a1763791e95c00db4a7a85e5dfdb44c0a6814b3a` | PASS; real audit/cost improvement but missing immutable build/protocol identity and compliant retention; corrected by new 31. |

The first eight blobs also equal the exact PR610 tree. Original cross-revision links remain untouched even where newer base records reuse ordinal 18, 22 or 25 at different candidates. Those collisions already exist in separate historical proposals; this preservation does not rewrite or unify their first commits.

## Allocation and conditional chains

All active remote branch trees were enumerated after fetching remote heads. Maxima: D1 **23** (current d479 record on docs/replatform-program and other active branches); mechanism **29** (unmerged `origin/codex/m1a-446d-fresh-qa`). Mechanism 26 is therefore not available. New allocations announced before commit:

| New attempt | Historical revision | Supersedes | Purpose |
|---|---|---|---|
| D1 24 | f8cdbe92e1cd | Original f8 D1 21 | RET-01, H-08/H-09 and normative-ID correction |
| D1 25 | 446d99f39c8f | Original 446d D1 22 | Schema/no exact D1 evidence correction |
| Mechanism 30 | f8cdbe92e1cd | Original f8 mechanism 28 | Identity/retention and candidate-time scope clarification |
| Mechanism 31 | 446d99f39c8f | Original 446d mechanism 29 | Withdraw historical PASS; preserve actual audit/cost improvement |

**Conditional chain rule:** these are higher global allocations but candidate-specific historical correction branches. D1 25 corrects original 446d 22, not f8 24; mechanism 31 corrects original 446d 29, not f8 30. The originals already link f8 to 446d; their historical transitions remain readable. No new record supersedes current d479 D1 23, changes its freeze, or supplies its evidence. The parent must recheck remote maxima before publication; if a higher ordinal appears, use a new higher correction rather than editing any first-committed record. Numbers are a read-only snapshot, not a global reservation service.

## Candidate-time scope audit

At both historical candidates, `docs/replatform/epics/E6-deployment-test-harness/implementation-plan.md` DEP-018 acceptance 1 contains the dated **2026-09-23 two-tier amendment** under F2: required cases must fire; pending cases require a kind/reason; reporting evidence for a pending case is a violation; complete remains false while pending remains. Thus **zero pending is not a blanket requirement for every partial gate**, and original 28's blanket completion inference overstates the checker contract.

However, candidate-time `docs/replatform/epic-regrooming/scope-triage.md` and DEP-018's gate allocation still name cancellation, provider failure, reconciliation and every cleanup path for mechanism. Nine pending families include cancellation, provider failure, live-lease reconciliation, three cleanup paths, two credential cases and redaction. These are not automatically all mandatory merely because pending, nor all optional merely because the required matrix passes. Required-set success proves 17 rows, not the broader unexecuted mechanisms.

No candidate-time approval removing/reallocating those broader historical promises was established by this bounded audit. Current approved **17 required/9 pending** freezes at 28151/d479 are later candidate-specific authority and cannot be transplanted into f8/446d. This disposition does not invent a retroactive amendment or resolve that historical governance question by changing code/docs. Identity/retention failures independently settle the formal FAIL even if a gate owner later resolves the coverage ambiguity.

The redaction narrative is also internally uneven: original 28 reports a fired standalone planted-canary probe while the retained 446d matrix still has a pending redaction family. A standalone probe does not silently promote a pending matrix row. Credential/runtime env observations are preserved without claiming all broader credential cases were run.

## Normative-ID and final-successor audit

EVID-01/02/03/04 and RET-01 apply to the partial record format. EVID-03 requires normative IDs verbatim: SPINE-EVID-01 maps to EVID-01, SPINE-EVID-RETENTION/MECH-EVID-RETENTION to RET-01, SPINE-/MECH-H06 to H-06, and cleanup claims must distinguish partial resource teardown from H-09. Run/matrix/F10/audit/cost/rollback labels are local traceability labels for the approved partial scope, not newly invented test-gates IDs.

McClintock's independent P2 review confirmed that all four first corrections omitted individual H-01 through H-05 and H-07 scope/observation/decision rows required by the QA template's final clause. FAIL provides no exemption from that clause. Those four records are immutable and remain untouched; four higher successors now supply the missing rows and applicable partial conditions. Each unproven invariant is FAIL, not certified or an asserted measured product violation. Full D1-00 through D1-07, D2-01 onward, full D0 rollups, D4/D6 SLIs, HA and capability thresholds are not blindly imposed on this partial historical gate. H-06 remains an unresolved residual, never a HARD waiver. H-08 provenance approval and RET-01 custody are separate from successful execution; H-09 resource absence is separate from workflow SUCCESS.

### Bounded review-correction allocation

Starting author head: `916020c0d564527618f192fff280f584dc13f45c`; pinned base remains `0510d482798e62672a8f6085915231c5f8578e87`. Remote heads were rechecked read-only and fetched locally on 2026-09-27; local branch and origin trees (589 unique tips, including retained remote-tracking refs) have maximum D1 25 and mechanism 31. This author alone writes this wave; allocation remains a snapshot to recheck before publication.

| Current successor | Exact candidate prefix | Immediate candidate-specific predecessor |
|---|---|---|
| [D1 26](qa/2026-09-27-m1-d1-spine-m1a-candidate-f8cdbe92e1cd-a26.md) | f8cdbe92e1cd | D1 24 |
| [D1 27](qa/2026-09-27-m1-d1-spine-m1a-candidate-446d99f39c8f-a27.md) | 446d99f39c8f | D1 25 |
| [Mechanism 32](qa/2026-09-27-m1a-d2-mechanism-m1a-candidate-f8cdbe92e1cd-a32.md) | f8cdbe92e1cd | Mechanism 30 |
| [Mechanism 33](qa/2026-09-27-m1a-d2-mechanism-m1a-candidate-446d99f39c8f-a33.md) | 446d99f39c8f | Mechanism 31 |

All four remain formal FAIL. Their known identity and prior measurements are carried as attributed historical observations; inherited command tables describe predecessor reviews, not fresh campaign execution. Partial-gate rows retain matrix/F10/worker/control/audit/cost/rollback/credential/redaction/capability/teardown conditions where applicable; unknowns fail rather than borrow another candidate's data. Parent owns PR631 and the fresh independent McClintock rereview. The resulting local commit identifies the current document head; this document does not claim runtime evidence at that head.

## Review comment mapping

Every inline review comment returned by the PR610/615 comment APIs was checked against the final originals (f8 D1 21/mechanism 28; 446d D1 22/mechanism 29), not just the initially criticized file.

| Comment | Final-original disposition | New handling |
|---|---|---|
| [610 / 4106975393](https://github.com/MeteoriteLabs/AoA/pull/610#discussion_r4106975393) incomplete mechanism | Original 28 failed, but blanket zero-pending premise conflicts with candidate-time two-tier amendment | Mechanism 30 and scope audit distinguish required rows from broader unexecuted scope |
| [610 / 4106975399](https://github.com/MeteoriteLabs/AoA/pull/610#discussion_r4106975399) keyed audit/cost | Original 28 correctly retains empty audit/zero priced cost; D1 cannot substitute | Mechanism 30 FAIL; 446d improvement separately corroborated in 31 |
| [610 / 4106975407](https://github.com/MeteoriteLabs/AoA/pull/610#discussion_r4106975407) D1 identity | Original 21 records images/protocol/config; original 18 deficit repaired in successors | D1 24 carries known identity without inventing remaining fields |
| [610 / 4106975413](https://github.com/MeteoriteLabs/AoA/pull/610#discussion_r4106975413) mechanism identity | Original 28 records known identity but explicitly lacks template/service/complete target identity | Mechanism 30 FAIL |
| [610 / 4107040633](https://github.com/MeteoriteLabs/AoA/pull/610#discussion_r4107040633) recover protocol | Original 20/21 repaired false unavailability; no aggregate topology digest required | Both exact candidate manifests re-read; all corrections retain recovered hashes |
| [610 / 4107040638](https://github.com/MeteoriteLabs/AoA/pull/610#discussion_r4107040638) class enums | Original 21 none and 28 harness repaired final class; original invalid files preserved | New failures all harness |
| [610 / 4107099087](https://github.com/MeteoriteLabs/AoA/pull/610#discussion_r4107099087) assertion map | Original 21 added table, but normative IDs/RET/cleanup claims remain deficient | D1 24 FAIL and normative rows |
| [610 / 4107099095](https://github.com/MeteoriteLabs/AoA/pull/610#discussion_r4107099095) failed-record identity | Original 28 fixed known-value omission, not unknown build | Mechanism 30 preserves known/unknown identity explicitly |
| [615 / 4111343413](https://github.com/MeteoriteLabs/AoA/pull/615#discussion_r4111343413) pending scope | Original 29 asserts acceptance without establishing historical broader-scope amendment | Mechanism 31 FAIL; candidate-time audit acknowledges two-tier amendment |
| [615 / 4111343415](https://github.com/MeteoriteLabs/AoA/pull/615#discussion_r4111343415) immutable identity | Original 29 lacks protocol and template build; SDK/alias insufficient | Protocol recovered, build unresolved; mechanism 31 FAIL |
| [615 / 4111343419](https://github.com/MeteoriteLabs/AoA/pull/615#discussion_r4111343419) D1 metadata | Original 22 still nonconforming | D1 25 uses harness and not_applicable |
| [610 owner disposition](https://github.com/MeteoriteLabs/AoA/pull/610#issuecomment-5855746169) | Unmerged preservation pending, distinct from current candidate/PR631 | Ten exact blobs and appended FAIL corrections; no external closure |
| [615 owner disposition](https://github.com/MeteoriteLabs/AoA/pull/615#issuecomment-5855746346) | No asserted PASS adoption or later evidence borrowing | Same historical non-adoption; no external closure |

## Evidence and verification boundaries

Read-only Actions metadata confirms f8 D1 artifacts expire **2026-10-09**, 14 days after creation; 446d keyed artifact expires **2026-10-25**, 30 days after creation. Neither proves RET-01's >=180 days. Local Temp JSON copies are availability for this audit only, without controlled archive locator, policy/custody or retention proof.

446d structured journey JSON confirms both enabled attempts' submitted/started/terminal audit rows, two applied activity receipts each, priced cost rows (1 cent each, rateVersion 1), and applied cost receipts bound to the same usage event. Both securityDenials arrays remain empty. Preflight reconciliation precedes execution and does not establish deadline-bound final resource cleanup. No raw log or secret content enters this branch.

Exact-head Actions query for 446d returned four runs, none D1. This establishes the inspected inventory, not an assertion that every possible historical execution is absent. No later candidate or mechanism images are borrowed as D1 evidence.

Validation: original raw blobs against PR615 and eight shared PR610 blobs; all 85 baseline immutable blobs; docs-only additions and whitespace; new metadata/path/attempt/supersedes and normative assertion checks; existing evidence-immutability guard against pinned base. Author performs a separate self-review; parent's independent review and exact-head docs CI remain publication prerequisites. Runtime typecheck, full tests and build are not run for this docs-only branch with no dependency installation. No remote CI is dispatched here.

# Local + VPS Validation Pickup Checklist

**Latest adapter follow-up (18 October):** [W02 adapter report](../reports/2026-10-18-w02-adapter-variants-report.md), [completed/pending checklist](2026-10-17-w02-w05-handoff.md) and [portable evidence](../evidence/2026-10-18-w02-adapter-variants-summary.json), application `5a2ed274c` on `codex/replatform-w02-w05`. Confirmed offline adapter repairs pass targeted local/VPS verification; the VPS is rebuilt with DB/OAuth/history retained. Real subscription/API-key/vendor-CLI qualification is skipped at the user's request, not closed. Historical F01–F09 verdicts below remain unchanged.

**Latest follow-up (18 October, bounded remaining W02):** [authority/audit/graceful-shutdown report](../reports/2026-10-18-w02-authority-audit-shutdown-report.md), [updated completed/pending checklist](2026-10-17-w02-w05-handoff.md) and [portable evidence](../evidence/2026-10-18-w02-followup-summary.json), branch `codex/replatform-w02-w05`, application `4282a6b33`. Core authority/revocation, curation mutation audit and graceful local-child drain now pass targeted local/VPS verification. Durable abrupt-crash custody is explicitly deferred by user choice; native adapter variants and W05 live output acceptance remain open. Historical baseline/F01–F09 verdicts below are not rewritten.

**New stacked follow-up (17 October, W02/W05):** bounded implementation/targeted local and rebuilt-VPS verification is now on `codex/replatform-w02-w05`; see its [report](../reports/2026-10-17-w02-w05-targeted-report.md), [completed/pending checklist](2026-10-17-w02-w05-handoff.md) and [portable evidence](../evidence/2026-10-17-w02-w05-summary.json). Native Steward prompt/provenance/cost/tool-name and same-process cancellation fixes, artifact fixtures and explicit export-origin configuration are covered. Full W02/W05 acceptance and original F06–F09 investigations remain open. Baseline-branch observations below remain historical, not relabeled as this follow-up's candidate.

**Latest pickup (17 October, F05 repair):** [startup fix and actual onboarding report](../reports/2026-10-17-f05-startup-fix-report.md), [portable evidence](../evidence/2026-10-17-f05-startup-fix-summary.json), tested code `64fbe0471`. **F05 bounded Windows built-workspace startup now passes**, with 13 focused CLI tests, fresh-home doctor/server/UI, persisted onboarding through environment setup and owned cleanup. No whole suite or VPS rebuild. The [preceding local/VPS report](../reports/2026-10-17-f01-f05-live-retest-report.md) retains F01–F04 observations on `6ebc400d2`; its historical F05 failure is preserved. Strict F01 subprocess provenance, separately prerequisite-bound live cases, broader native acceptance and UI reconciliation observations remain open.

- **Branch:** `codex/replatform-baseline-w00-w04`
- **Original tested baseline:** `05522b0f22e9df84ddfa6d3444d0362e4ad8a6cd`
- **Latest F05 local code candidate:** `64fbe0471579535c776df769ce471c46f2482f42`; report/evidence linked above. Latest broader local/VPS candidate remains `6ebc400d2fd4c4cf26b90d2c1d6466171d08f3e9`.
- **Prior live retest:** `fe3db70fe`; [immutable 16 October report](../reports/2026-10-16-f01-f05-live-retest-report.md) and [evidence](../evidence/2026-10-16-f01-f05-live-retest-summary.json).
- **Source of truth for this attempt:** [validation report](../reports/2026-10-16-local-vps-validation-report.md) and [portable evidence summary](../evidence/2026-10-16-local-vps-validation-summary.json).
**Status:** Mutable coordination checklist. The latest F05 application fix is committed separately from its documentation publication; earlier validation-only work did not implement application fixes.

**Current pickup:** F05 startup is repaired and verified within the local built-workspace boundary. F03 retains its bounded pass; F01/F02/F04 retain named evidence/prerequisite gaps and observations. F06–F09 remain qualified investigations. Full engine/crew/packed-install acceptance is not inferred from usable onboarding. Original reports and failures are not rewritten.

Checked items mean the stated implementation observation or verification happened, **not** that an entire W package or release gate passed. F01–F09 are handoff labels, not newly filed repository tickets or assigned owners. Priorities are triage suggestions. Recheck current HEAD and superseding fixes before starting; keep each fix focused and attach its regression test and new-candidate evidence. This checklist is not fresh authority for infrastructure changes, credential transfer, paid calls or rollout flags.

## Latest F05 repair completed / verified — 17 October

- [x] Real PDF/native canvas regression fails before the change with the original `DOMMatrix`/namespaced built-in error, then passes after replacing scoped import with workspace-only unscoped registration and ordinary built-server import.
- [x] Exact code candidate `64fbe0471`: only two CLI files / 13 tests pass, no skips; CLI typecheck/build pass. Source/installed resolution, missing-build/dependency guidance and no-fallback boundaries remain covered. No whole-suite run.
- [x] Actual plain Node onboarding in a fresh owned home: nine doctor checks, fresh embedded PostgreSQL/migrations, healthy exact-candidate server/static UI, dummy profile/organization/company and owned environment verification. Reload retains Step 5 of 8.
- [x] Owned PostgreSQL and process-tree termination exit 0; no observed owned processes/listeners remain. Retained native review app stays healthy. Private home/config/secrets excluded; VPS untouched.
- [ ] Separately verify packed/installed onboarding, a pristine reinstall/root-build repeat or all eight engine-authenticated wizard/crew steps if that broader acceptance is requested. This bounded repair reused unchanged frozen server/UI artifacts and rebuilt the CLI only.

## Prior broader retest completed / verified — 17 October

- [x] Matched origin and both rebuilt review-app revisions at `6ebc400d2`, preserving DB/history and QAN-1/QAN-2; no full reset, rollout change or auth transfer.
- [x] Targeted **13 changed files only**: Windows 203 pass / 47 skip, exit 0. VPS initial 249 pass / 1 timeout, exit 1, retained; isolated CLI and same-selection serial reruns pass, latter 250/250. Timeouts/assertions unchanged; initial cause unproven.
- [x] Frozen installs, authoritative builds and four affected-package typechecks passed on both hosts. No whole-suite or all-package typecheck repeat.
- [x] Native real verify and one extraction produced two useful persisted review items; no approval/Git-preflight error. Strict raw child exit/model capture remains unavailable, not invented.
- [x] New native canonical choice appears immediately, unanswered survives reload, answered stays dismissed after reload/switch/back; old legacy behavior distinguished correctly.
- [x] One separately approved QAN-3 is Planning/Backlog/Unassigned/Not started with no execution-run link. Consumed confirmation replay returned 404 with identical task arrays.
- [x] VPS attachment-bearing denial/reload/retry retained one user row/submission and frozen attachment/context, with two legitimate failed-attempt receipts and null model/provider. Run History agrees; old missing metadata has explicit unavailable-Retry guidance. Edit/Discard/keyboard-draft behavior observed.
- [x] F05 nine doctor checks pass, but actual raw built startup exits 1 at scoped-loader PDF/canvas initialization. Reduced direct import passes / scoped import fails. Owned diagnostic teardown leaves no app/DB processes/listeners.
- [x] Incidental automatic native thread.controller run and live duplicate-text observations are recorded rather than hidden. No claim of zero background agent activity, W02 closure or duplicate execution.

## Prior retest completed / verified — 16 October (historical)

- [x] Matched origin at `fe3db70fe`, rebuilt/upgraded both owned review apps while preserving databases/history, and retained exact-candidate health/artifact receipts.
- [x] Pinned frozen installs, authoritative builds, **16 targeted files / 236 tests on each host**, and shared/server/UI/CLI typechecks passed. This was not another full-suite or all-package typecheck run.
- [x] Native real hello/verify and Commander turns succeeded with inherited `gpt-5.6-sol`; saved model selections remained null. Crew stayed paused, with no task agent run started.
- [x] Cloud negative-boundary persistence now records failed outcome/error and null model/provider/summary; send/reload retained one failed user turn/run. The remaining UI gap is F02 below.
- [x] **F03 passed:** QAN-2 persisted as Planning/Backlog/Unassigned/Not started with no execution-run link after separate Allow once approval. Consumed-approval replay returned 404 and left tasks identical. QAN-1 remains unchanged.
- [x] F04 conversational intent remained separate from runtime approval. Legacy/canonical persisted choices render; full streaming/dismissal acceptance is still red below.
- [x] F05 original zod error no longer reproduced; all nine doctor checks passed. Separate TS-loader diagnostic reached healthy exact candidate; raw command remains blocked and diagnostic UI check failed in the scratch runner. Owned diagnostic process/listener cleanup verified.
- [x] Published sanitized observed values and finalized raw-file hashes with the new report; no raw auth/config/runtime homes, credentials or production source edits included.

## Original baseline completed / verified (historical)

- [x] Pulled and tested the named branch; tested application matched origin at `05522b0f2` on the final verification. W00/W01/W03/W04 implementation was present per the existing completion plan.
- [x] Fresh frozen Node 24.19.0 / pnpm 9.15.4 installs, root builds and recursive typechecks passed on Windows x64 and Linux ARM64. Global local tools preserved.
- [x] Capture self-tests executed: Windows 6 pass / 2 Linux-only skips; Linux 8 pass. Native streams/exits retained, unavailable capture counters left unknown.
- [x] Complete 149-test startup/PostgreSQL/ACL file passed on both hosts, including opted-in native Windows integration. This does not close the separate residual-process finding F09.
- [x] Focused regressions executed: Windows 252 pass / 1 fail; Linux 253 pass. Normal full suites executed: Windows 24,360 pass / 3 fail / 2,132 skip plus one unhandled error; Linux 26,414 pass / 81 skip, exit 0. **That original Windows attempt remains red; it is not the corrected candidate's verdict.**
- [x] Three Windows full-lane failure files passed 55/55 in quiet isolation; corrected artifact diagnostic passed 34/34. Original failures remain open, not waived by reruns.
- [x] Exact-source deterministic Docker spine 10/10, verdict controls 129/129 and Linux slot/ownership fixtures 2/2 passed.
- [x] Fault profile executed with 25/26 Windows-runner passes; selected Linux-only expired-enrollment case passed on a real Linux runner. No complete Linux profile verdict claimed.
- [x] Native CLI/full-schema restore engineering fixtures passed 2/2, including positive execution of nested native restore and database/object recovery checks. No expanded-staging recovery claim.
- [x] Native inherited-model catalog, onboarding/hello, persisted Commander reply and durable Scout reply passed with saved model selections NULL and isolated Codex 0.145.0; no model override or API-key fallback.
- [x] Real cloud Google sign-in, onboarding and planning-task create/update/reload passed. Real E2B transport smoke passed five bounded checks and sandbox absence was verified after deletion.
- [x] User retry created native `QAN-1`; unassigned, backlog, not started, no execution-run link. **Its Standard mode is a failure of the requested Planning mode**, tracked in F03. Raw approval text remains F04; the earlier 503 is preserved as a recovered historical observation, not a proven deterministic product defect.
- [x] Retained review apps/dummy data, paused native crew, cleaned disposable fixtures/unused auth copies, removed temporary E2B process credential and verified healthy apps. No secrets/auth homes/raw runtime archives committed.

## Pending fixes and investigations

The [live retest report](../reports/2026-10-16-f01-f05-live-retest-report.md) supplies reproduction steps, source-path investigation pointers, QA entity IDs and evidence limits. All statuses below are for the named candidate, not an inference about later commits.

### F01: Useful extraction works; strict provenance/native journey still pending

**Priority:** P1 acceptance evidence. **Related work:** W01 / TST-008.

- [x] Real pinned-CLI verify and actual non-Git temporary-directory extraction passed the prior approval/Git refusal points on `6ebc400d2`.
- [x] Discussion `cf032493-3779-4271-8635-e62f2f59bacd`, entry `883aac26-6db2-4677-8cf1-20ab0e210094`: completed, useful task and decision persisted and visible in saved UI; left pending review.
- [ ] Retain an actual raw child exit/resolved-model receipt on a separately scoped attempt before claiming strict provenance closure. The completed entry is not a fabricated numeric exit or model receipt.
- [ ] Complete the broader native TST-008/crew journey. One incidental automatic `thread.controller` run completed despite saved `crewPaused=true`; preserve its audit and investigate pause/event-controller semantics before drawing a defect or W02-acceptance conclusion.

### F02: Bounded VPS failure recovery/retry passed; extended live cases pending

**Priority:** P1 remaining acceptance/scope. **Related work:** Commander failure handling / W01 provenance.

- [x] New attachment-bearing request fails honestly; after reload/reopen, actionable refusal and Retry/Edit/Discard appear. Run History agrees and unobserved model/provider stay null.
- [x] Retried original submission `e9741e23-e20f-4cbc-bb76-3e47fb6f59a5` once: same user row/content/context/asset ID, two legitimate failed attempt receipts, no duplicate durable user turn, active execution or provider/host fallback.
- [x] Old failed chat explains missing exact-retry metadata; no guessed attachments/context. Edit restores original draft/reference, Discard stays dismissed across chat switch/back, and real keyboard typing dismisses stale recovery without sending a new request.
- [ ] Independently exercise accepted distributed failed-attempt retry and stale-running rejoin with original message/run/job/attempt authority. No disposable accepted distributed setup was available; do not provision/spend/enable rollout merely to green this case.
- [ ] Complete live other-owner/company scope and precisely controlled refetch/race cases if full acceptance is required. Passing deterministic tests are not equivalent to those live cases.
- [ ] Investigate repeated user text during live Retry reconciliation if retained as a UI defect: saved reload collapses it and DB always contains one user row. Do not describe this as duplicate paid execution or hide it with an extra retry.

### F03: Planning creation — fresh bounded pass

**Priority:** P2. **Related work:** task-tool contract / native useful-tool journey.

- [x] On `6ebc400d2`, QAN-3 (`b45f4166-226b-4d2a-84b6-f13be85a182e`) persists explicit Planning/Backlog/Unassigned/Not started with no execution-run link after separate Allow once.
- [x] Before approval only QAN-1/QAN-2 existed. Consumed confirmation replay returns 404 with identical task arrays. Old QA tasks remain unchanged.
- [x] **Bounded case passes on this candidate**, not whole native TST-008/W02 or release acceptance.

### F04: Native choices/approval/reload passed; distributed delivery pending

**Priority:** P2. **Related work:** Commander UI/protocol.

- [x] Actual Codex summary stream renders canonical buttons immediately, retaining surrounding text; no reload workaround.
- [x] Unanswered choice survives reload; answered choice stays dismissed after reload and chat switch/back. Historical answered/unanswered legacy cases remain distinguishable.
- [x] Choice sends intent only; a distinct Allow once card gates one Planning task. Card survives the completed turn's history fetch; consumed replay cannot duplicate its effect.
- [ ] Exercise OPTIONS-only and text-plus-OPTIONS accepted distributed delivery/result recovery under separately authorized prerequisites. Native/parser/UI tests do not close this persistence case.
- [ ] Complete pending-card cross-company live switching/malformed-marker cases if full acceptance requires them; deterministic coverage is not mislabeled as live inference.
- [ ] Record/reproduce repeated assistant narration during live pending-card reconciliation separately from authority: one card and one side effect were observed; reload removes repeated transient text.

### F05: Bounded Windows raw built startup repaired and verified

**Status:** Complete for the bounded startup finding on `64fbe0471`; [fresh report](../reports/2026-10-17-f05-startup-fix-report.md) and [evidence](../evidence/2026-10-17-f05-startup-fix-summary.json). Not full installed-distribution or engine/crew acceptance.

- [x] Original zod/source-export errors no longer block the raw command; fresh configuration and all nine doctor checks succeed.
- [x] Real-dependency-graph executable regression reproduces the original DOMMatrix/namespaced `node:os` failure before the repair; passes after it. The prior actual-startup failure remains in the immutable earlier report.
- [x] Fresh-process ordinary PDF import exits 0, scoped `tsImport` exits 1, unscoped registration plus ordinary import exits 0.
- [x] Repair workspace launch without an external loader workaround; focused regressions preserve source development and installed resolution boundaries.
- [x] Repeat actual raw-command doctor/startup/exact-candidate health/usable onboarding UI/owned cleanup. Dummy setup through environment verification persists after reload at Step 5 of 8. No engine inference was requested.
- [x] F05-owned processes/listeners are gone; generated private home/config/secrets are excluded from publication.
- [ ] Real packed/installed onboarding, pristine reinstall/full-root-build repeat and complete engine/crew journey remain separate unexecuted acceptance. Transient post-company wizard-step reset and non-blocking startup warnings are retained observations, not declared fixed.

### F06: Long custom Windows auth home — investigation, default paths unproven

**Priority:** P2. Not an independently confirmed current-candidate production defect.

- [x] Located historical exact SQLite initialization stderr, child exit 1 and failing nested auth path on the original PC. The portable retest summary includes sanitized excerpts and original-file hashes: failing home length 248 versus successful short-home diagnostic 210.
- [ ] Independently reproduce with the pinned CLI/account and capture supported/default versus custom path behavior. The comparison does not establish causation or default-path failure.
- [ ] Only after establishing cause, define/fix or constrain the supported path contract and add Windows coverage without weakening owner/company isolation or credential custody.

### F07: Artifact race/unhandled rejection — test investigation first

**Priority:** P1 triage, **production defect unproven**. Related work: W05 / TST-013.

- [ ] Establish upload entry before racing destroy/export; a destroy-first `ResourceNotAvailableError` can be legitimate. Start in `packages/adapter-manager/src/__tests__/server-artifact-export.test.ts`.
- [ ] Attach rejection observation immediately to queued promises; investigate whether late handler attachment explains the reported unhandled rejection.
- [ ] Distinguish a fixture/timing defect from a runtime defect with retained ordering/error evidence. Repair only a demonstrated cause, preserve error semantics and prevent late artifact promotion; do not merely broaden expectations.
- [ ] Verify the corrected reproducer/interacting lane has no unhandled errors. Isolated passes do not establish a production fix; separate live W05 acceptance remains deferred.

### F08: Historical Windows full-lane failures — causes unresolved

**Priority:** P2. Later engineering full-suite/affected-file passes are separate evidence, not proof of an original root cause.

- [ ] Recover diagnostics for the AST and exhaustive IPv4 timeouts in `job-leasing-contract.test.ts` and `w13-oauth-deny-table-divergence.test.ts` if further investigation is required; preserve assertions.
- [ ] Obtain the original failing address/port for `packages/adapter-manager/src/__tests__/component.test.ts` before attributing it to restricted ports. Resource-load/restricted-port explanations remain unsupported.
- [ ] Only repair demonstrated fixture/scheduling causes. The latest engineering full Windows suite is reported green; this retest ran only the documented 16-file selection, not another complete lane.

### F09: Historical residual PostgreSQL incident — attribution unproven

**Priority:** P2. Reported cleanup incident, not an established production defect.

- [ ] Recover original process ownership, creation/parent identity, command line and fixture-port records before assigning attribution/cause.
- [ ] Exercise owned normal/timeout/abort/failure teardown and explicitly observe process termination; swallowed stop errors and passing assertions alone cannot certify cleanup.
- [ ] Repair only a demonstrated cause, without blanket PostgreSQL/Node kills or global Docker prune. This retest's clean owned diagnostic teardown does not disprove the original incident.

## Acceptance still pending / prerequisites

- [ ] Close native TST-008 only after extraction and requested task semantics pass; separately finish W02 actual useful background tool/task effect, cancellation and restart evidence. A Scout reply or completed empty run row is not full W02 closure.
- [ ] If a full Linux D1 fault-profile claim is required, run the **entire** profile on a Linux runner against the selected candidate. A selected expired-enrollment rerun is insufficient.
- [ ] Provision/authorize a supported cloud Company model credential and execution context before claiming positive cloud inference. Do not reuse removed temporary credentials, transfer a personal auth home to the VPS or substitute a paid provider.
- [ ] Follow the existing completion plan for W05–W18, including separately enrolled single-authority cross-host output, device credential/revocation, provider network, service/realtime, capacity and fleet journeys. These are not implicitly implemented by this branch or this checklist.
- [ ] Keep expanded-staging external-store/replica prerequisites and calendar-bound D4/D6 campaigns separate. Two review hosts and deterministic smokes do not satisfy 72-hour/14-day gates or authorize desktop/mobility exposure.

## Next-agent workflow and exit evidence

1. Read the latest retest report and portable evidence above, `CLAUDE.md`, locked decisions and the completion plan; select/coordinate ownership of one finding and check for superseding changes. Inspect available local/VPS resources rather than assuming retained services/credentials still exist.
2. Add a reproducing test, implement the focused fix, and retain before/after evidence. No application fix is already hidden in this documentation commit.
3. Use isolated Node 24.19.0 / pnpm 9.15.4. Start with the exact failing files; run interacting lanes and the required root typecheck, test and build checks before claiming a repaired candidate. For real Windows DB integration use `AOA_RUN_WIN_INTEGRATION=1` and disposable PostgreSQL resources.
4. Capture full native stdout, stderr, exit, counts/skips, unhandled errors, candidate SHA and actual execution location; use a **new** capture directory/attempt. For example, `node scripts/run-vitest-captured.mjs --capture-dir <new-attempt> -- run <selected-files>`; consult existing scripts for opt-ins rather than assuming mocked/skipped runs are live evidence.
5. Publish a new same-candidate report with a backward `Supersedes` reference where applicable; preserve original failures and immutable report/evidence records; this pickup checklist is mutable. Check off a finding only with linked regression/fresh acceptance evidence. Do not mark whole W packages or release acceptance green from isolated passes.

# Local + VPS Validation Pickup Checklist

**Remaining-gap engineering follow-up:** The [repair plan](2026-10-16-f01-f05-followup-repairs.md) addresses F01's non-Git extraction preflight, F02's saved failed-user/retry recovery, both F04 stream/history paths and F05's raw built workspace launch contract. The [next-candidate live checklist](2026-10-16-f01-f05-live-retest.md#next-candidate-remaining-gap-acceptance) specifies fresh evidence required after these repairs. The unchecked live requirements and the immutable retest below remain open until that separate attempt is executed; F03's earlier bounded pass stands.

- **Branch:** `codex/replatform-baseline-w00-w04`
- **Original tested baseline:** `05522b0f22e9df84ddfa6d3444d0362e4ad8a6cd`
- **Latest live retest candidate:** `fe3db70fea7fd4413429bc92d81b56ea67ccd386`; [retest report](../reports/2026-10-16-f01-f05-live-retest-report.md) and [portable retest evidence](../evidence/2026-10-16-f01-f05-live-retest-summary.json).
- **Source of truth for this attempt:** [validation report](../reports/2026-10-16-local-vps-validation-report.md) and [portable evidence summary](../evidence/2026-10-16-local-vps-validation-summary.json).
**Status:** Mutable coordination checklist; no application fixes were implemented by the validation/documentation work.

**Current pickup:** F01–F05 engineering fixes and their full Windows/CI checks are recorded in the [engineering verification record](../reports/2026-10-16-f01-f05-engineering-verification.md). The subsequent exact-candidate live retest now establishes **F03's bounded Planning case passed**, but **F01 extraction, F02 saved-chat failure guidance, F04 streaming/answered-choice hydration and F05 full built onboarding remain open**. F06–F09 are qualified investigations, not established production defects. The original validation report is unchanged; checked history below does not replace current-candidate evidence.

Checked items mean the stated implementation observation or verification happened, **not** that an entire W package or release gate passed. F01–F09 are handoff labels, not newly filed repository tickets or assigned owners. Priorities are triage suggestions. Recheck current HEAD and superseding fixes before starting; keep each fix focused and attach its regression test and new-candidate evidence. This checklist is not fresh authority for infrastructure changes, credential transfer, paid calls or rollout flags.

## Latest retest completed / verified

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

### F01: Native extraction trusted-directory preflight

**Priority:** P1. **Related work:** W01 native acceptance / TST-008.

- [x] Engineering corrected the root approval-option placement; real verification passed and the actual extraction no longer failed on the original unsupported argv.
- [ ] Correct the next demonstrated blocker: isolated temporary-directory extraction exits 1 with `Not inside a trusted directory and --skip-git-repo-check was not specified.` Preserve read-only sandbox, scoped auth and inherited model; no API fallback.
- [ ] Add a regression reaching the supported CLI's real preflight, then repeat one actual extraction and verify useful persisted items. Failed QA entry `6eea9934-6818-4df8-b0c7-d58f77a9a526` is retained.
- [ ] Complete native TST-008 only after extraction and the remaining journey evidence pass; new Scout/crew acceptance was not executed in this retest.

### F02: Cloud failure guidance lost on saved-chat reload

**Priority:** P1. **Related work:** Commander failure handling / W01 provenance.

- [x] Initial no-provider send visibly refused unsupported cloud execution. Durable run `aa97d1f9-e793-4abc-acb1-7ceae2f94be7` is failed with error text and null model/provider/summary; no false completion or shared-host execution.
- [ ] Restore actionable refusal/error and retry controls after reload/reopening saved chat. The new chat currently shows only the failed user's message, despite the correct failed run.
- [ ] Cover failed-user-turn/run hydration, not just failed assistant messages or transient failed-send state. Investigate `InternalAgentPanel.tsx` saved-conversation loading.
- [ ] Retest retry/rejoin using the original submission identity and prove no duplicated run/side effect or host fallback. UI retry was unavailable after reload; this requirement is **not passed**.
- [ ] Keep this negative boundary independent of positive cloud inference. Do not enable unsandboxed multi-tenancy or introduce a personal-host credential fallback to evade the refusal.

### F03: Planning creation — bounded live case passed

**Priority:** P2. **Related work:** task-tool contract / native useful-tool journey.

- [x] Explicit `workMode=planning` survived governed approval and persisted on exactly one new QAN-2 (`c63290a6-16ee-4d95-8af4-7c2473f4b37f`).
- [x] Reloaded UI showed Planning, Backlog, Unassigned and Not started; no execution-run link or task dispatch was observed.
- [x] Conversational choice alone created nothing; Allow once was separate. Replaying that consumed confirmation returned 404 with identical before/after task arrays.
- [x] Existing Standard-mode QAN-1 was not converted or duplicated. **F03 is closed for this bounded retest**, not whole native TST-008 or W02 acceptance.

### F04: Codex streaming choices and answered-choice hydration

**Priority:** P2. **Related work:** Commander UI/protocol; two demonstrated remaining gaps.

- [x] Historical legacy and new canonical payloads render as choices when loaded from persistence. Selecting a choice sends intent; a distinct durable runtime approval gates the single task creation.
- [ ] Parse canonical OPTIONS on the actual Codex summary stream: the original response displayed literal markup, with buttons only after reload. Investigate `cli-mode.ts:2069` (`parsed.summary` yielded directly as text).
- [ ] Keep answered choices dismissed after reload/reopening an explicit saved conversation. The Create button reappears above the recorded user answer and successful creation. Investigate `InternalAgentPanel.tsx:979` history mapping versus its separate merge/dismissal path.
- [ ] Add regressions for both actual paths and repeat stream → reload → answer → governed approval → reload/replay. Do not click the resurrected choice, auto-approve, disable gates or create duplicate tasks as a workaround.
- [x] Consumed-approval replay itself was safe in this retest. The original upstream 503 remains historical, not a proven deterministic defect.

### F05: Full built onboarding — workspace loader versus installed artifact

**Priority:** P2. **Related work:** native onboarding packaging; artifact acceptance remains incomplete.

- [x] Original zod module-load failure no longer reproduced; raw built onboard created fresh configuration and passed all nine doctor checks.
- [ ] Resolve/test the intended built-command contract: plain `node cli/dist/index.js onboard --yes` in this workspace fails importing `server/src/env-compat.js` from `server/src/index.ts`. Workspace server exports source; publishConfig exports dist.
- [x] A separate fresh-home `--import tsx` diagnostic reached healthy exact candidate, supporting a workspace-loader distinction. Its later PowerShell UI check threw a null-reference; retained diagnostic verdict remains **fail**, not full onboarding success.
- [ ] Demonstrate usable UI and owned cleanup with the intended installed/packed artifact or repaired supported workspace command. **Published installation was not tested; a published packaging defect is not established.**
- [x] Both diagnostic attempts were cleaned with no owned app/DB process/listener remaining. Private generated config/auth homes must not be committed.

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

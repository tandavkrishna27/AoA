# F01, F02, F04 and F05 follow-up repair plan

> Execute with the subagent-driven-development workflow. The program owner authorized these repairs, Sol high subagents, full local/CI verification, a branch commit and separate live retesting.

**Goal:** Repair the paths demonstrated by the [targeted retest](../reports/2026-10-16-f01-f05-live-retest-report.md), keeping its original observations immutable.

**Architecture:** Preserve the current CLI extraction, Commander approval and durable conversation contracts. Extend the existing launch and hydration paths rather than adding a new execution system. Plain built onboarding in a built workspace is a supported command; packaged installation retains its separate acceptance case.

**Spec:** The targeted retest report and [live acceptance criteria](2026-10-16-f01-f05-live-retest.md). Baseline `64802f2b575f114940fcdb5fef79fc55eea68b73` publishes results for application `fe3db70fea7fd4413429bc92d81b56ea67ccd386`.

## Global constraints

- Preserve company/owner scope, runtime approval authority and original submission identity on retry. Conversational choices never authorize tools.
- Preserve read-only extraction, inherited model and scoped authentication. No host/cloud fallback, personal credential transfer, provider calls or live deployment in this task.
- No schema/migration work or dependency/lockfile changes unless a demonstrated requirement justifies them.
- Use isolated Node 24.19.0 and pnpm 9.15.4. Serialize heavy full-suite/build lanes; retain native stdout/stderr/exit evidence. Do not weaken assertions, increase transport ceilings or classify skipped tests as passes.
- Work only in the attached feature worktree. Keep the shared main checkout intact. Agents own disjoint files; the F02/F04 UI work is one task to prevent overlapping edits.
- F03's bounded live pass stands. TST-008 and the next live journeys remain open until independently executed on the new candidate.

## Review focus

- Actual non-repository Codex extraction preflight, covering local and sandbox argv.
- Failed user-only conversation hydration and retry identity, scoped to the requesting company/user.
- Canonical OPTIONS in Codex's real summary stream and answered/unanswered choices on explicit saved-chat hydration.
- Actual built CLI server entry selection, stale/missing build behavior, source development and installed distribution paths.
- Partial failures, rejoin/retry races, consumed approvals and cleanup must not cause duplicate effects or invent authority.

### Task 1: F01 extraction preflight

**Own:** `server/src/services/internal-agent/codex-exec.ts`, extraction argv in `server/src/services/extraction-cli.ts`, adjacent extraction tests. Coordinate before touching other files.

- [ ] Add failing regression(s) for the non-Git temporary working directory in local and sandbox Codex extraction. Exercise actual CLI preflight safely where available, without authentication or provider inference; retain version and limitations if an installed CLI differs from the pinned live version.
- [ ] Correct the launch contract, preserving root approval option ordering, read-only sandbox, model and credential selection.
- [ ] Run focused tests and self-review. Report exact RED/GREEN evidence and remaining live limits. Do not modify the original retest report/evidence.

### Task 2: F02/F04 durable UI and Codex stream

**Own:** Commander conversation API/route and UI hydration/retry paths, `server/src/services/internal-agent/cli-mode.ts`, related tests and shared types if required. No extraction or CLI onboarding files.

- [ ] Reproduce F02 with failed user-only saved history plus a failed run, then explicit saved-chat hydration/reopening. Restore actionable scoped failure information and Retry/Edit/Discard using the original submission identity and persisted payload/reference data. Do not rely only on transient component state or failed assistant messages.
- [ ] Preserve retry/rejoin idempotency, attachments/reference semantics and company/owner checks. Refuse unsafe/unreconstructible retries clearly rather than silently sending a different request.
- [ ] Reproduce F04 through Codex's actual parsed summary path. Emit canonical OPTIONS chunks while retaining surrounding text and malformed-marker fallback.
- [ ] Share answered-choice dismissal across both explicit history hydration and transient merge, leaving unanswered choices available. Never derive runtime approval from text.
- [ ] Run focused API/stream/UI tests with RED/GREEN evidence and self-review. Report API documentation changes needed.

### Task 3: F05 supported built onboarding

**Own:** `cli/src/commands/run.ts`, CLI launch helpers and adjacent CLI tests. No F01/F02/F04 files.

- [ ] Reproduce plain built CLI selecting source TypeScript without a loader inside the workspace. Establish an executable regression beyond help-only module loading.
- [ ] Make built workspace commands resolve the built server entry without requiring an undeclared loader; preserve intentional source development and installed package entry paths. Missing builds should fail with actionable guidance.
- [ ] Cover entry selection through the actual command path, including installed/packed resolution boundaries where feasible without live setup. Do not claim a published artifact or actual onboarding pass from fixture/help smokes.
- [ ] Run focused tests and self-review; describe the supported command and any remaining packed/live acceptance limits.

### Task 4: Integration, documentation and verification

**Own:** Controller; API/developer docs, separate live retest checklist and mutable handoff, generated artifacts/inventory only if needed.

- [ ] Review each task for spec compliance and quality; run a whole-change review and repair demonstrated issues.
- [ ] Update the separate live checklist for the exact repaired paths, required evidence and cleanup, preserving original reports/evidence and F03's bounded pass.
- [ ] Run `pnpm -r typecheck`, complete `pnpm test:run` with bounded workers, authoritative network-free `pnpm build`, and relevant local policy checks. Preserve failures and rerun affected checks after corrections.
- [ ] Commit and push the feature branch; require actual CI including `ci-required` to pass. Keep live Local + VPS execution independent. Report tested application SHA, checks and remaining live acceptance.

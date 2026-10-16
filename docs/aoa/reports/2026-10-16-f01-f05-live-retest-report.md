# F01–F05 targeted local/VPS retest — 16 October 2026

## Candidate and verdict

- Branch: `codex/replatform-baseline-w00-w04`.
- Exact tested and deployed candidate: `fe3db70fea7fd4413429bc92d81b56ea67ccd386`. A final origin fetch still returned this SHA.
- New engineering commits since the previous report: `34d106949`, `c3c22ef61`, `fe3db70fe`. The last is documentation-only; application changes are through `c3c22ef61`.
- **Automated targeted verification passes on Windows and the VPS. Live acceptance is not fully closed.** F03 passes; F01, F02, F04 and F05 retain the qualifications below.
- Retest execution made no production source changes. This publication is documentation/evidence only; its commit is not a newly tested application candidate. The original outside-checkout report and raw evidence remain untouched.
- **Supersedes (live status only, new candidate):** the F01–F05 live status in the [original validation report](2026-10-16-local-vps-validation-report.md). It does not rewrite that attempt's failures, the [engineering verification](2026-10-16-f01-f05-engineering-verification.md), or unrelated gates.
- **Pickup checklist:** [completed items and remaining work](../plans/2026-10-16-local-vps-validation-handoff.md). **Acceptance criteria:** [live retest plan](../plans/2026-10-16-f01-f05-live-retest.md).
- **Clone-accessible evidence:** [sanitized summary, observed values and finalized raw-file SHA-256 receipts](../evidence/2026-10-16-f01-f05-live-retest-summary.json). Bare evidence filenames below are retained on the original PC under sibling `validation-2026-10-16-retest-fe3db70fe/` (Linux copies under `vps/`), not repository attachments. Raw access requires the test owner; credentials and private homes are excluded. Original reports, raw evidence and task QAN-1 remain unchanged.

## Automated results

| Check | Native Windows | VPS Linux |
|---|---|---|
| Pinned frozen install | Passed | Passed |
| Authoritative `pnpm build` | Passed | Passed |
| Targeted Vitest | **16 files / 236 tests passed**, exit 0 | **16 files / 236 tests passed**, exit 0 |
| Shared/server/UI/CLI typechecks | Passed | Passed |

Selection: the 15 changed test files since `7d66f0a0b`, plus adjacent `server/src/__tests__/cli-mode.test.ts`. See `selected-tests.json` and `vps/selected-tests.txt`. This covers the changed CLI bundle, extraction/summarization/readiness, agent loop, approvals, action tools, SSE route, persistence, OPTIONS, UI and run-history contracts. **This is not another complete test-suite or all-package typecheck run.** The other agents' full Windows/CI evidence remains separate.

Both hosts used isolated Node 24.19.0 and pnpm 9.15.4. Native Codex is the pinned 0.145.0. No global tool replacement, dependency/lockfile edit or bundled-snapshot refresh was made. Initial Windows build failed because the scratch runner omitted isolated pnpm from PATH and a nested command resolved host pnpm 11. After correcting only scratch PATH, a fresh pinned frozen install and authoritative build succeeded. Original failed logs and `local-build-initial-classification.json` are retained; this was not an application defect.

## Live checklist

| Item | Completed evidence | Pending acceptance / fix |
|---|---|---|
| **F01 — native extraction** | Real verify returned `outcome=verified`, Codex hello probe passed. Native Commander completed real turns with inherited model `gpt-5.6-sol`; saved `model` and `crewModel` remain null. The original unsupported approval-argument error is gone. | **Actual extraction failed** before useful output: Codex exit 1, `Not inside a trusted directory and --skip-git-repo-check was not specified.` No items persisted. Keep F01/native TST-008 open. |
| **F02 — cloud negative boundary** | Initial send clearly refused unsupported cloud execution. Durable run is **failed**, contains actionable error text, and has **null provider/model/summary**; no false completion or shared-host execution. Reload leaves exactly one failed user message and one failed run. | **Reloaded Commander loses the visible error and Retry/Edit/Discard banner**. Reopening the new saved chat shows only the user's message; no actionable guidance. UI retry could not be exercised because its control disappeared. Keep reload/rejoin/retry acceptance open. |
| **F03 — Planning creation** | **Passed bounded live case.** Exactly one new task QAN-2 is `planning` / `backlog`, unassigned, with null execution run. User choice did not create it: a separate governed `Allow once` was required. Reloaded UI shows Planning, Backlog, Unassigned and Not started. Replaying the consumed approval returned 404 and changed no tasks. QAN-1 remains standard and unchanged. | No F03 fix demonstrated necessary in this bounded case. This does not close F01 or all native TST-008 requirements. |
| **F04 — choices vs approval** | Historical legacy markup renders as choices. New canonical markup renders as choices after reload; clicking one sends intent, dismisses it in the live session, and leaves the runtime approval gate intact. Consumed approval replay does not duplicate the task. | **Two live gaps:** canonical OPTIONS was literal markup at completion of the original Codex stream (no buttons until reload); after selecting it, creating the task and reloading/reopening the saved chat, the **answered choice reappears** above its recorded user answer and successful creation. Do not click it again as a workaround. |
| **F05 — actual built onboard** | Raw built command loads beyond the original zod failure, creates fresh config, and passes all nine doctor checks. A separate loader-assisted diagnostic reaches a healthy app with the exact candidate. Owned diagnostic app/DB children are stopped; no remaining owned processes/listeners. | Plain `node cli/dist/index.js onboard --yes --data-dir <fresh-home>` fails server startup on workspace source export: `server/src/env-compat.js` cannot be resolved from `server/src/index.ts`. Full raw-command acceptance is not green. **Published/packed installation was not tested, so this is not proof that published packaging is defective.** |

### Reproduction details and engineering pickup

#### F01: extraction reaches the next Codex preflight failure

Created discussion `b1081dc1-f103-43b9-8186-faf7569540e3`, entry `6eea9934-6818-4df8-b0c7-d58f77a9a526`, with dummy task/decision notes. Triggered reprocess once; final extraction status is failed and extracted items are empty. Server logs explicitly say keyless CLI extraction, `CliExtractionError`, `kind=nonzero_exit` and the trusted-directory failure above. A temporary-home helper-binary warning precedes that failure. No provider key/model override or API fallback was used, and no speculative inference retry was made.

- [ ] Correct the supported Codex extraction launch contract for its isolated temporary working directory while preserving the read-only sandbox and scoped auth.
- [ ] Add regression coverage that reaches actual supported CLI preflight, not just argument parsing/help mocks.
- [ ] Repeat one real extraction and show useful persisted items. Crew stayed paused during this retest; no fresh Scout/crew acceptance is claimed.

Evidence: `native-verify-ready.json`, `native-extraction-start.json`, `native-extraction-trigger.json`, `native-extraction-observe.json`, `native-server.stdout.log` around lines 186–215. The verify helper labels its result `observed`, but the retained raw probe explicitly reports `outcome=verified`; it was not rerun merely to change that helper label. Earlier `native-verify.json` is a startup-not-ready HTTP failure before inference, not a failed model response.

#### F02: durable backend result is honest, chat hydration still hides failure

Sent once: `QA F02 retest fe3db70fe: reply only AOA_F02_OK. Do not use tools or make changes.` Run `aa97d1f9-e793-4abc-acb1-7ceae2f94be7`; conversation `ceaeba4d-a565-4d04-a8f2-080988d07dbf`; user message `88958f54-c654-45d9-a4e8-31d5cd32583c`. SQL after reload confirms the same single failed message/run and null provenance. No-provider cloud denial is expected; this test must not enable unsandboxed multi-tenancy just to make inference run.

- [ ] Hydrate durable failed user turns/run error into the saved-chat UI; preserve actionable failure guidance across reload/reopening.
- [ ] Then test retry/rejoin with the original submission identity, proving no duplicated run/side effect or native host fallback.

Source inspection: `InternalAgentPanel.tsx` resets the transient failed-send banner on conversation changes; persisted `serverToLocal` error handling checks failed **assistant** messages, while this boundary persisted a failed **user** message and failed run. This is an investigation pointer, not an implemented fix.

Evidence: `cloud-boundary-initial.json`, `cloud-boundary-after-reload.json`, `cloud-observe.sql`, `f02-cloud-after-reload-ui.txt`. Initial error banner was observed in browser tool output; no screenshot of that transient first banner was saved. Reopening the newest saved chat was necessary because a page reload selected the older conversation; that older chat was not mistaken for the retest result.

#### F03/F04: one governed side effect; separate UI defects

New conversation `01cc0718-639e-47a7-8a3a-13dba4f4ba1f`. Requested explicit `workMode=planning`, no execution, with canonical Create/Cancel choices first. The initial stream displayed the literal canonical OPTIONS marker. Reload/reopen converted it into buttons. Chose `Create planning task` once. Before approval, API snapshot still contained only QAN-1. Commander then proposed `create_task` with `workMode=planning`; clicked **Allow once**, never Always allow. Task QAN-2 (`c63290a6-16ee-4d95-8af4-7c2473f4b37f`) was created once.

Read the single durable approved runtime-approval record for this QA conversation, then deliberately POSTed that same consumed confirmation once. Response: 404, `No pending confirmation`; before/after task arrays are identical. No second model turn, creation or execution was requested by this replay.

After reload/reopen, the answered canonical choice is visible again despite the subsequent `Create planning task` user message and persisted successful creation. Screenshot shows both. The old legacy prompt followed by a later user message remains dismissed; a different old prompt with no later user answer remains visible and was not clicked.

- [x] Explicit Planning semantics, separate durable runtime approval, reload visibility, consumed-approval replay safety.
- [ ] Parse canonical OPTIONS on the actual Codex streaming-summary path, not only the other CLI/replay paths. `cli-mode.ts:2069` yields `parsed.summary` directly as text.
- [ ] Apply answered-choice dismissal to explicit saved-conversation hydration. `InternalAgentPanel.tsx:979` maps history via `serverToLocal`; the dismissal implemented in the merge helper is used by a different no-selected-conversation path.
- [ ] Add real-path regression coverage and repeat streaming/reload/answer/reload without a duplicate side effect.

Evidence: `native-snapshot-before-approval.json`, `native-snapshot-after-approval.json`, `native-snapshot-final.json`, `native-approval-replay.json`, `f03-planning-ui.txt`, `f03-planning-ui.png`, `f04-answered-choice-reappears-ui.txt`, `f04-answered-choice-reappears.png`. Initial raw-stream symptom was observed in browser tool output; persisted canonical text is retained in the conversation snapshot, but no initial-stream screenshot was saved. `native-snapshot-initial-choice.json` accidentally queries the default old conversation; do not use its old conversation as the new chat's evidence.

#### F05: distinguish workspace loading from a published artifact

The plain built CLI exits 1 after doctor success. `server/package.json` workspace exports point at `./src/index.ts`; its `publishConfig.exports` points at `./dist/index.js`. The raw built CLI's server import resolves to workspace TypeScript and cannot resolve its `.js` source import without a TS loader.

A separate fresh-home diagnostic used `node --import tsx cli/dist/index.js onboard --yes ...`, port 3212 and embedded PG override 54330. It reached `/api/health` with exact candidate and ready auth/bootstrap. The diagnostic scratch runner then hit Windows PowerShell `Invoke-WebRequest` null-reference at its UI check, so its retained overall result is **fail**, not an unconditional onboarding pass. It does support the loader/workspace explanation; do not reinterpret it as a plain-node pass. Original raw-command failure/home/output remain untouched. Both diagnostic homes are protected and contain private generated secrets; do not publish them.

- [x] Original eager-zod-load failure no longer reproduced; all nine doctor checks pass.
- [ ] Define/test the intended built-command acceptance artifact: raw workspace command vs installed/packed distribution. Either repair the supported workspace launch contract or demonstrate real installed built onboarding, including usable UI and cleanup.

Evidence: `f05-built-onboard.result.json`, `.stdout.log`, `.stderr.log`; separate `f05-loader-diagnostic.result.json`, logs and cleanup logs; `final-audit.json`. No F05 listeners/processes remain; the main native review app remains running on 3210/54329.

## F06–F09 classification correction / evidence limits

These are **investigations/historical incidents, not established production defects**, and were not independently retested on this candidate.

| Item | Current assessment |
|---|---|
| F06 long Windows auth path | Historical local raw files do contain exact SQLite initialization stderr and the nested failing path; initialize closes and child exits 1 at auth-home length 248, while a short-home diagnostic succeeds at 210. Sanitized excerpts and original-file hashes are in `f06-evidence-clarification.json`. This does **not** establish a specific root cause or failure on normal/default paths, nor replace independent reproduction. |
| F07 artifact race/unhandled rejection | Valid test investigation. Starting destroy/export without an upload-entry barrier allows legitimate destroy-first failure; late attachment of queued rejection handling may explain the unhandled rejection. No production race defect or fix is established. |
| F08 Windows suite failures | Historical failures remain recorded; other agents report affected files and later full-suite checks passing. This targeted retest is not a rerun of all those files. Restricted-port/resource-load explanations remain unsupported without original failing address/port and diagnostics. |
| F09 residual PostgreSQL | Reported cleanup incident, not demonstrated attribution/cause. Passing assertions do not prove cleanup when teardown swallows errors. Complete original process ownership records are still required. This retest's clean owned diagnostic teardown does not disprove the earlier incident. |

## Environment, scope and retained resources

- Native and VPS authorities remained separate. Native subscription auth stayed on the PC. No personal auth copied to VPS, no cloud provider key/E2B credential restored, no positive cloud inference, no rollout exposure change, no unsandboxed escape hatch enabled.
- Existing owned apps were upgraded/rebuilt in place, with original databases/history preserved. No full reset was necessary. VPS DB container and HTTPS/OAuth configuration remain intact. Google sign-in itself was not repeated; the existing cloud session survived.
- Native crew remains paused; no task agent run was started. Two deliberate Commander turns were used for the new choice/creation journey, plus one native verification probe and one failed extraction trigger; no alternate-model retry campaign.
- Local review app and `https://testing.armyofagents.org` both report healthy exact candidate. VPS `aoa-validation.service` remains active. New dummy discussion and QAN-2 are left for review; QAN-1 was not repaired/converted to hide the old result.
- `final-audit.json` records no F05-owned residual listeners/processes, clean local Git status, both health revisions and local artifact hashes. `vps-final-artifacts.txt` records clean owner-user Git status/SHA and Linux artifact hashes. CLI/server entry hashes match across hosts; UI index hashes differ and are recorded separately, not asserted identical.
- Complete automated evidence copied from VPS to `vps/`; remote originals remain under `/opt/aoa-validation-2026-10-16-retest-fe3db70fe/evidence`. Auth/runtime/private homes are not part of a portable evidence bundle. No full release, W02/W05–W18, E2B/provider, D2/M4, or cross-host inference acceptance is claimed.

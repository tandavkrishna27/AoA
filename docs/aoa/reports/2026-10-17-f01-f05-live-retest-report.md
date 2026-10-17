# Targeted local/VPS follow-up retest — 17 October 2026

- **Branch / tested application:** `codex/replatform-baseline-w00-w04` at `6ebc400d2fd4c4cf26b90d2c1d6466171d08f3e9`, matching origin on the final fetch.
- **Supersedes:** the corresponding live status on `fe3db70fe` in the [16 October retest](2026-10-16-f01-f05-live-retest-report.md), not its immutable observations or unrelated release gates.
- **Acceptance / pickup:** [remaining-gap cases](../plans/2026-10-16-f01-f05-live-retest.md#next-candidate-remaining-gap-acceptance), [mutable completed/pending checklist](../plans/2026-10-16-local-vps-validation-handoff.md).
- **Portable evidence:** [sanitized observations and finalized raw-file SHA-256 receipts](../evidence/2026-10-17-f01-f05-live-retest-summary.json). Bare evidence filenames below live on the test PC under sibling `validation-2026-10-17-retest-6ebc400d2/`; Linux copies are under `vps/`. VPS originals are `/opt/aoa-validation-2026-10-17-retest-6ebc400d2/evidence`. Raw logs/screenshots/private homes are not clone-accessible attachments.
- **Verdict:** the demonstrated extraction and native choices failures no longer reproduce, and the bounded cloud denial/recovery/retry journey passes. **F05 still fails actual raw built onboarding.** Missing provenance and separately prerequisite-bound cases below remain pending; this is not an all-clear or full-suite claim.
- **Publication:** documentation/evidence only. No application fix, model override, provider fallback, credential transfer or rollout change was made by this retest. A documentation successor commit is not a newly tested application.

## Targeted automated checks

Both hosts used isolated Node **24.19.0** and pnpm **9.15.4**. Selection was exactly the **13 changed `.test.ts` / `.test.tsx` files since `64802f2b5`**, listed in the portable evidence. This was **not** the complete test suite. Affected typechecks cover shared, server, UI and CLI only; the authoritative root build rebuilds the workspace so the review apps use current artifacts.

| Check | Windows | VPS Linux ARM64 |
|---|---|---|
| Frozen install / authoritative build | Exit 0 / exit 0 | Exit 0 / exit 0 |
| Original two-worker targeted run | 12 files passed / 1 skipped; **203 tests passed / 47 skipped**, exit 0 | 12 files passed / 1 failed; **249 tests passed / 1 failed**, exit 1 |
| Focused unchanged-timeout CLI rerun | Not needed | `run-entrypoint.test.ts` passed in quiet one-worker run, exit 0 |
| Same 13-file selection, one-worker rerun | Not repeated | **13 files / 250 tests passed**, exit 0 |
| Four affected-package typechecks | Exit 0 | Exit 0 |

The retained Linux failure is `source CLI keeps the tsx server path and respects UI development middleware override undefined`: the existing 5,000 ms test timeout. Neither assertions nor timeout thresholds changed. The isolated CLI and whole targeted one-worker reruns pass, but this does not establish the timeout's root cause or erase the original red run. The receipt/file label `targeted-serial` denotes `--maxWorkers=1 --minWorkers=1`, not a measurement of every internal fixture's concurrency. Windows skips are not passes; the Linux run supplies the selected real-PostgreSQL integration coverage. No full Windows integration or full release campaign was added.

Evidence: `targeted.*`, `typecheck-affected.*`, `build.result.json`, `selected-tests.json`; Linux `vps/targeted.*`, `vps/cli-quiet.*`, `vps/targeted-serial.*`, `vps/typecheck-affected.*`. Native final-summary counts are transcribed separately; unavailable generic capture counters remain unknown. The first scratch orchestration changed its working directory after successful install and failed to locate subsequent relative runner paths; the build had not begun. Absolute runner paths corrected only that harness issue.

## Completed and pending live cases

| Finding | Fresh completed observation | Remaining limit / fix |
|---|---|---|
| **F01** | Real verify passed; one actual discussion extraction completed and persisted a useful task and decision, both visible for review in the saved Discussion. Neither prior argv nor Git-trust refusal recurred. | The raw child exit/model receipt was not separately retained by this harness. Keep strict provenance evidence and the broader native TST-008/crew journey open; do not infer an exact child exit or extraction model from a completed entry. |
| **F02** | VPS failed-user history now restores actionable refusal and Retry/Edit/Discard after reload/reopen. One exact attachment-bearing retry retained the same user row, submission ID and frozen request. Both attempt runs are honestly failed with null provider/model and no distributed binding. Run History agrees. Keyboard edits dismiss stale recovery; Edit restores the saved request/reference; Discard stays dismissed across switch/back. | Accepted distributed retry/stale-running rejoin, independently controlled live refetch/race timing, and a separate other-owner/company live session were not exercised. Deterministic tests cover those implemented paths; live prerequisites remain explicit. Transient duplicate text is noted below. |
| **F03** | One new QAN-3 is Planning/Backlog/Unassigned/Not started with no execution-run link, after a distinct Allow once. Before approval, only QAN-1/QAN-2 existed. Consumed-approval replay returned 404 without changing tasks. | Bounded same-candidate case passed; not whole W02/TST-008 acceptance. QAN-1/QAN-2 remain unchanged. |
| **F04** | Canonical buttons appeared at actual Codex stream completion without reload, preserving surrounding text. Unanswered choices survived reload; answered choices stayed dismissed after reload and switch/back. Historical answered/unanswered legacy choices were distinguished correctly. One runtime approval, not a choice, gated the task. | Distributed OPTIONS-only/text-plus-OPTIONS delivery/result recovery needs a separately authorized accepted distributed setup. No such setup was enabled. Pending-card cross-company switching and malformed-marker live inference were not added; relevant deterministic checks passed. |
| **F05** | Plain built onboard passed all nine doctor checks and got past the original source-export/module error. Owned cleanup left no F05 app/DB processes or listeners. | **Still failed before usable setup**, exit 1: scoped `tsx` import cannot initialize PDF/canvas dependencies; `DOMMatrix is not defined`. No healthy F05 app/UI was reached. Installed/packed distribution remains untested. |

### F01 — actual extracted content

Discussion `cf032493-3779-4271-8635-e62f2f59bacd`, entry `883aac26-6db2-4677-8cf1-20ab0e210094`. Triggered reprocess **once** after its initial skipped state. Result: completed, with two pending review items:

- Task: **Prepare dashboard indicator persistence checklist** — confirm the disposable blue indicator survives reload.
- Decision: **Use blue status indicator for dummy dashboard**.

No extracted item was approved, converted or dispatched. Saved native `cliTool=codex`, `model=null`, `crewModel=null`, `crewPaused=true`; pinned CLI **0.145.0**. Two deliberate Commander turns separately report inherited `gpt-5.6-sol`/OpenAI provenance. Those Commander fields do not prove the extraction subprocess's exact model. Evidence: `native-verify-ready.json`, `native-extraction-{start,trigger,observe}.json`, `f01-persisted-ui.txt` / `.png`.

An incidental automatic `thread.controller` sub-agent run (`ec2a2c1a-4c25-412d-b6e8-6e9a48354945`) followed the discussion entry despite saved `crewPaused=true`. It completed with null summary/provider/model. This was not a QAN task dispatch, an intentionally requested additional crew experiment, or proof of useful W02/crew acceptance. Its trigger and state are retained in `native-run-audit.json`; the pause/event-controller relationship is a follow-up investigation, not an established new production defect. Do not claim that no agent run occurred.

### F02 — honest refusal, exact retry, draft and reference behavior

Fresh conversation `fd234759-227e-4b4a-9310-229f05178a8c`; user row `fcfd5556-be79-404d-b8d8-463daf33d849`; submission `e9741e23-e20f-4cbc-bb76-3e47fb6f59a5`. Uploaded only disposable `qa-reference.txt`, asset `346d94eb-1c1f-4bb7-a086-7ee370659ef6`, then sent once. Reopened after reload and clicked Retry **once**. The same user row/submission/content/context/attachment ID remained; its run link moved to the latest failed attempt.

Both `98e7418c-29d6-44b6-aba8-1340b0145560` and `472a8284-7c02-4594-b0e3-bf376ca8d178` are failed audit receipts, with null provider/model/summary and null distributed job/attempt bindings. **Two legitimate failed-attempt receipts are not two user submissions or duplicate paid executions.** Existing background no-provider sub-agent denials also appear in Run History and are not this pair of conversation attempts.

The error instructs configuration of proper isolation; no unsandboxed escape hatch, company model key or E2B key was enabled. The old `fe3db70fe` chat now explains why exact Retry is unavailable when original context/attachment metadata was never saved. No old payload was guessed. Native auth stayed on the PC, and the retained cloud Google session worked; Chrome was not needed.

Browser observations include reload/reopen, switch/back, preserved newer unsent text after retry, keyboard typing dismissing stale recovery, explicit Edit restoring the original draft/reference, and explicit Discard clearing the composer and remaining dismissed across switch/back. Discard was deliberately invoked on disposable text; it is not a claim that Discard preserves a draft. A hard reload can recover the still-failed stored turn again. No edited draft was submitted as an extra model request. Successful-retry/refetch race timing is deterministic-test evidence, not a manually controlled live race.

Evidence: `cloud-before-reload-complete.json`, `cloud-after-retry-complete.json`, `f02-*.txt`, editor/draft JSON receipts and screenshots. An initial scratch query used a timestamp lower bound that missed the run created just before its user row; a later query followed explicit identities and both observed attempt IDs. The initial partial captures remain, but are **not** used as complete run-count evidence.

### F03/F04 — choices, governed creation and replay

Conversation `f042bbe4-2c12-4b87-9eee-0049c286af62`; task QAN-3 `b45f4166-226b-4d2a-84b6-f13be85a182e`; consumed confirmation `ffd9083e-1134-4271-9028-a4450757331a`. No task existed for the new title before Allow once. The approval card remained visible after the completed turn's history fetch; choices did not authorize it. One subsequent same-ID confirmation replay returned 404 and the task arrays stayed identical.

Evidence: `f04-canonical-stream-ui.txt` / `.png`, unanswered/answered/legacy UI receipts, `native-snapshot-before-approval.json`, `native-snapshot-after-approval.json`, `native-snapshot-final.json`, `native-approval-replay.json`, `f03-planning-ui.txt` / `.png`.

**UI reconciliation observation:** live cloud retry temporarily displayed repeated user text; native pending-approval reconciliation displayed repeated assistant narration. A fresh saved-chat reload removed the repeated live text, the cloud DB always had one user message, and native creation always had one approval/side effect. Retained before/after snapshots support a UI investigation, not a duplicate execution or durable-message finding. No second creation/extra retry was used to conceal it.

### F05 — actual built workspace still blocked, with reduced reproduction

Command: `node cli/dist/index.js onboard --yes --data-dir <fresh-owned-home>`, pinned Node, full frozen install and authoritative build, no external `--import tsx`. Separate QA home, app port **3212**, embedded PG override **54330**, production UI enabled, no provider credentials. All nine doctor checks pass, then startup exits 1:

```text
Cannot load "@napi-rs/canvas" package: ENOENT ... node:os?tsx-namespace=<dynamic>
Cannot polyfill DOMMatrix / ImageData / Path2D
DOMMatrix is not defined
```

A read-only reduced diagnostic imports the installed PDF dependency's ESM entry in separate Node processes: ordinary import **exit 0**; the same dependency through the newly introduced scoped `tsImport` **exit 1**, reproducing the namespaced `node:os`/`DOMMatrix` failure. No server/model was started by that diagnostic. This narrows investigation to the real dependency graph under scoped loading; it is not proof of a particular library-internal cause or a repair. Stub-server entry-selection tests passing do not establish full onboarding success.

- [ ] Add an executable regression including the real PDF/canvas/native dependency loading path.
- [ ] Repair supported raw workspace startup without an external loader workaround or silently selecting a different installed server; preserve source development and installed resolution boundaries.
- [ ] Repeat fresh-home doctor/startup/healthy exact candidate/usable UI/owned teardown. This attempt never reached the browser-proof phase.

Evidence: `f05-built-onboard.{result.json,stdout.log,stderr.log}`, `f05-import-diagnostic.result.json`, direct/scoped import logs. No F05 listeners/processes remain; protected generated secrets/home are not committed. Published/packed installation was not tested and is not inferred broken from this workspace result.

## Resource, evidence and remaining-work boundaries

- Rebuilt/upgraded existing owned review setups; no database destruction/reset was necessary. Original reports/evidence and QA entities were preserved. Source was transferred to the existing VPS checkout as a Git bundle and fast-forwarded without transferring GitHub/personal auth credentials.
- Local app and HTTPS VPS health both report the tested SHA. Frozen installs/builds/typechecks and artifact entry hashes are retained. CLI/server entry hashes match across hosts; UI index hashes are recorded separately. Review apps remain up; F05 diagnostics are stopped.
- The VPS original two-worker red, quiet rerun and serial green remain separate receipts. This is neither a full-suite rerun nor a claim that historical F08 causes were fixed. F06–F09 remain qualified historical investigations, unchanged by this attempt.
- Pending: strict F01 raw subprocess provenance; broader TST-008/W02; distributed accepted-turn retry/stale-running rejoin; distributed choices delivery/recovery; other-owner/company live isolation checks; UI reconciliation observations; F05. No prerequisites were manufactured by enabling rollout, provisioning provider keys, transferring auth, or spending on E2B/provider inference.
- New report/evidence records are immutable after publication. Update only the coordination checklist; future runs/corrections get a new exact-candidate attempt with a backward Supersedes reference.

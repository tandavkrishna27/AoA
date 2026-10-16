# Local + VPS Validation Pickup Checklist

- **Branch:** `codex/replatform-baseline-w00-w04`
- **Tested baseline:** `05522b0f22e9df84ddfa6d3444d0362e4ad8a6cd`
- **Source of truth for this attempt:** [validation report](../reports/2026-10-16-local-vps-validation-report.md) and [portable evidence summary](../evidence/2026-10-16-local-vps-validation-summary.json).
**Status:** Mutable coordination checklist; no application fixes were implemented by the validation/documentation work.

**Implementation follow-up:** F01–F05 have code fixes after this validation attempt. Their separately scoped [Local and VPS retest cases](2026-10-16-f01-f05-live-retest.md) remain required for live acceptance; implementation and local/CI checks do not close those cases or amend the original results. The original unchecked live-journey requirements below remain open.

Checked items mean the stated implementation observation or verification happened, **not** that an entire W package or release gate passed. F01–F09 are handoff labels, not newly filed repository tickets or assigned owners. Priorities are triage suggestions. Recheck current HEAD and superseding fixes before starting; keep each fix focused and attach its regression test and new-candidate evidence. This checklist is not fresh authority for infrastructure changes, credential transfer, paid calls or rollout flags.

## Completed / verified

- [x] Pulled and tested the named branch; tested application matched origin at `05522b0f2` on the final verification. W00/W01/W03/W04 implementation was present per the existing completion plan.
- [x] Fresh frozen Node 24.19.0 / pnpm 9.15.4 installs, root builds and recursive typechecks passed on Windows x64 and Linux ARM64. Global local tools preserved.
- [x] Capture self-tests executed: Windows 6 pass / 2 Linux-only skips; Linux 8 pass. Native streams/exits retained, unavailable capture counters left unknown.
- [x] Complete 149-test startup/PostgreSQL/ACL file passed on both hosts, including opted-in native Windows integration. This does not close the separate residual-process finding F09.
- [x] Focused regressions executed: Windows 252 pass / 1 fail; Linux 253 pass. Normal full suites executed: Windows 24,360 pass / 3 fail / 2,132 skip plus one unhandled error; Linux 26,414 pass / 81 skip, exit 0. **Windows remains red.**
- [x] Three Windows full-lane failure files passed 55/55 in quiet isolation; corrected artifact diagnostic passed 34/34. Original failures remain open, not waived by reruns.
- [x] Exact-source deterministic Docker spine 10/10, verdict controls 129/129 and Linux slot/ownership fixtures 2/2 passed.
- [x] Fault profile executed with 25/26 Windows-runner passes; selected Linux-only expired-enrollment case passed on a real Linux runner. No complete Linux profile verdict claimed.
- [x] Native CLI/full-schema restore engineering fixtures passed 2/2, including positive execution of nested native restore and database/object recovery checks. No expanded-staging recovery claim.
- [x] Native inherited-model catalog, onboarding/hello, persisted Commander reply and durable Scout reply passed with saved model selections NULL and isolated Codex 0.145.0; no model override or API-key fallback.
- [x] Real cloud Google sign-in, onboarding and planning-task create/update/reload passed. Real E2B transport smoke passed five bounded checks and sandbox absence was verified after deletion.
- [x] User retry created native `QAN-1`; unassigned, backlog, not started, no execution-run link. **Its Standard mode is a failure of the requested Planning mode**, tracked in F03. Raw approval text remains F04; the earlier 503 is preserved as a recovered historical observation, not a proven deterministic product defect.
- [x] Retained review apps/dummy data, paused native crew, cleaned disposable fixtures/unused auth copies, removed temporary E2B process credential and verified healthy apps. No secrets/auth homes/raw runtime archives committed.

## Pending fixes and investigations

### F01: Native extraction argv

**Priority:** P1. **Related work:** W01 native acceptance / TST-008.

- [ ] Reproduce Codex 0.145.0 rejecting `--ask-for-approval` after `exec` in `server/src/services/internal-agent/codex-exec.ts`; add a regression for the real supported CLI argument contract. The parser-only root-option control passed; it is not an extraction success.
- [ ] Correct argument construction without changing approval/sandbox policy, introducing a model override or adding an API fallback.
- [ ] Re-run an actual native discussion extraction with inherited model configuration and verify useful persisted extracted items. Then re-run the complete native acceptance journey, not just a hello probe.

### F02: Cloud empty response, false completion and model label

**Priority:** P1. **Related work:** Commander failure handling / W01 provenance.

- [ ] Reproduce the unsupported/no-company-key send on `cloud_auth`: only user text remains, turn failed, run completed with NULL error/summary and a legacy `gpt-4.1` label.
- [ ] Trace streamed error handling through `server/src/routes/internal-agent.ts`, run persistence and the UI. Add tests that distinguish a genuine completion from yielded errors, empty/config-denied outcomes and thrown failures; keep idempotency/rejoin behavior intact.
- [ ] Surface an actionable refusal/deferred state; record an honest failed outcome and do not imply a model ran when no runtime provenance exists. Verify no personal-host-login fallback or tenant execution on the control-plane host.
- [ ] Re-test this negative boundary independently of positive cloud inference, which remains credential/configuration-dependent below.

### F03: Commander ignores requested Planning mode

**Priority:** P2. **Related work:** task-tool contract / native useful-tool journey.

- [ ] Trace mode through the tool schema, approval payload and task creation path. Reproduce a task described as planning being persisted with `workMode=standard`; do not infer mode from description text.
- [ ] Preserve explicit Planning mode through governed creation, or refuse clearly if unsupported. Add a regression asserting `workMode=planning`, no assignee, no execution dispatch/run and no duplicate task on replay/retry.
- [ ] Re-run the real Commander planning-task journey and verify both durable state and UI mode. Existing `QAN-1` was left unchanged as evidence; creation alone is not the full acceptance criterion.

### F04: Literal OPTIONS markup / approval presentation

**Priority:** P2. **Related work:** Commander approval UI/protocol.

- [ ] Investigate why `⚡OPTIONS:{"confirm": true}⚡` persists as ordinary response text instead of a usable governed approval interaction. Distinguish conversational confirmation from actual runtime approval; do not assume an extra legitimate approval is itself a bug.
- [ ] Add protocol/UI regressions for approval presentation, retry and persisted replay. Never treat arbitrary model text as authorization, disable approval gates, or auto-approve to hide the symptom.
- [ ] Verify a single approved side effect, an understandable final state and no duplicate task. Preserve the original upstream 503 record; the user's retry already proved creation can succeed.

### F05: Built CLI missing dependency under strict pnpm

**Priority:** P2. **Related work:** native onboarding packaging.

- [ ] Reproduce `node cli/dist/index.js onboard --yes` failing to resolve `zod` after a clean frozen install/build. Source CLI success does not prove packaged CLI success. Onboarding may start a server; use disposable data/owned processes.
- [ ] Trace bundling/package dependency ownership and fix the distributable contract, not global dependency resolution. Keep manifests and lockfile synchronized if a real dependency change is needed.
- [ ] Verify the built CLI's disposable onboarding and clean shutdown with no global installation workarounds.

### F06: Long custom Windows data/auth home

**Priority:** P2. **Related work:** W01 catalog/auth environment handling.

- [ ] Reproduce the managed nested auth-home SQLite initialization failure with pinned Codex 0.145.0; compare the same account/CLI with a short home. Original evidence does not prove default home paths fail.
- [ ] Determine and fix or clearly constrain the supported path contract; add a Windows regression. Preserve owner/company isolation, credential custody and account-scoped model resolution.
- [ ] Verify catalog, onboarding and an actual native turn on the supported path without model override, global auth mutation or secret disclosure. The short-home test setup was only a workaround.

### F07: Artifact race error contract and unhandled rejection

**Priority:** P1. **Related work:** W05 / TST-013.

- [ ] Reproduce both the focused stalled-upload/destroy error-class mismatch and full-lane queued-export/deadline unhandled rejection. Start in `packages/adapter-manager/src/__tests__/server-artifact-export.test.ts` and the provider-wire/gated operation path.
- [ ] Repair ownership, deadline/cancellation/destroy ordering and error propagation at the demonstrated cause; observe every promise and prevent late artifact promotion. Do not merely broaden the expected error vocabulary to green the test.
- [ ] Verify controlled races plus interacting/full Windows coverage with zero unhandled errors. The 34/34 isolated pass is diagnostic evidence, not a fix. The separate live W05 output journey is still deferred.

### F08: Windows full-lane stability

**Priority:** P2. **Related work:** trustworthy W04/whole-lane evidence.

- [ ] Diagnose the 30-second AST test timeout in `server/src/__tests__/job-leasing-contract.test.ts` and the 180-second exhaustive IPv4 timeout in `server/src/__tests__/w13-oauth-deny-table-divergence.test.ts`, including interaction/resource load. Preserve security/AST assertions; don't blindly raise timeouts or weaken coverage.
- [ ] Capture the actual failing address/port in `packages/adapter-manager/src/__tests__/component.test.ts` and verify whether OS-selected `listen(0)` ports hit fetch's restricted-port list. That explanation is currently an inference, not an observed failing port.
- [ ] Repair demonstrated fixture/scheduling causes, then obtain a fresh complete Windows full-lane native result with no failures/unhandled errors. Passing three files in isolation does not meet this exit criterion.

### F09: Detached Windows PostgreSQL fixture child

**Priority:** P2. **Related work:** W04 fixture lifecycle.

- [ ] Investigate the focused fixture's detached PostgreSQL child after its parent exited; retain process ownership, creation/parent identity and fixture-port evidence. The observer stopped only the identified residual child, not the native app DB.
- [ ] Exercise normal teardown and timeout/abort/failure cleanup, verifying owned descendants terminate and next-case DB health. Do not use blanket PostgreSQL/Node kills or global Docker prune as a repair.
- [ ] Re-run the complete Windows startup file and its interacting lane, and verify no owned fixture processes or servers remain. Passing assertions alone do not prove process cleanup.

## Acceptance still pending / prerequisites

- [ ] Close native TST-008 only after extraction and requested task semantics pass; separately finish W02 actual useful background tool/task effect, cancellation and restart evidence. A Scout reply or completed empty run row is not full W02 closure.
- [ ] If a full Linux D1 fault-profile claim is required, run the **entire** profile on a Linux runner against the selected candidate. A selected expired-enrollment rerun is insufficient.
- [ ] Provision/authorize a supported cloud Company model credential and execution context before claiming positive cloud inference. Do not reuse removed temporary credentials, transfer a personal auth home to the VPS or substitute a paid provider.
- [ ] Follow the existing completion plan for W05–W18, including separately enrolled single-authority cross-host output, device credential/revocation, provider network, service/realtime, capacity and fleet journeys. These are not implicitly implemented by this branch or this checklist.
- [ ] Keep expanded-staging external-store/replica prerequisites and calendar-bound D4/D6 campaigns separate. Two review hosts and deterministic smokes do not satisfy 72-hour/14-day gates or authorize desktop/mobility exposure.

## Next-agent workflow and exit evidence

1. Read the report, `CLAUDE.md`, locked decisions and the completion plan; select/coordinate ownership of one finding and check for superseding changes. Inspect available local/VPS resources rather than assuming retained services/credentials still exist.
2. Add a reproducing test, implement the focused fix, and retain before/after evidence. No application fix is already hidden in this documentation commit.
3. Use isolated Node 24.19.0 / pnpm 9.15.4. Start with the exact failing files; run interacting lanes and the required root typecheck, test and build checks before claiming a repaired candidate. For real Windows DB integration use `AOA_RUN_WIN_INTEGRATION=1` and disposable PostgreSQL resources.
4. Capture full native stdout, stderr, exit, counts/skips, unhandled errors, candidate SHA and actual execution location; use a **new** capture directory/attempt. For example, `node scripts/run-vitest-captured.mjs --capture-dir <new-attempt> -- run <selected-files>`; consult existing scripts for opt-ins rather than assuming mocked/skipped runs are live evidence.
5. Publish a new same-candidate report with a backward `Supersedes` reference where applicable; preserve original failures and this immutable report. Check off a finding only with linked regression/fresh acceptance evidence. Do not mark whole W packages or release acceptance green from isolated passes.

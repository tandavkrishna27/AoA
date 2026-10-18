# F05 built-workspace startup fix — 17 October 2026

- **Branch / tested application:** `codex/replatform-baseline-w00-w04`, `64fbe0471579535c776df769ce471c46f2482f42`.
- **Supersedes:** only the F05 startup verdict in the [preceding local/VPS retest](2026-10-17-f01-f05-live-retest-report.md). Its original failures, other findings and evidence remain unchanged.
- **Evidence:** [portable observations, artifact identities and 35 raw-file SHA-256 receipts](../evidence/2026-10-17-f05-startup-fix-summary.json). Raw files live in sibling `validation-2026-10-17-f05-fix/` on the test PC, not in a clone-accessible attachment. Private config, database and secrets are not published.
- **Verdict:** the remaining **Windows raw built-workspace startup defect is repaired**. A fresh actual onboarding command reaches healthy server/static UI, saves dummy onboarding data and environment verification, survives UI reload, and releases all observed owned processes/listeners. This is not full eight-step engine/crew acceptance, packed-installation acceptance or an all-findings all-clear.
- **Publication boundary:** the fix/regression is the tested code commit above; the subsequent report/checklist commit changes documentation only. No VPS deployment/reset or whole-suite run was performed.

## Cause and focused repair

The previous scoped `tsx/esm/api.tsImport` graph altered a native canvas CommonJS built-in resolution into `node:os?tsx-namespace=<dynamic>`. Canvas initialization attempted to open that as a filesystem path; PDF initialization then failed with `DOMMatrix is not defined`.

Fresh-process comparisons on the original dependency graph reproduced the difference: ordinary PDF import exits **0**, scoped import exits **1**, and unscoped `register({ tsconfig: false })` followed by ordinary import exits **0**. The change uses that unscoped registration only inside the built-workspace branch before importing `server/dist/index.js`. Registration remains active for later source-exported workspace imports; there is no external loader flag, native-dependency mock, DOM shim or source-server fallback.

Source CLI execution retains its existing development path. Installed CLI execution still resolves the published server package without requiring `tsx`. Missing-build/development-dependency guidance and original startup-error propagation remain covered. No package manifest, lockfile, database schema or provider/model setting changed.

## Targeted verification only

Native Windows x64, isolated **Node 24.19.0**, **pnpm 9.15.4**, CLI **0.2.7**:

| Check | Result |
|---|---|
| New real PDF/canvas dependency regression before production change | Expected red: 1 failed / 11 name-filtered skips, exit 1; same missing canvas/built-in and DOMMatrix failure |
| Two focused files after repair | 2 files / 13 tests passed, exit 0 |
| Same two files after committing the exact application candidate | 2 files / 13 tests passed, no skips/failures, exit 0 |
| `pnpm --filter @armyofagents/cli typecheck` | Exit 0 |
| `pnpm --filter @armyofagents/cli build` | Exit 0 |
| Actual plain-Node fresh-home onboarding and owned teardown runner | Exit 0; details below |

The only test files were `cli/src/__tests__/run-entrypoint.test.ts` and `cli/src/__tests__/bundle-runtime.test.ts`, run through `scripts/run-vitest-captured.mjs` with `--maxWorkers=1 --minWorkers=1`. They cover real PDF/native canvas loading, source-exported TypeScript with relative JavaScript specifiers, source/installed resolution, missing dependencies/builds, UI overrides, startup errors without fallback and strict bundle dependency links. Assertions and timeouts were not weakened. The capture wrapper's unavailable generic counters remain `unknown`; counts above come from native output, which reported no unhandled-error diagnostic.

**Build provenance:** the preceding `6ebc400d2` frozen workspace install and authoritative server/UI build were retained; their code and dependency manifests are unchanged by this fix. Only the affected CLI was rebuilt, with artifact hashes recorded. No new full-root build, reinstall, all-package typecheck, full suite or Linux/VPS verification is claimed. A pristine reinstall/full rebuild repeat remains separate if clean-checkout distribution acceptance is required.

## Actual onboarding, not a stub-server smoke

Executed with `NODE_OPTIONS` and provider/database overrides cleared, no added loader argument:

```text
node cli/dist/index.js onboard --yes --data-dir <fresh-owned-home>
```

The disposable home is under this attempt, distinct from the retained native review instance. Loopback app port **3212** and embedded PostgreSQL override **54330** were checked free before launch. Deployment is `local_trusted/private`, static UI enabled, development middleware disabled, migration auto-apply enabled. No engine verification, Commander turn, task dispatch or model inference was deliberately requested; there is no claim that normal background housekeeping was disabled.

- Fresh config/key files created; all **nine doctor checks pass**. Doctor describes the persisted default DB port 54329, while the actual server/owned PostgreSQL command line uses the explicit 54330 override.
- Fresh embedded PostgreSQL initializes and applies **287 pending migrations**. `/api/health` reports `ok`, `authReady`, `bootstrapStatus=ready` and the exact tested revision; static UI returns HTTP 200. No PDF/canvas or DOMMatrix startup error remains.
- In the actual browser, entered dummy operator/Founder/timezone, organization **F05 Disposable QA**, company **F05 Startup QA**, and verified read/write access in an attempt-owned workspace folder. The persisted company is `52270e87-a248-46c1-8a9c-e0a12f501a8f`; a direct API read observed one company with issue counter 0 and the owned root folder.
- The UI reaches **Step 5 of 8 — Bring your engine online**, and reload retains that step. Screenshots and DOM captures are hashed in the evidence. Engine authentication/verification and the remaining wizard/crew/Commander journey were intentionally not exercised for this startup repair.
- The scratch runner's raw `initialCompanyCount` uses PowerShell array wrapping; it is not reliable evidence of a preexisting company or a before/after count. The explicit persisted company/API observation above is used instead.
- After browser verification, owned `pg_ctl stop` and process-tree termination both exit **0**. PID/parent/creation-time/command-line receipts are retained; **no observed owned processes or listeners on 3212/54330 remain**. This is an operator-stopped long-running server, not a fabricated natural successful CLI exit or graceful-shutdown certification. The retained review app on 3210 still reports healthy revision `6ebc400d2`.

## Observations and pending work

- **F05 bounded startup: complete.** Regression, actual fresh-home server/UI, persisted usable setup and owned cleanup are verified on the code candidate above.
- **Separate installation/journey scope:** real packed/installed onboarding, a new pristine reinstall/root-build campaign, and authenticated completion of all eight wizard steps/crew/Commander remain untested here. Installed resolution has executable fixture coverage only. No VPS rebuild was needed for this local packaging defect.
- **Retained non-blocking observations:** after company creation, the wizard briefly returned to populated Step 1; Continue resumed Step 4 without another company creation. Better Auth base-URL and SIGINT/SIGTERM listener-count warnings remain in stderr. These are not silently declared repaired.
- **Test-environment effects:** catalog access was intentionally pointed at loopback port 1, so company crew provisioning logged degraded offline/legacy catalog behavior. Dispatcher ticks reported zero reclaimed/drained/wakeups; this is not full crew or no-background-activity evidence. Stopping the database before terminating the server caused logged worker database-shutdown errors; they are preserved, not presented as a clean natural shutdown.
- **Unchanged pending findings:** strict F01 subprocess provenance and broader native acceptance; separately prerequisite-bound F02/F04 distributed/other-owner live cases; earlier UI reconciliation observations; qualified F06–F09 investigations. This pass does not close them or change the prior F03 bounded Planning verdict.

The [mutable completed/pending checklist](../plans/2026-10-16-local-vps-validation-handoff.md) links this result while retaining the earlier failures and limits.

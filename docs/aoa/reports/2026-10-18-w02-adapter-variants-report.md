# W02 adapter variants — 18 October 2026

**Branch:** `codex/replatform-w02-w05`. **Application candidate:** `5a2ed274ca644dcc9ca0614d11890fe9d129ab7c`, following `f17e0df54`. Documentation publication is a separate later commit. Report dates use India time; raw receipts retain UTC timestamps.

**Verdict:** confirmed offline adapter defects are repaired and pass targeted Windows/VPS verification. **Real vendor CLI/model/subscription/API-key qualification is skipped at the user's request**, not counted as a pass. Claude and Gemini are not installed on the user's system; no vendor CLI was installed, no provider/model run was initiated, and no personal authentication was copied or transferred. Full W02 acceptance remains open. See the [completed/pending checklist](../plans/2026-10-17-w02-w05-handoff.md), [portable evidence](../evidence/2026-10-18-w02-adapter-variants-summary.json) and preceding [authority/audit/shutdown report](2026-10-18-w02-authority-audit-shutdown-report.md).

## Confirmed defects and repairs

All repairs are in application commit `5a2ed274c`; no schema, dependency, execution architecture, rollout or credential-policy change.

| Confirmed defect | Minimal repair | Regression boundary |
| --- | --- | --- |
| Claude terminal `is_error:true` was hidden by process exit zero | Preserve the structured failure as a non-null adapter error | Actual no-auth Node protocol child; successful result remains successful |
| Gemini structured terminal errors and standalone fatal error events were hidden by exit zero | Track explicit terminal/standalone fatal state and expose the error; warning-only events remain nonfatal | Native `status:error`, legacy `status:failed`, missing detail, standalone error/system-error and warning control |
| Gemini discarded native and legacy initialization model identity | Retain reported init model and prefer it to the configured selection; retain configured fallback when absent | Native `init` and legacy `system/init` protocol records; not real model-entitlement evidence |
| Claude, Gemini and OpenCode timeout branches discarded metadata already parsed from stdout | Retain available usage/cached usage, cost, provider/model and existing billing classification while keeping timeout failure | Controlled child reports usage then hangs. Claude's fixture emits a terminal result before hanging; this is not complete partial-turn accounting |
| OpenCode's stdio connector path removed run-bearer aliases only from the overlay, after taking a prepared-runtime snapshot | Strip known bearer values from that snapshot too, and suppress re-inheritance of removed names at spawn | Configured and inherited harmless-name aliases are removed; HTTP-only and no-connector controls retain existing behavior. Fixture values are synthetic |
| Supervised Codex app-server turns closed the JSON-RPC client but left their tracked child running | Request existing tracked-child termination in `finally`, after success or handshake rejection | Actual no-auth Node JSON-RPC children reproduce both leaks before the fix and are observed closed/removed from the registry afterward |

OpenCode provider/model remain the **configured selection**, not newly observed model identity; its billing stays `unknown`. Timeout retention does not invent usage that the parser never received or convert reported model-equivalent cost into a newly established charge. The app-server wrapper **requests** termination; it does not synchronously await OS close. Its regressions independently wait for actual child close. Existing graceful shutdown/drain and deferred abrupt-crash custody are separate guarantees.

## Targeted verification — not the whole suite

Node **24.19.0**, pnpm **9.15.4**. The evidence JSON records the explicit **30-file** manifest, native exits, safe facts and hashes of retained raw receipts/harnesses.

| Check at exact clean application commit | Windows x64 local | Linux ARM64 VPS |
| --- | --- | --- |
| Same selected adapter/parser/runner/authority/cancellation/tracked-child files | **30 files passed; 243 tests passed / 2 POSIX-only skips**, exit 0 | **30 files passed; 245 tests passed / no skips**, exit 0 |
| Builds and typechecks: adapter-utils, Claude, Gemini, OpenCode, Codex and server | All six passed | All six passed |
| Dependency installation | Existing dependencies; manifests/lockfile unchanged | Frozen install passed in isolated copied source |
| Actual vendor CLI / model / provider execution | **Skipped by user direction** | **Skipped by user direction** |

The new regressions invoke actual **Node subprocesses** through the production adapter execute/parser or JSON-RPC lifecycle code. Their protocol records, model names, usage and costs are controlled fixtures, **not real model results, charges, useful AoA tool effects or persisted crew runs**. Existing provider-sandbox tests exercise mocked runtime delivery seams, not an acquired live provider sandbox. Shared crew authority/cancellation and Codex tool-capture regressions remain in the selected matrix; they do not establish per-vendor CLI cancellation or tool-audit acceptance.

Before each repair, focused failing reproductions were captured. The authoring captures identify HEAD `f17e0df54` while tests/feature states were uncommitted; they are not represented as pristine committed before-fix trees. The initial combined local check passed on frozen dirty source; the accepted repeat uses clean exact `5a2ed274c`, as does the VPS run. Printed final native totals are recorded separately from structured capture counters; unknown summary/unhandled-error counters remain unknown. Existing Windows Node `DEP0190` shell-wrapper warnings are retained, not hidden or presented as new failures. Independent Sol/high component and final-increment reviews found no actionable findings.

The [Gemini native output schema](https://raw.githubusercontent.com/google-gemini/gemini-cli/main/packages/core/src/output/types.ts) and [headless documentation](https://geminicli.com/docs/cli/headless/) support the protocol investigation; these references do not pin or certify an installed vendor CLI. Existing Claude parser contracts and adjacent fixtures are retained.

## VPS deployment and local preservation

The VPS serves exact `5a2ed274c` from `/opt/aoa-w02-adapters-20261018/source` under the existing non-root `aoatest` service. Rebuild, targeted tests and typechecks completed before replacement. Public health reports `ok`, ready `cloud_auth`/bootstrap and the exact revision; the static UI returns HTTP 200. The same Docker PostgreSQL container identity, data and OAuth configuration are retained. No database reset was needed; distributed execution remains disabled. Prior source/unit overrides remain available for rollback.

This increment did not repeat Google sign-in or Chrome interaction because no UI/auth flow changed; previous browser observations remain scoped to their earlier candidate. The original local review app on port 3210 remains healthy at `6ebc400d2fd4c4cf26b90d2c1d6466171d08f3e9`, unchanged. Local verification uses the current source and controlled subprocesses rather than relabeling that older app as rebuilt. Named local fixture scripts are absent after testing; the app-server tests independently observe their owned child close. This is not a global process/descendant-custody certificate.

## Completed versus pending

- **Completed:** the six defect groups above, before/after regressions, exact-candidate targeted local/VPS matrix, affected-package builds/typechecks, safe VPS replacement and preserved review data/configuration.
- **Skipped/pending by user direction:** real Claude/Gemini/OpenCode, vendor Codex app-server and provider-specific authentication, entitlement, inference, useful tool effects and per-variant cancellation. Do not request/install subscriptions or copy personal authentication merely to close this checklist.
- **Confirmed remaining audit gap:** shared crew successful-tool-name capture is currently Codex-exec-only. Non-Codex native namespace/result schemas and successful/failed/denied call attribution still require qualification before adding reliable bounded capture; no guessed-name/prose parser was introduced here.
- **Not a missing crew feature fixed here:** native crew Codex currently selects exec. Supervised app-server is an existing opt-in heartbeat/org transport; provider-target execution also remains exec. Enabling app-server for crew would be a separate behavior change, not an acceptance result of the lifecycle regression.
- **Previously deferred:** durable abrupt-crash/host-restart custody with host/start identity, PID-reuse safety and the spawn/persistence window. Existing tracked-child fixes do not recover children after a parent cannot run cleanup.
- **Unchanged:** W05's real supported-cohort VPS→PC output/export/UI-download acceptance, broader required CI/release gates and baseline/follow-up branch integration. No whole suite, recursive workspace-wide build/typecheck, merge, PR or release approval is claimed.

Raw receipts and harnesses are retained in sibling `validation-w02-adapters-2026-10-18/` and `/opt/aoa-w02-adapters-20261018/evidence`, outside Git and not clone-accessible attachments. The evidence JSON publishes selected safe facts and hashes only; no credential files, raw personal transcripts or databases are committed.

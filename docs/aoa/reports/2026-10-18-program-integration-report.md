# Baseline, W02/W05 and W12 program integration — 18 October 2026

**Superseding fixture follow-up — 18 October:** The current shared Windows migrated-fixture stop/error contract is repaired at `41f2c2a68dd89e62f68e85246d38878488650b40`: [report](2026-10-18-windows-postgres-fixture-report.md), [evidence](../evidence/2026-10-18-windows-postgres-fixture-summary.json). Targeted Windows/VPS checks each pass 4 files / 27 cases with no selected residue. The original `0896c4396` manual-cleanup observation below remains historical and accurate; original F09 attribution, other fixtures and production crash custody are not retroactively closed.

**Target branch:** `docs/replatform-program`. **Combined application candidate:** `0896c43961d2e19e2c7fd163f32c51c6e69d0889`. **Source tree:** `518e81d8abfd64d6d1d3d89884e9cd62e752e25e`. Documentation publication follows this frozen candidate. Dates use India time; raw receipts retain UTC timestamps.

**Verdict:** ordered program integration and exact-candidate targeted local/VPS assertions, scoped builds, native recovery checks and review deployment pass. **Windows DB-fixture automatic teardown left a child/listener requiring guarded manual cleanup**; resources are now cleared, but its root-cause/regression work remains open. Do not infer an automatic-cleanup pass from assertion results. This integration does not mark the full W packages, live journeys, release CI or production rollout complete.

## Authorized integration and source preservation

The user authorized these merges, in this order, into the existing program branch, followed by targeted local/VPS tests, updated documentation and a non-force push. No merge into `main`, whole-suite run, paid provider call, credential transfer or live campaign was authorized by this increment.

| Order | Source branch and exact tip | Program merge commit |
| --- | --- | --- |
| 1 | `codex/replatform-baseline-w00-w04` at `e3a6afaac52e6ec7df2b9cb5733591d3b2adbc41` | `30076d90dd64e07b8b452e17b87f7d137d531d01` |
| 2 | `codex/replatform-w02-w05` at `74a786efc2e299c03d39e27fbf1ce3919de2eada` | `85075c731e5b0b933a73b4d7a2d3ec09aece0cf0` |
| 3 | `codex/w12-worker-lifecycle` at `ba0d391642d75c3127852c7c499ba44d5b57c37d` | `0896c43961d2e19e2c7fd163f32c51c6e69d0889` |

The prior program tip was `13b4e806f31a67c3c172f2216272570203132f8f`. All three merges are explicit two-parent merge commits and completed without textual conflicts or manual resolutions. The first merged tree equals baseline, the second equals W02/W05, and the final tree equals the preflight merge simulation. Independent review verifies the parent order, W12's nine-file delta and preservation of W02/W05's final native auditing/artifact cancellation changes. No new production fix is introduced by this integration.

Source branches and the separate W12 worktree are retained. Historical reports and portable evidence are unchanged. `main` is not merged or pushed: its preflight baseline merge had 18 conflicted files across workflows, migration metadata/backup, server code, tests and documentation. Resolving those conflicts and the governed M5 main/weekly-verdict checkpoint remain separate work.

## Targeted selection and local results

The selection is the union of the committed W02 authority/audit/shutdown, adapter-variant, latest native-audit/artifact and F05 startup selections, plus W12's 12-file selection. Files are deduplicated within the union. The provider-root lane and 16-case artifact DB filter remain separate to preserve their original configurations. This is 80 selected Vitest files, not the whole suite.

| Windows lane | Files | Passed | Skipped | Failed |
| --- | ---: | ---: | ---: | ---: |
| Baseline F05 and W02/W05 union | 64 | 690 | 2 POSIX-only | 0 |
| W12 enrollment/session/retirement/restore boundaries | 12 | 88 | 1 native-fixture opt-in | 0 |
| E2B provider artifact/cancellation fixtures | 3 | 56 | 0 | 0 |
| Real-PG artifact grants/commit, selected names | 1 | 16 | 23 filter-skipped | 0 |
| **Total** | **80** | **850** | **26** | **0** |

All four JSON reports have `success=true`; process exits are zero. Skips are not passes. Separate Docker/Linux wrappers pass 4 outer cases, executing 1 native fence-restore and 2 database/object-recovery nested cases. Those nested cases are included within the outer checks, not another claimed fleet journey; their name-filter exclusions remain explicit in the raw reports.

Ten affected packages build and typecheck: adapter-utils, Claude/Gemini/OpenCode/Codex adapters, worker-daemon, sandbox-e2b-provider, adapter-manager, server and CLI. These are scoped package checks, not the authoritative root build or recursive whole-repository typecheck. Local Node is pinned to 24.19.0. The worker image is built from the combined candidate under its own integration tag/label.

### Actual fresh-home built-CLI startup

The normal built `node cli/dist/index.js onboard --yes --data-dir <fresh-owned-home>` starts without an external loader. HTTP health reports the exact candidate, `local_trusted`, private exposure and ready auth; `/` and `/onboarding` return HTML 200. The company list is empty; a new config and encryption key are created without publishing their values. This is an HTTP startup smoke, **not a repeated interactive browser wizard, packed-install acceptance or engine/model run**. The two selected CLI regression files also pass all 13 cases, including the real PDF/native-canvas dependency graph.

Owned CLI descendants and the fresh embedded PostgreSQL are stopped with identity/path checks; ports 3214/54334 and owned processes are gone. The original review app/database listeners on 3210/54329 retain their identities. W12's owned-label/native fixture containers are absent after its checks. These bounded observations do not certify global process cleanup or durable crash custody.

Nonblocking inherited diagnostics remain visible in private receipts: Node shell-spawn deprecation, expected mock/denial logs, and fresh-smoke BetterAuth base-URL/MaxListeners warnings. Generic capture unhandled-error counters remain `unknown`; this report does not turn that into a measured zero. Inherited source whitespace is not silently rewritten.

### Windows DB-fixture cleanup observation — not an assertion pass

A post-test scan found a new PostgreSQL `io_worker` child after the selected hub-curation real-PG suite passed. Captured suite output identifies its postmaster as PID 22976, started at 06:40:50 IST on loopback port 61080; child PID 21000 was created at `2026-10-18T01:10:56.561105Z`. The parent was absent, but the child and old-parent listener records persisted. These identities are absent from the pre-test scan and link the residue to this run, not the retained review database.

An exact PID/creation-time/parent/native-command/log ownership gate permitted `Stop-Process` for **only** that child. It succeeded without elevation; fresh scans confirm the child and both port-61080 listener records are absent, with original review listener creation identities unchanged. Private receipts retain the harmless diagnostic date-parser failures before the successful guarded action. No broad PostgreSQL termination, helper edit or production fix was performed.

Passing assertions therefore do **not** establish clean automatic Windows fixture teardown: this run required manual, ownership-checked cleanup. The shared migrated-database helper is unchanged by these merges and swallows stop errors; a shutdown-race explanation remains a hypothesis. Preserve the fresh ownership evidence and add a focused teardown regression/root-cause investigation as pending work. This does not retroactively establish the original F09 incident's attribution/root cause or a production custody defect.

## VPS verification and review deployment

The isolated source at `/opt/aoa-program-integration-20261018/source` is checked out clean at the exact candidate/tree above. Frozen install, required dependency-closure builds, the same ten affected-package builds/typechecks, a scoped UI build and an independently tagged ARM64 worker image all pass as non-root `aoatest`. This is not a whole-repository build/test run.

| Linux ARM64 VPS lane | Files | Passed | Skipped | Failed |
| --- | ---: | ---: | ---: | ---: |
| Combined baseline/W02/W05/W12 union | 76 | 780 | 1 native-fixture opt-in | 0 |
| E2B provider artifact/cancellation fixtures | 3 | 56 | 0 | 0 |
| Real-PG artifact grants/commit, selected names | 1 | 16 | 23 filter-skipped | 0 |
| **Total** | **80** | **852** | **24** | **0** |

The 76-file union partitions into 64 baseline/W02/W05 files with 692 passes and the same 12 W12 files with 88 passes / 1 skip. Linux executes the two POSIX-only cases skipped on Windows. All required final stage exits are zero and all three Vitest JSON reports are successful. The separate three native wrapper files pass 4 outer cases / no skips, confirming actual nested JSON with 1 fence-restore and 2 database/object-recovery cases.

After prerequisites passed, the guarded `zzzz-program-integration.conf` systemd drop-in replaced only the review application's source/revision. Public [health](https://testing.armyofagents.org/api/health) reports `0896c43961d2e19e2c7fd163f32c51c6e69d0889`, `ok`, ready `cloud_auth`/bootstrap; UI HTML returns 200. The same PostgreSQL Docker ID/data, private cloud environment identity, existing environment files and OAuth configuration are retained. Distributed execution remains disabled. Rollback was prepared but not needed. This is health/static-UI verification, not a repeated authenticated Google/browser/model journey.

Final owned-namespace scans found no embedded PostgreSQL processes or work-label containers; the recorded native fixture container is absent. Prior W12 directories/images/resources are untouched. No shared DB reset, global pruning, provider-key use or personal-auth copy occurred. The original local review application is unchanged.

Two setup-only failures are retained, not represented as test passes: the abbreviated bundle lacked a shallow-clone ancestor, so a full ancestry bundle was transferred; an initial dependency harness PATH omitted the pinned pnpm binary directory, so the external harness was corrected and a fresh captured dependency attempt passed. No application source was changed to resolve them. Vite chunk warnings remain visible in the private UI build receipt.

## Evidence, reproduction and limits

See the [completed/pending checklist](../plans/2026-10-18-program-integration-handoff.md) and [portable summary](../evidence/2026-10-18-program-integration-summary.json). Publication verifies 249 selected/changed source files against committed blobs and 141 retained raw receipt hashes, including the setup and Windows cleanup diagnostics. VPS raw bytes match committed blobs; local text is compared after UTF-8/LF normalization. Raw logs, fixture databases, generated auth/config and source archives remain private, outside Git, under sibling `validation-program-integration-2026-10-18/` and the owned VPS namespace. The summary publishes safe facts, commands, source identities and receipt hashes, never secret values.

For reproduction, use the exact recorded selected-file lists and name filter with one worker, `AOA_RUN_WIN_INTEGRATION=1` for Windows native DB lanes, Node 24.19.0 and pnpm 9.15.4. Build/typecheck the selected packages; the provider tests need their package root/config. Native wrappers use an independently tagged worker image and the three selected `tests/d1/m4-slot-ownership.test.mjs`, `m4-slot-host.test.mjs`, `m4-native-fence-restore.test.mjs` files. Use new capture directories and ownership labels. Do not run global Docker pruning or reset retained review databases.

Still open: real installed-vendor qualification, W05's ordinary VPS-authority → PC-worker generated-file/export/commit/UI-download and real SDK abort journey, W12's continuous restored live-fleet journey, durable abrupt-crash custody, broader native/installed baseline acceptance and formal CI/release gates. The [credential/backend prerequisites](2026-10-18-w02-native-audit-w05-cancellation-report.md#credentials-and-prerequisites-for-the-skipped-live-journey) remain applicable: one supported OpenAI **or** Anthropic cohort, verified CLI-bearing backend/template, admitted enrolled worker and reachable trusted S3/MinIO storage. Supplied E2B/OpenAI keys remain unused/unvalidated by this integration. Gemini/OpenCode credentials alone cannot enable missing distributed admission paths, and Google sign-in OAuth is not a Gemini model key. Rotate chat-shared credentials before production/long-lived use.

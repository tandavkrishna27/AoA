# Combined program follow-up verification — 18 October 2026

The completed Windows PostgreSQL fixture repair and W12 live-blocker fixes are integrated in application merge `5d7bad95831336d36dffef7e932ed1dc78f63324` (tree `8cf3597099653774d60866da53e0df02c47e9540`). Every selected build, typecheck and test stage passed on fresh local Windows x64 and VPS Linux ARM64 setups. Both fresh-home built-CLI HTTP smokes passed. This report and its [portable evidence](../evidence/2026-10-18-program-combined-followup-summary.json) describe that exact application merge; the later publication commit changes documentation only.

## Integration and coordination

The merge has exact parents `fdf1f5a5d99d8fe9a3e8338a4f053ce79b2f94c4` (program, including fixture code `41f2c2a68dd89e62f68e85246d38878488650b40`) and `389fcd9789a38dec2204b76ffbc2526a074c010a` (W12, including application fixes `c61b47660d8e2a3007f5059eb2a3577e99581cc2`). Their common base is `eed114e7c25fef2f7a34fb57a1d6df3150b90c69`. All 38 non-overlapping changed paths retain their originating-parent Git blobs exactly. The sole overlap/conflict was the program handoff Markdown; resolution retains both completed increments and their outstanding qualifications. No additional application source change was needed. The retained fixes cover governed per-run Codex stdin login and authentication cleanup, snapshot-consistent owner-default backup ACL preservation, the authorized canonical-target successor operation, and awaited Windows migrated-fixture shutdown/error handling.

The other chat, **Find VPS testing requirements**, confirmed no newer completed changes or unpushed commits beyond its program handoff, and stayed read-only. This chat held sole merge/test/VPS/cleanup ownership (`PROGRAM-ROOT-2`). An independent Sol reviewer checked the merge graph and preserved blobs before testing; final publication received a separate evidence review.

The isolated local checkout is `C:/Users/Dell/Desktop/aoa/program-combined-verification`, on `codex/program-combined-verification`. Publication targets remote `docs/replatform-program` through a normal fast-forward push. The original local review checkout remains at its earlier program tip to preserve its running source. No main integration, release approval or shared review redeployment is part of this work.

## Fresh setup and source identity

Before testing, old owned disposable namespaces were confirmed absent, unused prior owned worker images were removed, and obsolete local transfer bundles were removed only after verifying their contained commits were reachable. The new local worktree had no dependencies. The VPS received a fresh Git archive into `/opt/aoa-program-combined-20261018/source`; no compiled output or node_modules was copied from the review deployment. Both hosts used Node 24.19.0, pnpm 9.15.4 and fresh frozen offline installs from retained package-download caches. Test environments excluded ambient provider credentials.

The VPS export contained 8,378 tracked files. Archive SHA-256: `07162417fe0d01d36197d11b19fcef25a29fff1b958655120c7f706973d41080`; manifest SHA-256: `07f13c1c977e9a2ffff72526a8147ddf22100615b1b24b03dc131e6c4fae0a18`. Every exported tracked-file hash was checked after each stage and before teardown. The VPS export has no `.git`, so child capture `gitSha: null` is expected; source attribution comes from this manifest. Local captures record the clean Git candidate. Windows working-tree line endings and Linux archive bytes follow their respective Git checkout/export behavior.

## Targeted results

All 14 stages on each host exited zero: frozen install, selected dependency-closure build, scoped package typecheck, UI build, core tests, provider tests, artifact DB tests, writer tests, replay tests, API helper tests, output-probe guard tests, worker-image build, native Docker tests and scoped fixture TypeScript check. The evidence contains exact commands, selected files/packages, durations and raw-capture hashes.

| Lane | Local Windows x64 | VPS Linux ARM64 |
| --- | --- | --- |
| Core, 87 files | 978 pass, 3 skip, 0 fail | 980 pass, 1 skip, 0 fail |
| Provider, 3 files | 56 pass | 56 pass |
| Artifact grant/commit DB subset | 16 pass, 23 name-filtered | 16 pass, 23 name-filtered |
| Writer subset | 1 pass, 19 name-filtered | 1 pass, 19 name-filtered |
| Replay subset | 2 pass, 38 name-filtered | 2 pass, 38 name-filtered |
| W12 API helper | 6 pass | 6 pass |
| Output-probe guard | 65 pass, 1 retired-case skip | 65 pass, 1 retired-case skip |
| Worker/native Docker | 4 outer pass, 0 skip/fail | 4 outer pass, 0 skip/fail |
| Migrated-fixture native cycles, within core | 3 complete with empty per-cycle process/listener scans | 3 complete; final owned scans clear |
| Selected 13-package build/typecheck, dependency build closure, UI/image build, fixture test-source typecheck | Pass | Pass |

The two extra Windows core skips are POSIX-only child-shutdown cases. The remaining core skip on both hosts is the native-restore opt-in, executed separately by the Docker lane. Name-filtered cases are not passes. Vitest suite counts include nested describe blocks; the table uses actual file/case counts.

The four outer native cases cover Linux slot-host ownership, process/storage isolation and crash/restart continuity, lock behavior, and full-schema stale-authority rejection after restore. The restore outer case includes one native restore case and two database/object-recovery cases; these three nested executions are not added to the outer total. It used PostgreSQL 18.6, image digest `sha256:2358fcba361ed2233a5ed81b5fe4ca779ccb304120ce531a3bf51c0ed7e2bc11`. Recovery storage is a disposable local-file engineering fixture. The three migrated-fixture cycles on each host recorded requested/completed shutdown and removed database directories. VPS per-cycle process/listener fields are null; final namespace scans supply the VPS residue check.

The actual built CLI ran `onboard --yes --data-dir` with a fresh private home on local ports 3214/54334 and VPS ports 33124/25434. Both reported the exact candidate, private/local-trusted health, zero initial companies, fresh config/key creation, and HTTP 200 HTML for `/` and `/onboarding`. Operators stopped each long-running CLI and its owned database; final owned process/listener scans were empty. These are HTTP startup smokes, without a browser wizard, company creation or model execution.

## Teardown and preserved review

The shared local review app PID 6780 and database PID 11492 kept their recorded creation identities. VPS `aoa-validation.service` retained PID 301667 and its original active timestamp; `aoa-validation-cloud-db` retained full container identity `3d5f59c4c990e1515d8871dbd36be02f671f0eae315d2576cef86bc811d082b0` and start time. VPS shared health remained HTTP 200. No shared review source, configuration, OAuth, database, Caddy configuration or rollout setting was changed.

After archiving and verifying raw evidence, owned test processes, listeners, containers, worker images, private homes and database state were removed. The entire VPS test source/evidence staging namespace and transfer directory were removed; only the small safe evidence archive remains at `/opt/aoa-program-combined-evidence-20261018`. Local untracked compiled output and dependencies were removed with one explicit exception: **14 native-file hardlinks, 98,336,640 logical bytes, remain under the isolated worktree's node_modules**. Windows refused their removal because the same pnpm-backed file identities are loaded by the protected review PostgreSQL, esbuild and canvas processes. Hardlink inventories and process-module ownership were recorded. No test process remains, and no shared process was stopped or shared file ACL/content changed to force deletion. The local source worktree and reports remain available for review.

## Evidence retention

Raw files were checked against archive member hashes before runtime deletion, and checked again on retrieval. Private runtime homes and generated keys are excluded.

| Archive | Files | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Local `local-evidence.tar.gz` | 93 | 557,917 | `4ec03a707bb53838c9d60fcad414b33603b30ed9071948ead1c6512c9146b0b7` |
| Local final cleanup `local-cleanup-final-evidence.tar.gz` | 5 | 5,124 | `237f8627ea0391235efedb27d0c7a649e4a327466d076c4d95d98f9edea64170` |
| VPS `evidence.tar.gz` | 81 | 564,077 | `8459370ff977cf3f4070b6a0d024c7eb5ff1cf00d790b88423024fb6d8188d49` |

Local evidence is retained outside Git at `C:/Users/Dell/Desktop/aoa/validation-program-combined-2026-10-18` (VPS copy in its `vps` directory). The original local archive preserves the first cleanup-helper version; the final cleanup archive contains the corrected helper and final hardlink exception receipt. Later helper edits do not rewrite the immutable original archive. An intermediate cleanup snapshot is retained as history; the final receipt is authoritative.

## Remaining qualifications

This integration reran targeted local/VPS engineering acceptance, including native restore, successor ACL/concurrency, fixture shutdown and authentication/cleanup regressions. The [prior paid W12 restored-live journey](2026-10-18-w12-restored-live-report.md) at `c61b47660d8e2a3007f5059eb2a3577e99581cc2` remains historical evidence. No E2B/OpenAI credentials or paid/provider calls were used in this combined verification, and no paid live-fleet run was repeated.

The [program handoff](../plans/2026-10-18-program-integration-handoff.md) retains broader baseline provenance/distribution gaps, W02 installed-vendor/model/transport/cancellation and durable crash custody qualification, W05 PC-worker artifact/export/download and SDK abort/late-effect acceptance, expanded fleet/external-store failure domains, D5 timings, automatic staged-orphan recovery and governed main integration. Applicable CI/PR/release approvals remain separate. No whole suite, root build or whole-repository recursive typecheck is claimed. The older 18-conflict main preflight is historical evidence, not a fresh conflict count for this candidate.

# Program integration — completed and pending

**Branch:** `docs/replatform-program`. **Application candidate:** `0896c43961d2e19e2c7fd163f32c51c6e69d0889`. See the [integration report](../reports/2026-10-18-program-integration-report.md) and [portable evidence](../evidence/2026-10-18-program-integration-summary.json). Checked items certify only the stated bounded work, not full W-package or release acceptance.

## Completed

- [x] Fetch origin and merge baseline `e3a6afaac`, W02/W05 `74a786efc`, then W12 `ba0d39164` into the program branch using three explicit merge commits. No conflicts or manual resolutions; no main merge, source-branch deletion or new production edit.
- [x] Independently review exact merge parents/tree and preserve both the final W02/W05 code/evidence and W12's test/documentation increment.
- [x] Verify the clean combined candidate locally: 80 targeted Vitest files, 850 pass / 26 skips / zero failures, plus 4 Docker/native outer cases including 3 nested executions. Keep filter/native/platform skips explicit.
- [x] Build/typecheck the ten selected packages locally; build the independently tagged worker image. Do not call these the root build or whole-repository verification.
- [x] Exercise actual fresh-home built-CLI startup over HTTP on local 3214/54334: exact candidate health, UI/onboarding HTML 200, no companies, fresh config/key. Dispose owned app/DB with identity checks; preserve original 3210/54329 and prior W12 resources. No browser wizard or model run.
- [x] Attribute the observed Windows hub-curation PostgreSQL child/listener residue using current-run parent logs and process creation identities; clear only that child with a guarded stop. Confirm its old fixture listeners are gone and original review resources are unchanged. This is manual cleanup, not an automatic-teardown pass.
- [x] Verify the isolated exact VPS candidate: 80 selected Vitest files, 852 pass / 24 skips / zero failures, plus 4 Docker/native outer cases including 3 nested executions. Frozen install, required dependency closure, selected package build/typechecks, scoped UI and worker-image builds pass. Preserve setup-only failed attempts separately.
- [x] Replace only the VPS review app with the verified candidate; exact public health/static UI pass. Retain DB identity/data, private configuration, OAuth and rollout `false`; final owned fixture process/container scans are clear and prior W12 resources remain untouched.
- [x] Publish the combined report and safe evidence/checklist; verify 249 source-file hashes and 141 raw receipts, including manual Windows cleanup qualifications. Preserve earlier immutable reports and evidence.

## Pending — not closed by a clean program merge

- [ ] Integration/release owner: obtain applicable PR/CI approvals separately. No whole suite, authoritative root build or recursive whole-repository typecheck is claimed here; the user authorized targeted checks only. GitHub CI discovery currently needs connector account connection.
- [ ] Baseline owner: retain strict F01 provenance, native/installed/packed-distribution and broader engine/crew acceptance gaps. F06–F09 and historical TST-012/TST-013 attribution remain qualified investigations unless original evidence establishes their causes.
- [ ] Windows test-fixture owner: investigate and regress the current hub-curation `io_worker`/listener residue. Current-run ownership and successful guarded manual cleanup are evidenced, but root cause and automatic teardown remain unresolved. Do not infer the original historical F09 attribution or a production custody defect from this new observation.
- [ ] W02 owner: perform real installed-vendor/transport tool-effect, model/entitlement and cancellation qualification when selected prerequisites are available. Native schema fixtures are not that live acceptance. Separately design and qualify deferred durable abrupt-crash/host-restart custody.
- [ ] W05 owner: select/provision a supported admitted provider/backend/worker/storage cohort, then execute normal VPS-authority → PC-worker generated-file/export/commit/UI-download with exact bytes/digest/size, foreign/stale denial and cleanup. Measure actual SDK abort/late effects; do not substitute SQL/scripted placement or copy personal auth.
- [ ] W12 owner: run one continuous actual authority-restore journey: old authority cannot resume effects/ordinary commits, an operator-enrolled replacement performs useful governed work, and orphan outputs remain quarantined. Repeat applicable W14/W15 expanded-topology/external-store cases with real failure domains and measured recovery times.
- [ ] Platform owner: use protected least-privilege model/E2B/storage configuration; verify template, worker enrollment/profile/placement and HTTPS object-store presigning. One supported OpenAI or Anthropic model key suffices for the first cohort; all three vendor keys are not needed. Existing supplied keys are still unvalidated/unused; do not transfer worker private keys or personal CLI auth.
- [ ] Program owner: leave `main` integration for its governed checkpoint. The 18 preflight baseline/main conflicts remain unresolved; do not remove the weekly-main block or assume this program merge grants release approval.

## Pickup rules

Keep earlier immutable reports/evidence unchanged. Treat this application SHA separately from its later documentation commit. Reproduce only the recorded scoped lanes, with fresh captures/labels and exact source identity. Preserve original review resources and use owned fixture IDs/path/creation identities for teardown; never global-prune Docker or reset shared data to make a test green.

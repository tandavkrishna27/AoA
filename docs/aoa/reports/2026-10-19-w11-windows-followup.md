# W11 and Windows integration follow-up — 19 October 2026

**Later scope decision, 19 October:** The founder deferred performance optimization. The historical load/fairness FAIL results below are retained and are now non-blocking, deferred optimization findings for implementation. Do not rerun performance campaigns or continue profiling in this phase. Functional regressions remain required. See the [current test policy](../plans/2026-10-19-implementation-test-policy.md); no historical verdict or threshold is changed.

Scope: repair the observed capacity/polling delay and Windows fixture timing/teardown failures, use targeted checks, leave full-suite verification to GitHub CI, and stop disposable applications. This follow-up does not close expanded D5 or the remaining W13/W17 campaigns.

## Changes

- `02fb2513bfe05fbcf2d229b911ea57c5da8f7bb0`: a worker that advertised a saturated workload slot can wake its no-work wait when a handoff releases that slot. Idle polling, transient-error backoff and drain cadence retain their existing delays. A gated-cadence regression failed before the fix and passes afterward.
- `9d045e907c0ab25aed22df2b2cff93f2ad9fdce8`: an accepted terminal event wakes queued polling only after the durable outbox cursor covers it. Partial/replayed ACKs, ACKs arriving during a poll and transient/drain waits have targeted coverage. The first live trace showed terminal acknowledgement followed by about 900 ms of unnecessary polling delay. Four regression failures preceded the fix; the five-file worker selection then passed 69 tests.
- `5b5240225ea3b333cf2f8f8058b3040ec5e53f15`: job-control, startup and DR fixtures reuse the existing receipt-checked Windows `pg_ctl` shutdown. Client/stop failures are surfaced, and failed cleanup retains its directory. The real Windows regression checks graceful shutdown logs, repeated/concurrent teardown, directory deletion and port reuse; it failed against the force-killed fixture.
- Browser app import now belongs to fixture setup. Windows startup fixtures prepare the shared TSX transform cache in a separate naturally exiting app-import child. Every actual security boot still uses a fresh child and its existing 30-second watchdog. No request threshold, arrival rate, quota or drain deadline was increased. Scanner coverage and implementation are unchanged.

## Targeted Windows and combined local verification

| Check | Result |
|---|---|
| Final fixture ownership/failure/idempotency checks plus real Windows shutdown regression | PASS: 18 tests, zero failures/skips |
| Signed browser GET and two formerly timing-out flag-off startup cases | PASS twice: 3 tests per run, zero failures; 174 name-filtered cases per run |
| Remaining original startup failures: zero-bootstrap-work controls, bad app login, `heartbeat_runs` grant-option ACL | PASS: 3 tests; 146 name-filtered cases |
| Scoped server typecheck | PASS after building required SDK/worker declarations |
| Worker polling/backpressure/outage/drain checks | PASS: 16 tests on Windows and Linux VPS |
| Final worker terminal-ACK/dispatch/outbox/polling selection and worker types | PASS: 69 tests on Windows and Linux VPS; scoped types and boundary checks pass |
| Combined program-equivalent local tree `3f7c55e1a50a7ca4f0bc8143b7a59d009764ff54` | PASS: 33 tests across five files, zero failures/skips |
| Final combined code tree `7cac9301ddb03e30f12b8924acdf73b09a3fc731` | PASS: 89 tests across seven files, zero failures/skips |
| Linux shared-helper/modelled recovery follow-up | PASS: 17 helper tests and four DR tests; one existing native case unselected |

The signed GET takes 1.419/1.440 seconds after setup separation, versus 22.624 seconds in the earlier targeted capture. The repaired flag-off cases take about 18.7 seconds for the two-boot drift case and 9.4–9.5 seconds for the usable control, within unchanged limits. This is test-fixture stabilization, not a cold native application startup performance certification.

Earlier attempts remain evidence: missing SDK build products, a TSX command setup error, and the reproduced cold startup watchdog failures are not passing runs. Operator-denial/certificate, scanner and four modeled DR controls passed after the shutdown correction and before the final timing-preparation edits. Those controls are qualified to that intermediate source. The original scanner contention and full-suite Windows flake rate remain unqualified; no whole-suite retry was run.

Raw Windows commands, source hashes, per-case results and 38 artifact hashes are retained outside Git under `validation-w11-windows-fixes-2026-10-19/windows/`. The combined local capture and receipt are in that directory's parent. The tested local worktree and program code commits have identical Git trees despite different cherry-pick order, before this documentation-only publication.

## W11 live measurements

These are bounded two-organization/two-daemon tests with the deterministic provider, not paid-provider or expanded D5 acceptance. Both keep 2/s quiet versus 20/s noisy arrivals, 15 seconds of arrivals plus 30 seconds of immutable drain, organization quota eight and the original verdict thresholds. Default retains one batch slot/eight provider operations; historical64 retains its documented 64-slot/64-operation profile. Refusals stay in the scheduled-job denominator.

Final worker source is VPS snapshot `92f328902277a1249a9a46024a6be7e84a226487`; control-plane and fake-provider images are reused from `f1ee60c4c9d648c907dd62e2018907849f9d59a4`, with their actual provenance retained. The new worker was built on the VPS. A normalized comparison against the program candidate found the expected 13 changed files and zero unexpected content differences. The Windows-created source archive converts text to CRLF, so raw Git tree IDs differ; this is not a byte-identical Linux clone claim. The first snapshot used the earlier 250 ms test guard; the final snapshot has the 5-second guard, which preserves the gated-cadence assertion without adding a short Windows scheduling deadline.

The first capacity-wake candidate improved the VPS default baseline from the historical 18/30 successful jobs to 25/30 at the original deadline, but remained **FAIL** with five API refusals. Its loaded phase remained **FAIL**: quiet 18/30 and noisy 17/300 successful by the deadline. Submit/poll/event-ACK p95 were 116/198/190 ms in that loaded phase, with no 5xx, transport errors, censored requests or timeouts. These intermediate results prompted the terminal-ACK correction; they are not final acceptance.

The separate instrumented historical-profile diagnosis found no JIT section in 19 slow plans, so no PostgreSQL JIT setting was changed. Instrumented SQL/CPU observations are diagnostic, with no matched telemetry-overhead calibration. No authority-chain redesign or durability/profile tuning was included.

Final default-profile verification uses the terminal-ACK correction: **baseline PASS**, 30/30 successful by the fixed deadline, zero refusals/misses, and 28 completions during the arrival window. The loaded phase remains **FAIL**: quiet 25/30 successful with five refusals; noisy 26/300 successful with 274 refusals. Quiet throughput is 1.2/s versus baseline 1.8667/s (ratio **0.642857**, required ≥0.9). Queue-to-ACK p95 is 5437.227 ms versus 1393.759 ms (ratio **3.901124**, required ≤2). Submit/poll/event-ACK p95 are 171.372/203.401/221.967 ms; there are no 5xx, transport errors, censored requests or timeouts. The strict loaded/comparison verdict therefore remains red. Its project teardown has zero remaining containers, volumes and networks.

Final historical64 verification also has **baseline PASS**, 30/30 successful with zero refusals/misses, 29 arrival-window completions and queue-to-ACK p95 933.067 ms. Loaded remains **FAIL**: quiet 30/30 successful with zero refusals/misses, noisy 31/300 successful with 269 refusals. Quiet arrival throughput is 1.4667/s versus baseline 1.9333/s (ratio approximately **0.759**); queue-to-ACK p95 is 3220.602 ms (approximately **3.452×** baseline). Loaded submit/poll/event-ACK p95 are 327.307/493.211/447.879 ms, with no 5xx, transport errors, censored requests or timeouts. All quiet jobs eventually meeting the fixed deadline does not rescue the failed arrival-window fairness thresholds.

| Final VPS profile | Baseline | Loaded | Strict comparison |
|---|---|---|---|
| Default | PASS: quiet 30/30 | FAIL: quiet 25/30, noisy 26/300 | FAIL |
| Historical64 | PASS: quiet 30/30 | FAIL: quiet 30/30, noisy 31/300 | FAIL |

**W11 loaded admission/fairness remains unresolved.** The two measured worker idle gaps are repaired and the default baseline now passes; neither loaded gate is closed. Full D5 and matched telemetry-overhead/internal resource-span qualification remain open. No additional authority-query redesign was included in this bounded batch.

Commands, actual exits, per-stage timings, image IDs, raw/normalized source hashes and all original/intermediate/final reports are retained under `validation-w11-windows-fixes-2026-10-19/w11/result.json` and `w11/private-vps/`. The private evidence archive was copied and independently SHA-256 verified as `6d9d57d2e10b321ee26af914d62daa86f7cfd6da5efa9a03e5eb0a80e7864782` before disposable VPS files were removed.

## Cleanup and remaining acceptance

The final Windows fixture census has zero owned processes and temporary fixture directories. The combined local census also has zero owned processes, Docker containers, volumes and custom networks. Native Git removed both completed W17 worktree registrations and all their regular files; only the primary checkout remains registered. Empty directory scaffolding remains. Automatic approval review rejected its subsequent empty-directory removal with `blocked by policy`. The older orphaned `w11-capacity` and `w13-service-realtime` directories also retain their previously recorded deletion block. No alternate deletion method was used.

VPS teardown and an independent post-cleanup check verify zero containers/volumes/networks across all four task projects, zero task-labeled images and zero Node/PostgreSQL processes. All four owned images, the exact disposable task directory and the remote evidence archive were removed. Shared runtimes/download stores, protected credentials and unrelated W12 volumes/networks were preserved; no global Docker prune was used. Evidence is retained locally. `local-cleanup-final.json` and `vps-cleanup-independent.json` retain the final scopes and observations outside Git.

Full-suite verification remains with GitHub CI. Expanded W11 D5, production-provider qualification and the previously open W13/W17 acceptance items remain open. Historical captures and protected credentials are retained; the unrelated untracked fleet design document and `main` are untouched.

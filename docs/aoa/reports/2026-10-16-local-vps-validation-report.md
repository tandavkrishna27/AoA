# Local + VPS Validation Report — 16 October 2026

- **Branch:** `codex/replatform-baseline-w00-w04`
- **Tested application:** `05522b0f22e9df84ddfa6d3444d0362e4ad8a6cd`
- **Verdict:** Not fully green; not native end-to-end or release acceptance.
- **Supersedes:** None. This is a new validation attempt, supplementing the historical 15 October evidence.
**Record policy:** Preserve this report after its first commit; publish subsequent corrections/reruns as new records. Update the [pickup checklist](../plans/2026-10-16-local-vps-validation-handoff.md) as work proceeds.

This is a sanitized publication of the operator's `validation-2026-10-16/TEST-REPORT.txt`, including the later user retry. No application fixes were made during validation. The documentation commit publishing this report is **not** a newly tested application candidate. Dates refer to Asia/Calcutta; the retry observation was at 19:57 IST on 16 October.

## Scope and environment

- The [completion plan](../plans/2026-10-16-replatform-completion.md) records W00/W01/W03/W04 implementation. Implementation present does not mean all live acceptance is closed. W02 and W05–W18 remain separate work.
- Windows x64 PC and a newly provisioned Ubuntu 26.04.1 ARM64 VPS, with 4 CPUs and 7.5 GiB RAM. Both used isolated Node **24.19.0** and pnpm **9.15.4**. The native app used isolated Codex **0.145.0**; global tools and the original owner login were preserved.
- Native app: private `local_trusted` / `local_single_user`, loopback port 3210, embedded PostgreSQL. Cloud app: HTTPS at `testing.armyofagents.org`, `cloud_auth`, loopback app/database ports, one authority, local-disk storage. Distributed rollout remained disabled on the public cloud app.
- The user separately authorized fresh local/VPS testing and disposable data. That authorization was separate from the [planning document](../plans/2026-10-16-local-vps-validation.md). This record/checklist does not authorize another deployment, credential transfer, paid-provider substitution or release rollout.
- No personal login/auth home was transferred to the VPS. Google OAuth and E2B infrastructure credentials are not model-provider credentials; no cloud company model key was supplied for positive inference.

## Automated results

Counts below are from the **native final summaries**, not inferred from partial logs. Capture JSON fields marked `unknown` were not rewritten. See the [portable evidence summary](../evidence/2026-10-16-local-vps-validation-summary.json) for source receipts and hashes.

| Check | Windows/local result | VPS/Linux result |
|---|---|---|
| Fresh frozen installation | Pass | Pass |
| Authoritative root build | Pass after session-only Git Unix tools PATH correction; initial failure retained | Pass |
| Recursive typecheck | Pass | Pass |
| Capture self-tests | 6 passed, 2 Linux-only skips | 8 passed |
| Focused nine-file regression | 252 passed, 1 failed; exit 1 | 253 passed; exit 0 |
| Complete startup/PostgreSQL/ACL test file | All 149 passed, Windows integration opt-in enabled | All 149 passed |
| Normal full suite — files | 2,523 passed, 3 failed, 227 skipped / 2,753 | 2,743 passed, 10 skipped / 2,753 |
| Normal full suite — tests | 24,360 passed, 3 failed, 2,132 skipped / 26,495 | 26,414 passed, 81 skipped / 26,495 |
| Normal full suite — outcome | Exit 1; one unhandled artifact rejection; native duration 1,238.62 s | Exit 0; native duration 3,178.13 s |

### Docker and recovery engineering fixtures

| Check | Observed result and limit |
|---|---|
| Exact-source deterministic D1 spine | 10/10 passed; verdict controls 129/129 passed. No real model inference. |
| Windows-driven D1 fault profile | 25/26 passed, exit 1. The expired-enrollment case explicitly requires Linux uid/gid and private-file ownership and refused `win32`. |
| Selected expired-enrollment case on a real Linux runner | 1/1 passed: natural expiry, real restart, HTTP 401/idle refusal, original worker restored. **Not** a complete Linux fault-profile run and **not** a replacement green verdict for the Windows profile. |
| Linux worker slot/ownership fixtures | 2/2 passed in the rebuilt worker image. |
| Native CLI/full-schema restore fixtures | 2/2 top-level passed. Nested native stale-fence restore case executed; two database/object recovery cases executed. SQL/gzip restore, migration journal/company payload preservation, malformed/partial COPY refusal and rollback, stale authority rejection, corrupt/missing artifact quarantine and healthy-sibling readback were observed. Synthetic fixtures, not D5 RPO/RTO or expanded staging. |

Local Linux amd64 image IDs built from the tested source:

| Image | Image ID |
|---|---|
| Control plane | `sha256:d38cfaacd7c1a09608e2aee91eb69dc4388c91d2e7febdada5b996d3d963111c` |
| Worker | `sha256:198bafaf6da1e3c63511c86ab0235b54b99a57c676f93635895fed4999c61eb3` |
| Deterministic provider | `sha256:9f904ff9ab4819ec63a01e617a48f6a27ce8a1608cb4a1a710d9527d7887b121` |

These are local image identities, not a claim of registry publication or of Linux ARM64 images.

## Native subscription and live application results

Saved Commander and crew models remained **NULL**, with `cliTool=codex` and provider `openai`. The real account-scoped catalog identified **`gpt-5.6-sol`** as its default. No retired 5.5 model override or API-key fallback was used. A catalog default is not per-run provenance where a run's recorded model is absent.

- Native onboarding/hello verification passed. Commander returned and persisted exactly `AOA_NATIVE_05522_OK`.
- A real Scout mention produced durable, agent-authored `AOA_SCOUT_05522_OK` in the test discussion. This is positive crew-reply evidence, not complete W02 background tool/task, cancellation or restart acceptance.
- Native discussion extraction **failed before inference**: Codex 0.145.0 rejected `--ask-for-approval` after `exec`, exit 2. The parser-only control with the root option before `exec` exited 0; it made no inference calls. See [F01](../plans/2026-10-16-local-vps-validation-handoff.md#f01-native-extraction-argv).
- The initial Commander creation flow displayed literal `⚡OPTIONS:{"confirm": true}⚡` markup. Its confirmed next turn hit upstream HTTP 503 and showed a saved-message Retry state. At the initial observation no task existed. The observer did not retry or substitute a provider; the underlying CLI emitted reconnect attempts.

### User retry: creation recovered, planning-mode requirement still fails

After the initial report, the user retried that turn. Read-only browser and API verification at **19:57 IST** confirmed:

| Field | Persisted observation |
|---|---|
| Task | `QAN-1`, `5ab995d7-6774-474b-814c-13b96cfdcdaf` |
| Title | `QA Commander tool smoke 05522b0f2` |
| Status | `backlog` |
| Assignee | Neither agent nor human assigned |
| Execution | `executionRunId=null`; UI showed Not started; no task-linked Commander/crew run observed |
| Requested mode | Planning |
| Actual mode | **`standard`**, also displayed as Standard in the UI |
| Conversation | Persisted creation confirmation plus the literal OPTIONS approval text |
| Company crew | Paused; zero active Commander/crew runs observed |

Task creation/tool side effect is now positively verified. This supersedes the **current-state** statement that no task exists, but does not erase the original 503 or make the requested planning-task journey pass. No additional message, approval or mutation was sent during verification. See F03/F04 in the checklist.

## Cloud and provider results

- Real Google OAuth sign-in and disposable organization/company onboarding passed against the registered HTTPS callback.
- `QAC-1` was created in planning mode, unassigned, changed to Done, reloaded and verified persisted. No task execution was requested.
- The cloud Commander no-key/unsupported boundary **failed to communicate failure correctly**: UI showed online, a bounded send ended with only the user message, and the durable user turn was `failed` while the run was `completed` with NULL summary/error. The stored `gpt-4.1` label is **not** evidence that that model ran. Source inspection also found streamed errors did not latch failure before the route's completed update. No positive cloud inference claim is made. See F02.
- Real production `RealE2bTransport` smoke passed five checks: create, streamed execution with provider-key absence in the guest, bounded file readback/hash, native nonzero exit classification and get-info. One base sandbox with a 120-second lifetime; no template build or inference. Termination and absence were verified. This is a transport smoke, not application-originated distributed job acceptance.

## Remaining failures and diagnostic classification

| Finding | Observed evidence; do not over-interpret |
|---|---|
| Native extraction argv | Deterministic pre-inference exit 2; root-option parser control exit 0. No product fix applied. |
| Cloud failure/status/provenance | Empty visible reply; failed user turn recorded as completed run with no error and a legacy model label. |
| Planning-mode mismatch | User retry created a real task, but its description saying planning did not set `workMode=planning`. |
| Approval presentation | Literal OPTIONS markup persisted. Do not bypass runtime approvals to make the text disappear. |
| Bundled CLI packaging | Built `cli/dist/index.js onboard --yes` failed `ERR_MODULE_NOT_FOUND` for `zod` under strict pnpm. Supported source CLI started successfully. |
| Long Windows custom data home | Deep managed auth home caused Codex SQLite-state initialization/catalog failure. Same pinned CLI/account succeeded with a shorter home. Workaround only; not proof normal default paths fail. |
| Artifact race/unhandled rejection | Focused stalled-upload/destroy expected `WireProtocolError`, got `ResourceNotAvailableError`. Full Windows lane also had one unhandled `WireProtocolError` during queued export/deadline handling. Quiet isolated artifact file later passed 34/34. W05/TST-013 remains open. |
| Other Windows full-lane failures | Job-leasing AST test exceeded 30 s; exhaustive IPv4 OAuth deny-table test exceeded 180 s; component create-over-wire failed fetch/bad port. Their three complete files passed 55/55 after Docker teardown. Ephemeral `listen(0)` selecting a fetch-blocked port is an inference; the failing port was not captured. Original red full-lane verdict remains. |
| Residual fixture process | One detached focused-fixture PostgreSQL child remained after its parent ended. It was identified separately from the native application's DB and stopped. Passing startup assertions do not certify all child cleanup. |

One scratch isolated-artifact attempt had invalid PowerShell single-item-array splatting, selected unintended files and was stopped. It is not valid isolated evidence. The corrected argv run is the 34/34 diagnostic above. An outer Windows SSH client also lingered after remote native completion and was closed only after retrieving durable remote exit 0; the client cleanup does not replace the native suite verdict.

## Not accepted or not exercised

- Native **TST-008 remains open**: extraction failed and the requested planning-task semantics were not honored. W02 useful background task/tool, cancellation and restart acceptance is incomplete.
- A positive cloud model journey needs an explicitly supported Company model credential and execution configuration. Google OAuth and E2B keys do not meet that prerequisite; no personal-host-login or paid-provider substitute is permitted.
- No actual VPS-authority → personal Windows worker output/export/download journey, device credential activation/revocation, or reverse-direction enrollment acceptance was performed. Independent databases do not federate.
- No complete Linux D1 fault-profile aggregate, provider network campaign, capacity benchmark, expanded-staging D4/D5, 72-hour continuity or 14-day D6 acceptance is claimed. Platform/credential/opt-in skips remain skips.
- Follow the completion plan for W02 and W05–W18; these bounded results do not expand support rows or release exposure.

## Evidence custody and final resource state

The original report, native stdout/stderr, captures, diagnostics and hash manifest remain in the operator workstation's **sibling** directory `../validation-2026-10-16/`, outside the Git checkout. Sanitized VPS evidence also remains in `/opt/aoa-validation-2026-10-16/evidence`. These are custody locations, **not clone-accessible repository attachments or guarantees of ongoing access**. The committed portable summary includes selected raw-file hashes so later agents can request/verify the originals without importing an auth/runtime archive. Full logs are not bundled here.

Disposable D1 containers/volumes, the Linux diagnostic runner/source volume, restore containers and unused diagnostic auth copies were cleaned up. No global Docker prune or global tool changes were made. The one detached Windows test DB child was explicitly stopped. The temporary E2B process credential was removed and the cloud app restarted healthy. Reviewable native/cloud test apps and dummy data were retained; native crew remained paused. Runtime OAuth/application secrets and the active local scoped login remain protected outside the repository. Exact-credential scans of retained evidence found no matches for the protected values scanned; this is not a certification of an arbitrary runtime-directory export.

**Next agent:** Start with the linked pickup checklist, reproduce each finding on the current candidate, and publish a new validation attempt after fixes. Do not edit this record to turn historical failures into passes.

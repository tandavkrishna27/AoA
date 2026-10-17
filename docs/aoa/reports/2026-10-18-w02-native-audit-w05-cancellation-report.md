# W02 native tool auditing and W05 artifact cancellation — 18 October 2026

**Branch:** `codex/replatform-w02-w05`. **Application candidate:** `74ab555f42dd02a43e448e6480a6b62b1a3caf00`, following `1e1ec04c0`. Documentation publication is a separate later commit. Dates here use India time; raw receipts retain UTC timestamps.

**Verdict:** the bounded W02 non-Codex successful-tool-name gap and reproduced W05 caller-abort defect are repaired. Exact-candidate targeted Windows/VPS checks pass. **Credential-dependent vendor tests and the ordinary VPS→PC live journey remain skipped by explicit user direction**, including after a model key was supplied. No supplied model/provider key was validated, used, copied to a subagent/VPS, or published. No vendor CLI was installed or invoked. Full W02/W05/release acceptance is not inferred. See the [completed/pending checklist](../plans/2026-10-17-w02-w05-handoff.md), [portable evidence](../evidence/2026-10-18-w02-native-audit-w05-cancellation-summary.json), and preceding [adapter report](2026-10-18-w02-adapter-variants-report.md).

## W02 — confirmed gap and bounded capture

The runner created successful-tool-name capture only for Codex. Controlled Claude/Gemini/OpenCode callbacks therefore left `toolsCalled` absent/empty after success, thrown completion and cancellation winning the terminal update. Twelve added runner cases reproduced that gap before production edits.

The runner now selects a native capture helper after resolving delivered connectors. It preserves the original Codex collector and existing success/failure/cancelled-row persistence guards. Non-Codex capture requires an unambiguous, launch-allowlisted canonical AoA name, a qualified native completion signal, and an exact AoA JSON success envelope. It stores **names only**, never arguments/results/URLs, and makes no new authorization decision. Failed, denied, orphan, duplicate-ID, foreign, ambiguous, malformed, truncated and unknown output is not promoted to success. The full registry and connector namespaces guard sanitized-name collisions, including Gemini's existing `mcp_` prefix case.

| Fixture-qualified native format | Verified source basis | Accepted boundary |
| --- | --- | --- |
| Claude | Official published `@anthropic-ai/claude-code@2.1.81` package, inspected read-only; namespace sanitizes server/tool characters outside letters/digits/underscore/hyphen | Top-level assistant tool-use ID paired once to a user tool-result; `mcp__aoa__` namespace, valid optional error boolean and one exact success text envelope |
| Gemini | Pinned [source `ed96faed…`](https://github.com/google-gemini/gemini-cli/blob/ed96faedfd5571f055c44f2c9509d62321d1138d/packages/core/src/tools/mcp-tool.ts) and v0.34.0 `04b86e81…` | `tool_use`/`tool_result` ID pair; qualified AoA name with dots preserved; explicit native success and exact JSON output. Long/truncated aliases deliberately undercount |
| OpenCode | [v1.2.27 source `4ee426ba…`](https://github.com/anomalyco/opencode/blob/4ee426ba549131c4903a71dfb6259200467aca81/packages/opencode/src/cli/cmd/run.ts#L460) | Terminal `tool_use` only, sanitized `aoa_` name, completed output and explicit non-truncation metadata; exact success envelope |

The evidence records full pinned source links, hashes and Claude archive integrity. Source/archive inspection did not install or run a CLI. OpenCode discards raw MCP `isError` while flattening output: the collector cannot reconstruct contradictory metadata that is no longer present. AoA's failed/denied bridge envelopes do not satisfy its success gate; arbitrary inconsistent raw MCP results and unverified CLI versions are **not** qualified here.

Bounds: 65,536 line characters, 128 pending calls, 1,024 lifetime call IDs, 256 characters per call ID and 128 unique canonical names. Unknown/over-cap formats conservatively undercount. Tests cover splitting/final flush, malformed flags, collisions, replay/orphans, bounds and success followed by normal/throwing/cancelled completion. They exercise the production collector/runner with **synthetic adapter callbacks and fixture DB behavior**, not authenticated vendor inference or independently proven real tool effects.

## W05 — reproduced defect, repair and byte checks

Artifact enumeration/digest/export used mandatory timeout signals but ignored the caller's operation signal. Eight initial cases showed work continuing after caller abort; two later-stat cases showed a late stat could begin reading bytes after the waiting operation had aborted. A native HTTP socket-disconnect regression also failed against the old compiled provider: the server operation aborted while its upload signal stayed active.

The three artifact operations now compose caller abort with the existing mandatory timeout, refuse already-aborted work before provider effects, and check again between stat completion and byte reading. No deadline/wire contract, storage/grant policy or provider interface is widened. The final HTTP regression waits for upload entry, destroys the client socket, observes server→provider/upload abort, records no completed fixture upload, then successfully destroys the sandbox.

Verification also adds two **actual local-disk provider → Express HTTP → production integrity-stream** cases: exact mixed UTF-8/binary bytes with length/hash checks, and an incomplete/aborted download for same-length corrupted on-disk bytes. Actor/company lookup and content metadata are injected fixtures. The separate real-PostgreSQL grant/commit lane uses stubbed object storage. These are useful distinct seams, **not a composed ordinary app→worker→provider→UI journey**.

Limits: already-admitted effects cannot be rolled back by cancellation. Real E2B SDK `connect` does not receive the signal itself; subsequent file operations receive it, and the bounded wrapper releases the waiting operation even if a collaborator ignores abort. Mock E2B transport/scanner/uploader regressions do not certify actual SDK/network cancellation. Historical TST-012/TST-013 production causes remain unproven; this newly reproduced abort defect is not retroactive attribution of those incidents.

## Exact-candidate targeted verification

Node **24.19.0**, pnpm **9.15.4**; Windows x64 and Linux ARM64. No whole suite or workspace-wide build/typecheck. Selected package checks cover adapter-utils, worker-daemon, sandbox-e2b-provider, adapter-manager and server.

| Lane | Local | VPS |
| --- | --- | --- |
| Explicit workspace selection: capture/runner/authority/cancellation, manager/worker export, HTTP download and integrity | **15 files / 294 passed**, exit 0 | **15 files / 294 passed**, exit 0 |
| Provider cancellation/enumeration/bounded-read/export selection | **3 files / 56 passed**, exit 0 | **3 files / 56 passed**, exit 0 |
| Selected real-PG upload/download/commit/fence/hash/size/foreign/immutability cases | **16 passed / 23 filter-skipped**, one file, exit 0 | **16 passed / 23 filter-skipped**, one file, exit 0 |
| Five affected-package builds and typechecks | Passed | Passed; frozen installation also passed |

Thus **19 selected files / 366 passing cases per host**; the 23 unselected DB cases are not counted as passes. Windows PG explicitly uses `AOA_RUN_WIN_INTEGRATION=1`. The evidence contains manifests, the exact DB name filter and safe command arrays. Printed native totals are separate from structured capture counters; unknown summary/unhandled-error counts remain unknown.

Before-fix and intermediate failures remain retained, including missing non-Codex names, malformed flags, a real Gemini prefix collision, an initially incorrect collision fixture and an undefined connector-fixture fallback. The download characterization first encountered the machine's non-pinned pnpm no-TTY dependency-management refusal; the installed direct runner passed without a dependency change. The first combined root check passed on frozen uncommitted source; accepted repeats use clean exact `74ab555f4`. Independent Sol/high and Luna/high component/final reviews found no actionable findings. No schema/dependency change.

The VPS now serves this candidate from `/opt/aoa-w02-w05-audit-artifacts-20261018/source` as existing non-root `aoatest`. Public health is `ok`, exact revision, ready `cloud_auth`/bootstrap; static UI returns HTTP 200. The same PostgreSQL Docker identity/data and OAuth configuration are retained, distributed execution stays disabled, and previous source/unit overrides remain available for rollback. No DB reset, Chrome/Google sign-in repeat, paid call or credential transfer. Separate W12 work was coordinated into its own namespace; its resources are untouched. The original local review app on 3210 remains healthy at `6ebc400d2fd4c4cf26b90d2c1d6466171d08f3e9`, unchanged.

Independent post-test scans found no accessible PostgreSQL process command line naming the selected `aoa-dat002` fixture on either host. This is not global process cleanup/custody certification; durable abrupt-crash/host-restart custody remains deferred. Private raw receipts/harnesses remain outside Git in sibling `validation-w02-w05-audit-artifacts-2026-10-18/` and `/opt/aoa-w02-w05-audit-artifacts-20261018/evidence`; the portable summary publishes safe facts and hashes, not raw personal transcripts, auth files or databases.

## Credentials and prerequisites for the skipped live journey

**All three model keys are not required for one end-to-end cohort.** Start with one supported provider/model, a verified CLI-bearing execution template and supported backend/storage/worker composition. Keys alone do not implement the missing W06/W07 device-local personal-subscription path. The existing Docker daemon/worker must not become an arbitrary host-command fallback.

| Credential or setup | Needed for | Current pickup status |
| --- | --- | --- |
| E2B project API key (`E2B_API_KEY`) and explicit verified CLI-bearing `E2B_TEMPLATE` | Chosen E2B execution backend; template must contain the selected pinned CLI | Key supplied earlier, **not revalidated or used here**. Template/profile/backend must still be selected and verified; do not assume bare default `base` contains the CLI |
| Company OpenAI provider secret (`OPENAI_API_KEY`) with quota/entitlement for the selected model | First OpenAI/Codex API-key cohort | Supplied during this work, **not validated, used or stored by this follow-up**. This can be the only model-provider key for the first cohort |
| Company Anthropic provider secret (`ANTHROPIC_API_KEY`) | Additional Claude API-key cohort | Optional until that provider is selected; not required alongside OpenAI for a single cohort |
| Google/Gemini credential (`GEMINI_API_KEY`, or supported `GOOGLE_API_KEY`/local OAuth mode) | Separately supported Gemini CLI qualification | Optional, and **not sufficient for current distributed-worker execution**: secret redemption currently allows OpenAI/Anthropic targets, not Gemini targets. A Google key must not be represented as enabling that missing path |
| S3-compatible bucket/region, reachable HTTPS presigning and TLS trust; service access-key/secret or accepted SDK credential role, optional session token | Artifact PUT/HEAD/GET/export/download on the selected S3/MinIO cohort | Must be provisioned/verified. Configure `AOA_STORAGE_PROVIDER=s3`, bucket/region and applicable endpoint/prefix/path-style settings. AWS may use default endpoints and its credential chain/role; for a custom store such as MinIO, configure the appropriate server-internal `AOA_STORAGE_S3_ENDPOINT` and worker-reachable HTTPS `AOA_STORAGE_S3_PRESIGN_ENDPOINT`, plus service credentials |
| Supported composed worker/backend, authority URL, admitted target/profile/placement, durable outbox and app-issued enrollment code | Real authority→worker execution with active lease/fence, normal export and output readback | Configuration/implementation prerequisites, **not another model API key**. Worker generates its device signing key and receives a short-lived session; do not provide or copy its private key to the VPS |

OpenCode credentials come from the chosen underlying provider, not a generic "OpenCode key". However, the current distributed coding credential/admission scope is Claude/Codex, so an OpenCode key/configuration alone does not enable that worker path either; the native audit repair does not widen admission. Existing Google sign-in client ID/secret are **OAuth application credentials, not a Gemini model API key**; existing SSH/OAuth setup does not need replacement for these fixes. The separate internal hosted-LLM `GOOGLE_AI_API_KEY` setting is not interchangeable with a worker Gemini CLI credential.

Model secrets belong in the Company's protected provider-secret configuration; E2B/storage operator settings belong in protected deployment configuration, not Git, reports, command arguments or screenshots. Use least-privilege test credentials/roles and rotate chat-shared keys before production/longer-lived use. Do not send personal `auth.json` files or worker private keys. A later live campaign still needs explicit authorization, an admitted supported backend/storage cohort and separately measured ordinary UI/source behavior; it is not enabled by this handoff.

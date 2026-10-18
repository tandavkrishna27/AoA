# W02 authority, curation audit and graceful shutdown — 18 October 2026

**Branch:** `codex/replatform-w02-w05`. **Application candidate:** `4282a6b33ee3d2edce55db4a2f2f014eac0388fe`, following `e86f4638d`. Documentation publication is a separate commit. Dates in this report use India time; raw receipts retain UTC timestamps.

**Verdict:** the user-approved bounded follow-up passes its targeted local/VPS checks. Core crew authority refresh, transactional curation attribution and graceful tracked-child cleanup are repaired. **Durable abrupt-crash custody and untested native adapter variants remain open.** W05, rollout and branch integration are unchanged. See the [completed/pending checklist](../plans/2026-10-17-w02-w05-handoff.md) and [portable evidence](../evidence/2026-10-18-w02-followup-summary.json); the [preceding report](2026-10-17-w02-w05-targeted-report.md) remains historical.

## Confirmed issues and repairs

| Confirmed issue | Repair / commit | Preserved boundary |
| --- | --- | --- |
| An explicitly invalid/expired Bearer token could inherit the dev-local implicit board actor | Clear that actor before attempting Bearer authentication; absent-header local behavior is unchanged. `714933f43`. | No anonymous/cloud escape hatch or new authentication mode. |
| Signed crew JWTs admitted paused agents and terminal/missing/mismatched runs; a header could override the signed run used by the broker | Resolve current company + agent + internal run ownership/status per request; pin AoA run identity to the signed claim. `714933f43`. | Organization JWT, static-key and Commander compatibility remain scoped to existing policy. |
| Native stdio retained its launch-time allowlist after revocation; outbound HTTP `memory.retain` bypassed the crew broker allowlist | Refresh native current authority on each list/call; check current crew permissions before outbound/plugin dispatch outside the internal registry. `714933f43`. | `crewPaused` remains scheduling admission, not cancellation of already admitted work; thread autonomy overrides are preserved. |
| Local agent JWT verification accepted `exp == now` | Reject that exact expiry boundary. `714933f43`. | Commander verifier is unchanged, not qualified by this increment. |
| Curation changed entity metadata without a durable mutation audit | Revision-guarded update and sanitized `activity_log` insertion now share one transaction; publish events after commit. `4282a6b33`. | Audit failure rolls back the update; stale revision produces no second event. No summaries/reasons/model arguments are copied into audit details. |
| Shutdown exited without draining tracked local children; POSIX scratch children survived the old graceful exit | Close spawn admission synchronously and start the existing registry drain immediately, observing rejection before waiting for plugins; await actual child close before DB teardown and return nonzero on drain failure. `3606bfef0`. | No PID persistence, blind PID kill, new registry, schema or dependency. Abrupt termination cannot run this hook. |

The curation audit distinguishes agent, authenticated user/Commander and deterministic system sweep. Crew run IDs are validated against company/agent and stored as `details.internalAgentRunId`; `activity_log.run_id` stays null because its FK references heartbeat runs. Organization heartbeat IDs and Commander conversation IDs are not mislabeled as crew runs. Existing curation unit fixtures were adapted to the transaction boundary; the real-PG fixture uses the existing migrated-database helper and explicit Windows opt-in after its legacy WIN1252 setup failed on UTF-8 migration text.

## Targeted verification — not the whole suite

Node **24.19.0**, pnpm **9.15.4**; Windows x64 local, Linux ARM64 VPS. The evidence JSON contains the explicit **27-file** manifest and raw-file hashes.

| Check | Local | VPS |
| --- | --- | --- |
| Same final-candidate 27-file selection | **247 passed / 2 POSIX-only skips**, exit 0 | **249 passed / 0 skips**, exit 0 |
| Adapter-utils and server builds/typechecks | Passed; source frozen before publication, exact-commit execution repeated afterward | Frozen install followed by both affected-package builds and typechecks passed at final candidate |
| Real signed JWT / production HTTP boundary fixture | **14 checks passed** | **14 checks passed against the public rebuilt app** |
| Actual native stdio subprocess using a real fixture DB | **3 checks passed** | Not run as a cloud tenant execution path |
| Actual model-driven Steward curation | Passed, separate normal app-originated run | No provider/model invocation; no personal auth transferred |

The protocol fixture deliberately seeds disposable company/agent/internal-run rows; **those rows are not represented as real model runs**. It uses real signed JWTs, real DB state and the running app's HTTP middleware/router. It verifies active authority, signed-run attribution despite a forged run header, wrong-company/other-agent/missing runs, each terminal status, paused agent, allowlist revocation, outbound memory denial, invalid explicit Bearer refusal and real expired JWT refusal. The three native stdio checks verify discovery, revocation affecting the next call/list, and cancellation denying a subsequent otherwise-permitted read. One permitted fixture curation creates one audit; denied writes leave its revision unchanged; fixture cost events remain zero. Both final protocol fixtures remove their test-owned records.

Red/green evidence covers the original authority failures, outbound bypass and exact expiry, missing audit, rollback/conflict/attribution, and missing drain/blocked-plugin ordering. An early root combined check overlapped the intentional shutdown red→green transition and failed one case; it is retained as superseded, not counted as a final pass. Native capture counters that are unknown remain unknown; printed test totals are recorded separately.

## Actual native application result

Fresh normal CLI onboarding/doctor in an owned short home (`.aqw26`, ports 3214/54332) reached healthy final-candidate server/static UI with persistent signing configuration. Only Steward's sweep was enabled for the disposable company, then disabled; no Commander interaction or task dispatch was needed. Saved model selections stayed null; pinned Codex **0.145.0** actually reported **openai / gpt-5.6-sol** using the owner's local subscription, with provider API keys unset.

- Company `2a923be3-151f-41e0-b72e-e30ce4ee64c8`; Steward `c0f7e0f8-b274-487e-a2ac-4f0880ce52ee`; run `d14aaca4-4b33-4266-baab-5ccc78cf2d15` completed with both successful curation tool names persisted.
- Hub item `e5c22716-d006-415a-8304-e6cf9a8f586e`: deterministic revision **0→1** has one system audit; native Steward revision **1→2** has one agent audit with the exact internal run ID. No summary text appears in either audit's details. Lifecycle stays open and approval `17468fc5-a19e-4f22-b99f-1d837b1b3513` remains pending.
- Exactly one zero-cent subscription cost event uses `crew_run:d14aaca4-4b33-4266-baab-5ccc78cf2d15`. Actual usage: 60,248 input / 55,296 cached input / 379 output tokens; displayed run cost remains null, not an invented charge.
- Owned app/database PIDs and ports are absent after explicit Windows teardown; the temporary auth copy was removed. This forced teardown is **not** claimed as a graceful Windows signal test. The original review app on 3210 remains healthy at its prior revision, unchanged.

This closes the previously missing **bounded curation mutation audit evidence**, not all possible global product auditing. The prior unaudited/cancelled rows were not backfilled or rewritten.

## VPS rebuild, custody findings and remaining work

The isolated source at `/opt/aoa-w02-followup-20261018/source` is built and served by the existing non-root `aoatest` service. Public health reports exact `4282a6b33`, ready `cloud_auth`/bootstrap and UI HTTP 200. The PostgreSQL container identity and OAuth configuration/history are retained; distributed execution stays disabled. Chrome retained the existing authenticated QA company and passed opening/reloading Home. No data reset or local-auth transfer was needed. The prior source/unit remains available for rollback; no merge or PR/release approval is claimed.

Owned **pre-fix** Linux child probes on application `919967f3c` establish both old graceful-exit and abrupt-crash survivors by PID + process-group + `/proc` start identity and continuing heartbeats. Fresh process-local recovery incorrectly reported no tracked child. Both scratch groups were identity-checked and cleaned. Windows did not reproduce survivor persistence in that environment. Final Linux targeted tests verify actual close before DB/exit, refusal of new spawns and SIGTERM→SIGKILL escalation for an uncooperative child.

Remaining items:

- **Deferred by explicit user choice:** durable abrupt-crash/host-restart custody. A correct design needs host-bound start identity, PID-reuse protection and custody before a child can escape, or an execution-unit supervisor. A fire-and-forget persisted PID is unsafe and leaves a spawn/persistence crash window.
- Calls admitted before revocation/termination may already have effects; these repairs deny subsequent calls, not transactional rollback of accepted work. Graceful drain covers currently tracked children, not intentionally escaped descendants. Existing unrelated subsystem shutdown waits are not a new globally bounded shutdown guarantee, although local termination starts before those waits.
- Claude/Gemini/OpenCode and Codex app-server/provider-specific live variants were not exercised here. No broadened org/static-key/Commander revocation policy or complete all-adapter W02 acceptance is inferred.
- W05's supported-cohort VPS→PC real output/export/UI-download acceptance, W06/W07 prerequisites and baseline/follow-up integration remain as recorded in the checklist.

Raw evidence is in sibling `validation-w02-followup-2026-10-18/` and `/opt/aoa-w02-followup-20261018/evidence`, not clone-accessible attachments. Raw transcripts/config/auth/database contents are not published. Harness-only diagnostics include an inherited inaccessible Linux cwd, legacy fixture encoding, synthetic cleanup ordering/owned-audit FK constraints, and the privileged environment file being unreadable to the non-root probe launcher. Corrections stayed in the owned test harness; protected file permissions and product audit constraints were not weakened. The final VPS launcher reads protected configuration as root, runs the fixture under `aoatest`, and does not publish credential values. Initial failed/incomplete harness attempts are not accepted results.

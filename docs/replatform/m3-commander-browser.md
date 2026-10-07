# BRW-008 Commander browser foundation

## Approved implementation

1. Preserve the authenticated signed turn separately from the conversation and caller run headers.
2. Admit a human-owned running distributed Commander parent with current membership, ownership, fence, company budget, browser capability and immutable network authority.
3. Stage an anonymous or scoped-session browser child using strict preparation schema 2; agent schema 1 remains unchanged. No synthetic agent or task.
4. Expose only browser request through the reserved governed HTTP surface. Keep the host path until the governed journey is proven. Rollout and capability advertisement remain gated.

## Decisions and remaining requirements

Commander browser children use the existing user-owned internal run admission and frozen browser_request source. Signed JWT turn identity is required; conversation identity is not turn authority. Company hard-stop budgeting applies without an agent scope. The human session continuation uses Decision #112's active company connector authority without creating an agent grant.

Production verified provider filtered egress remains a prerequisite. No paid provider calls, model calls, host-path retirement, deployment or rollout enablement is part of this foundation.

The trusted composition selector `AOA_COMMANDER_GOVERNED_BROWSER=true` adds a reserved `playwright` HTTP entry pointing only to `/api/companies/:companyId/browser-mcp` for distributed Commander invocations with `browser_use`. It defaults off. The endpoint requires a signed current turn and current organization tool authority even while the deployment switch is off; it exposes only `request_browser_session`, never the full AoA registry, plugins or resources. Request preparation additionally requires the existing rollout and verified worker/target capability ceilings. Configuration contains the bearer environment variable name, not credential bytes. Existing host spawning remains the default until the governed journey is proven.

Human requester identity follows actual submission storage: authenticated principal `user` with the same ID as the role-normalized requester (`founder`, `team_lead`, `team_member`; legacy `user` remains readable). The authority reader rejects agent principals and unrelated role strings and still checks conversation ownership, message/run linkage and active company membership. Submission independently checks active organization and company membership.

Authenticated Commander sessions use active organization and company human membership, the current signed user/turn/conversation tuple and an exact parent policy/binding snapshot. The connector must be an active supported catalog OAuth HTTP connector; the binding origin and current resource URL must match the server-owned OAuth policy, including port. Native `allow_once` must be answered by that Commander owner. The broker rechecks human authority during refresh, before cookie exchange, after exchange/storage, on replay and before atomic one-use redemption. Agent opt-in remains unchanged. Only scoped cookies reach the guest through encrypted, short-lived one-use transport; no caller-authored binding, OAuth refresh/access token or credentials reach Commander or ordinary evidence downloads.

## Focused verification ledger

### Human session continuation

Decision #112 grants Commander all active company connectors without agent opt-in. Use current organization/company human membership and the signed parent tuple rather than adding a grant row. Schema 2 may carry a trusted immutable parent session binding. Issuance requires owner-matched native `allow_once`; issuance, refresh, replay and redemption recheck current human/connector authority and parent fence. Preserve encrypted short-lived one-use transport, cancellation cleanup and ordinary evidence/download exclusion. No schema or frozen operation changes.

Focused verification: 98 tests passed across 8 files, including 29 serving PostgreSQL producer tests (Windows opt-in). Covers preparation discrimination, signed identity propagation, null-agent child admission, actual submitted parent role normalization, spoofed identity, lost membership/fence/target authority, inherited policy ceilings, disabled capability, narrow secret-free configuration/request surface, and existing agent behavior. Server typecheck and `git diff --check` passed. Preparation, signed-context, reserved configuration, and capability override regressions were observed failing before their fixes.

Full recursive types, build and full suites are owned and serialized by the integration thread; this isolated slice ran focused checks only. No provider/model execution was performed. BRW-008 remains open for governed journey proof and the approved host-path transition. The current supported connector policy is Notion's hosted MCP origin; no live application cookie issuer capability is claimed by the keyless session exchange fixtures.

Authority follow-up: repaired synthetic Commander fixtures to the actual authenticated user tuple and role-normalized requester. Serial real PostgreSQL checks passed: placement 40, secret broker 25, currency 26. Currency was observed RED with the old `requester=user` condition; it now shares `commanderJobHasHumanOwner` with the authority reader and producer. Additional currency cases reject wrong authenticated kind/ID and invalid requester role. Producer plus MCP currentness/classifier regressions passed 58 tests; reserved surface initialization passed 24 route tests and advertises only tools. Server typecheck passed after shared authority composition.

Human session checks: 65 tests passed across the broker/OAuth/exchange/binding/readiness/preparation group, including 28 real PostgreSQL broker cases. Producer/OAuth/preparation checks passed 44 tests, including 30 real PostgreSQL producer cases. Human broker replay and revocation were rerun in the full 28-case broker file. Includes other operator answer refusal, organization/company revocation, disabled/deleted/cross-tenant connectors, hostile current resource URL, parent fence/turn/conversation/policy/binding/capability changes, revocation during OAuth resolution, encrypted storage, one-use redemption, ordinary agent behavior and cleanup. Mixed principal and missing trusted human fence callback regressions were observed RED before their fixes. Server types and diff checks passed. All session exchange and OAuth token resolution controls were keyless test seams; no external provider calls occurred.

Integration verification: recursive workspace typecheck and full workspace build passed. Seven integrated focused files passed 163 tests, including real PostgreSQL producer, credential, currency, placement and secret-broker cases. Fresh foundation and human-session reviews found no actionable issue. Full normal local suite passed with four workers: 24,279 tests, 2,031 skips; 2,515 passed files, 226 skipped files. Five moved source references were corrected; citation integrity and all 56 checker tests pass. PR #681 merged after all 16 normal CI checks passed; this is not M3 closure.

### Distributed stranded-answer cleanup

The existing bounded native stranded-answer sweep also cancels answered and
relay-failed browser decisions after their receipt-bound attempt becomes terminal
or loses its exact active, unexpired lease fence. Applied native receipts bind the
organization, company, browser job and own attempt. A live binding preserves the
answer despite a null heartbeat run. Unbound or wrong-kind receipts do not
authorize cleanup. The conditional native UPDATE rechecks eligibility alongside
revision/status guards, retaining owner and answer and using existing cancellation
audit and hub reconciliation. Suspended and archived tenants remain eligible for
terminal cleanup. It issues no credentials and replays no execution.

The existing 30-second sweep and batch ceilings are reused. No schema or frozen
operation changes. Initial orphan cases and a scan-to-update renewal race were
observed RED, then fixed. Focused checks passed 87 tests, including 20 real
PostgreSQL cases; individual server types passed. Fresh review found no actionable
issue. Full integration checks remain pending.

### Keyless governed journey

The serving PostgreSQL producer fixture now authenticates a real signed Commander turn through the reserved browser MCP route, ignores a spoofed run header, exposes only the browser request tool, creates and places a human-owned child, and obtains an actual worker lease/ACK. Accepted guest intents project native owner approvals and durable receipts. The native bridge answers `allow_once`; authenticated renewal carries the matched control and scoped encrypted credential grant. Atomic redemption delivers only the cookie mailbox reply to the staged guest.

The opt-in guest variant executes the exact control-plane-staged CJS runner/config/package bytes in real Chromium. A local HTTPS issuer and authenticated page prove scoped cookie injection before navigation. The fixture asserts the public DNS answer and exact public IP, port, Host and SNI before translating the dial to its local TLS server. Filesystem mount translation and fixture certificate trust are test-only; Windows also supplies a synthetic `/proc` table, which establishes no Windows containment claim. OAuth is a keyless external seam retaining actual human/connector/parent currentness checks. The fixture store computes its checksum from actual stored bytes; production `local_disk` still cannot mint distributed transfer grants or supply commit checksum proof.

Requested video bytes are committed by the real fenced artifact service and reappear with status/expiry in operator reconnect detail. Captured Chromium/ffmpeg descendants must be gone before control-plane evidence upload. Cookie objects remain encrypted in storage, are redeemed once and deleted, and never enter ordinary evidence detail. Parent cancellation queues the child's durable cancel and refuses further credential issuance; this fixture does not establish live provider sandbox destruction.

The journey exposed two guest lifecycle defects. Settled approval deadlines retained a timer after `session_completed`; the production helper now clears its own timer on allow, refusal and rejection while retaining the full pending deadline. Closing a persistent context also closed the video artifact channel; the driver now flushes the page and obtains only the trusted Playwright-generated guest path before closing the context, then copies the finished video after teardown. Driver teardown failures propagate and context close is always attempted. No caller-supplied video source is accepted.

The existing Linux browser CI lane runs both normal control-plane and opt-in guest variants and explicitly verifies that both executed. Local reproduction: set `AOA_RUN_WIN_INTEGRATION=1` on Windows and `AOA_RUN_BROWSER_TESTS=1`, build `@armyofagents/browser-runtime`, then run `pnpm exec vitest run server/src/__tests__/agent-browser-request.integration.test.ts`. This proves local governed wiring. Production application-cookie issuer compatibility, verified provider egress and live provider destruction remain prerequisites; capability advertisement, rollout and the host browser path are unchanged.

Journey verification: 62 focused tests passed, including both real PostgreSQL journey variants and the staged Chromium guest. A continuous retained descendant census captures late renderers and nested helpers; Windows creation timestamps reject stale-parent PID reuse, and final process identities use creation time on Windows or /proc start ticks on Linux. The lifecycle/census group passed 56 tests. Individual server and guest type checks passed; recursive checks are performed by the integration owner.

Integrated journey verification: recursive workspace types and full build passed.
Five focused files passed 99 tests with zero skips, including actual PostgreSQL
and the production-equivalent staged Chromium guest. The review's late-descendant
census finding and stale-parent PID reuse regression were observed RED before
their fixes. Citation integrity passes. Full normal suite and normal Linux PR CI
are pending before program integration; no production conformance is claimed.

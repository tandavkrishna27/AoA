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

Integration verification: recursive workspace typecheck and full workspace build passed. Seven integrated focused files passed 163 tests, including real PostgreSQL producer, credential, currency, placement and secret-broker cases. Fresh foundation and human-session reviews found no actionable issue. Full normal local suite passed with four workers: 24,279 tests, 2,031 skips; 2,515 passed files, 226 skipped files. Five moved source references were corrected; citation integrity and all 56 checker tests pass. Normal PR CI is pending; this is not M3 closure.

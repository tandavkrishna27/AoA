# BRW-008 Commander browser foundation

## Approved implementation

1. Preserve the authenticated signed turn separately from the conversation and caller run headers.
2. Admit a human-owned running distributed Commander parent with current membership, ownership, fence, company budget, browser capability and immutable network authority.
3. Stage an anonymous browser child using strict preparation schema 2; agent schema 1 remains unchanged. No synthetic agent or task.
4. Expose only browser request through the reserved governed HTTP surface. Keep the host path until the governed journey is proven. Rollout and capability advertisement remain gated.

## Decisions and remaining requirements

Commander browser children use the existing user-owned internal run admission and frozen browser_request source. Signed JWT turn identity is required; conversation identity is not turn authority. Company hard-stop budgeting applies without an agent scope. Scoped session bindings are refused: the current connector broker authorizes agent grants, and a human connector grant must be added explicitly before authenticated Commander browsing is available.

Production verified provider filtered egress remains a prerequisite. No paid provider calls, model calls, host-path retirement, deployment or rollout enablement is part of this foundation.

The trusted composition selector `AOA_COMMANDER_GOVERNED_BROWSER=true` adds a reserved `playwright` HTTP entry pointing only to `/api/companies/:companyId/browser-mcp` for distributed Commander invocations with `browser_use`. It defaults off. The endpoint requires a signed current turn and current organization tool authority even while the deployment switch is off; it exposes only `request_browser_session`, never the full AoA registry, plugins or resources. Request preparation additionally requires the existing rollout and verified worker/target capability ceilings. Configuration contains the bearer environment variable name, not credential bytes. Existing host spawning remains the default until the governed journey is proven.

Human requester identity follows actual submission storage: authenticated principal `user` with the same ID as the role-normalized requester (`founder`, `team_lead`, `team_member`; legacy `user` remains readable). The authority reader rejects agent principals and unrelated role strings and still checks conversation ownership, message/run linkage and active company membership. Submission independently checks active organization and company membership.

Authenticated Commander sessions need an explicit human connector grant resolver and issuer branch. The existing `browser-session-credentials` broker checks `company_mcp_connector_agents` and agent-scoped credential tuples. A future human branch must resolve the current company member's connector authority, recheck grant/revocation plus live Commander parent and browser-child fences, bind the accepted `allow_once` permission to that human/run/request, and issue the existing encrypted, short-lived one-use cookie object. It must deliver only scoped cookies to the guest. No caller-supplied binding, OAuth refresh token or credentials may reach Commander. This foundation rejects every Commander `sessionBindingId` until that authority exists.

## Focused verification ledger

Focused verification: 98 tests passed across 8 files, including 29 serving PostgreSQL producer tests (Windows opt-in). Covers preparation discrimination, signed identity propagation, null-agent child admission, actual submitted parent role normalization, spoofed identity, lost membership/fence/target authority, inherited policy ceilings, disabled capability, narrow secret-free configuration/request surface, and existing agent behavior. Server typecheck and `git diff --check` passed. Preparation, signed-context, reserved configuration, and capability override regressions were observed failing before their fixes.

Full recursive types, build and full suites are owned and serialized by the integration thread; this isolated slice ran focused checks only. No provider/model execution was performed. BRW-008 remains open for explicit human connector authority, governed journey proof and the approved host-path transition.

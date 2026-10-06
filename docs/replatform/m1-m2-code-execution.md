# M1 and M2 code execution

Updated 2026-10-06. Execute inline under the user's authorization to finish crew,
remaining M1 code and tests, and M2. This checklist adds no certification gate.

## Constraints

- Skip Anthropic credentials and live provider calls. Do not substitute a paid provider.
- Keep deployment and per-source rollout flags off. Do not deploy or merge main.
- Use scoped changes and normal PR checks against `docs/replatform-program`.
- Preserve company boundaries, review approval, budget, activity and lease fencing.

## Order and acceptance

1. **Crew tool access:** stage existing MCP configuration only when deployment and
   organization policy permit it; mint against the actual crew run and frozen job
   binding; apply current organization policy and active lease checks at every use.
   Tests cover authenticated reads, comments, review transition, cross-company
   refusal, access revocation, stale lease, forged header and invalid job binding.
2. **Crew Discussion delivery:** refresh the originating run-result entry when
   committed task outputs arrive late; recover from retries and restart using
   durable records. Serialize concurrent delivery, keep task completion separate,
   and use the existing owner composition without granting the application pool
   broader privileges. Test duplicate prevention, late output, tenant isolation
   and recovery on real PostgreSQL.
3. **M1 reconciliation:** compare current code with required task execution,
   output/download, cleanup, drain, budget and diagnostic behavior. Fix remaining
   code failures and run typecheck, tests and build. Live Anthropic M1b validation
   remains deferred; code readiness does not establish that live result.
4. **M2 target and credential routing:** reconcile Decisions 117 and 121 with
   current placement and broker code. Preserve credential classes and fenced
   execution; reject unsupported routes without an unsandboxed cloud fallback.
5. **M2 Commander:** implement the actual Commander credential and lifecycle
   path, including asynchronous result, approval, cost, audit, drain and rollback.
   Do not wrap personal/host credentials as company provider keys.
6. **M2 extraction:** implement agentless one-shot authorization and its
   asynchronous result path. Preserve source identity; no sentinel task or agent.
   Test success, denial, cancellation, retry, stale result and legacy suppression.
7. Run required checks for each bounded change and normal CI before integrating.
   Report remaining live validation or activation separately from passing code.

## Observed progress

- Task output delivery and recovery merged in PR #652.
- Crew tool access merged in PR #653 after focused PostgreSQL/JWT/HTTP tests,
  repository typecheck/build and required CI passed.
- Crew Discussion recovery merged in PR #654. Exact candidate typecheck/build,
  full local suite (23,567 passed), focused PostgreSQL/recovery group (121 passed)
  and all required CI passed. Late products refresh the same entry after restart.
- M1 drain, cancellation, budget hard-stop and authoritative cost parity checks
  passed 95 focused tests, including real PostgreSQL. Worker cleanup and diagnostic
  tests remain covered by the full required suite; live M1b is still deferred.
- M2 independent owner routing and trusted Commander metadata resolution are
  implemented on the credential-routing branch; validation and integration continue.
- Commander signed-turn fencing and organization tool policy are implemented
  locally with focused tests. Execution ownership, source-specific secret minting,
  Commander results and agentless extraction remain to implement.
- Live Anthropic M1b validation remains deferred. Rollout stays off.

Historical milestone designs contain obsolete starting-state observations; read
current code before carrying any of those observations forward.

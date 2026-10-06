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
- M2 independent owner routing and trusted Commander metadata resolution merged
  in PR #655 after repository checks and required CI passed.
- Commander signed-turn fencing and organization tool policy merged in PR #656.
  Actual execution ownership, source-specific credential redemption and results
  are being implemented next.
- Agentless one-shot authorization, mandatory credential mint, accepted result
  return, deadline cancellation and legacy suppression are implemented. Stable
  Discussion operation identity rejoins owned work after restart; estimates and
  company spend are idempotent and accepted usage takes pricing precedence.
  The final focused group passed 223 tests, including real PostgreSQL; the updated
  readiness mock passed 7 tests. Repository typecheck, full suite (23,639 passed,
  1,903 skipped) and build passed on the integration base. Normal PR CI is next.
- Worker cleanup and diagnostic reconciliation passed another 18 focused tests.
- Commander source-specific handle mint and at-use connection/JWT redemption are
  implemented. Required dispatch handles and the durable run owner marker commit
  together; stale turns roll back placement and handles. Replays reject revoked
  handles and do not duplicate the handoff audit. Focused tests passed 68, including
  real PostgreSQL; repository typecheck, full suite (23,611 passed, 1,900 skipped)
  and build passed. The actual chat consumer and remaining lifecycle work continue.
- Live Anthropic M1b validation remains deferred. Rollout stays off.

Historical milestone designs contain obsolete starting-state observations; read
current code before carrying any of those observations forward.

## Commander consumer checkpoint

PR #657 (extraction) and PR #658 (Commander credentials/atomic handoff) are
merged into the replatform integration branch after required CI passed.
The Commander consumer now returns accepted output before any legacy acquire,
rejoins the original paid turn on retry, uses its pinned model rate, records
estimates once, and persists the assistant reply/run/claim/audit atomically.
Concurrent reply and cancellation recovery passed real PostgreSQL tests. Recovery
runs on the existing convergence timer and neither spends nor dispatches.
Vendor permission bypass respects the current Commander configuration.

The supported new dispatch cohort is ephemeral company API-key Commander turns.
Warm conversations preserve their existing owner. Warm continuity, live streaming,
remaining personal/device execution and the final lifecycle reconciliation remain
open M2 work. This checkpoint does not mark M2 complete. Rollout stays off and
live Anthropic M1b remains deferred.

Commander consumer PR #659 code head `25dad8e16f83a06312b1dc30ecddef42134439a5`
passed repository typecheck, 148 focused tests (including real PostgreSQL),
the full suite (23,703 passed, 1,907 skipped) and build. Required CI runs after
marking the PR ready. All required CI passed before its merge.

## Commander streaming and retirement

PR #659 passed all 16 required CI checks and merged into the replatform branch.
Claude Commander output now streams through accepted, fenced log events before
its final accepted result. Worker redaction, bounded queues and prefix checks
preserve delivery order; disconnects do not restart paid work. Codex retains its
buffered result behavior. Delivery errors cannot overwrite a completed run.
Owner-only recovery retires cancelled/failed attempts after membership revocation,
without granting access to credentials, logs or replies. Semantic invalid results
retire explicitly; transient storage failures remain retryable.

Warm continuity and personal/device execution remain open M2 work. No rollout,
live Anthropic validation, deployment or main merge was performed.

Streaming checkpoint verification: 134 focused tests passed, including 33 real
PostgreSQL placement/result/retirement tests. Repository typecheck passed; the
full suite passed 23,721 tests with 1,907 skipped across 2,459 passing files.
Build and citation integrity checks passed. Flags remain off.

## M2 lifecycle reconciliation

Recovery retirement now has a five-second bound, so a stalled status cleanup
cannot hold the existing convergence timer indefinitely. Added PostgreSQL cases
cover cancelled/revoked, failed/deleted-member and succeeded/revoked runs,
retryable active-member success, and explicitly invalid accepted replies.
The real operator drain is exercised for each task/crew/Commander/extraction
source, preserving one stable cancellation command on replay. Existing governed
Commander confirmation and product approval parity paths remain in force.
Focused checks passed 37 placement/retirement tests, 15 drain tests, 13 product
approval parity tests, and 37 Commander approval/recovery tests. No provider call
or rollout change is part of these checks.

Lifecycle final verification: repository typecheck and build passed. The final
full suite passed 23,724 tests with 1,915 skipped (three workers on Windows).
An earlier run hit the existing workspace-runtime child-log timing assertion;
its isolated rerun passed before the successful full rerun. The new SSE tests
preserve distributed ownership after partial-delivery errors, and recovery
listing and retirement each have bounded waits. PR #660 passed all 16 CI checks
and merged into the replatform branch. Warm VM ownership/resumption is next.

## Warm Commander ownership foundation

Lifecycle PR #661 passed the required CI checks and merged into the replatform
branch. Warm execution remains open; the ephemeral consumer still preserves the
legacy owner for warm conversations.

The optional networked checkpoint/restore relay now uses the signed owned-resource
gate. It remains off unless the driver explicitly enables both operations; an
ungated server refuses them. Malformed receipts and unsupported far providers
fail explicitly. A separate signed warm-resource grant binds one retained VM's
original labels to one fresh primary capability without changing primary v1.
It cannot replace the primary fence, broaden to another VM, outlive that fence,
or overlap the previous capability's expiry. The durable checkpoint/session
issuer and worker retained-resource lifecycle are not wired by this foundation.

The warm claim policy refuses inactive owners, mismatched tenant/user/conversation
or target identity, competing jobs, expired resources, stale device generations,
unaccepted checkpoint evidence and a still-live previous capability. It remains
a tested policy pending its transactional caller.

Verification: 393 focused tests passed with one skipped; repository typecheck,
23,786 full-suite tests (1,915 skipped, 2,462 passing files), build, citation
integrity and test inventory checks passed. No live provider call, activation,
deployment or main merge was performed.

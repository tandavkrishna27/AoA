# M3 code and testing execution

Execute inline under the user's authorization, following the existing E8/E9
designs and Decisions 117/121. Rollout, paid provider calls, deployment and main
merge remain off. Certification and calendar-duration campaigns are separate
from this implementation work.

## Sequence

1. **BRW-003c retention:** preserve current server-authoritative retention
   classification and audit. Enforce expiry with delete-first cleanup, durable
   tombstones, replay prevention and bounded recovery that includes suspended
   tenants. Test actual object deletion, failed deletion, restart, duplicate
   expiry, tenant isolation and immutable artifact identity. Generate any schema
   changes with Drizzle.
2. **Browser runtime:** compose the existing staged guest runner into the actual
   worker lifecycle. Advertise browser capability only alongside working dispatch
   and only when provider/isolation prerequisites are met. Preserve approval,
   network restrictions, secret redaction, artifact handling and fenced events.
3. **BRW-004/005/006 residuals:** reconcile current delivered controls and wire
   missing credential, approval, reconnect and UI paths. Test denial, timeout,
   disconnect, cancellation and lease loss without live providers.
4. **BRW-007/008:** implement authorized agent and Commander browser requests;
   preserve source identity and suppress the host executor only after ownership.
5. **Services:** reconcile SVC-003/005/007 residuals and implement SVC-004/006/009
   gaps. Exercise bounded process supervision, readiness, renewal, recovery,
   cancellation, rolling generations and fenced runtime/TTL authority.
6. Run typecheck, full tests, build and targeted PostgreSQL/provider tests per
   coherent change, then normal CI and integration into the program branch.

Historical observations are starting points, not current-code evidence. In
particular, retention classification is already production-wired through
`artifact-retention-authority.ts`. Browser worker
capability remains filtered out until its supervisor is actually composed.

## BRW-003c implementation checkpoint

Browser cookie and storage state expire five minutes after commit; screenshots,
DOM snapshots, traces, video and downloads expire after one day. The server
chooses these lifetimes. Replay never extends expiry. Other artifact kinds keep
their existing policy.

A bounded cleanup tick runs at startup and every thirty seconds, including
suspended tenants. It deletes object bytes before recording a durable expired
tombstone and clearing the object pointer. Failed deletion leaves a retryable
committed row. Successful expiry also closes matching upload intents and writes
a company-scoped activity entry. Expired identities cannot be recommitted or
reuploaded and do not produce orphan alarms.

Download grants refuse expired browser objects before background deletion and
cap URL lifetime at the recorded deadline. Legacy browser rows without expiry
refuse downloads until cleanup records a deadline anchored to their original
commit time; restarting cleanup cannot renew those credentials.

Focused verification passes: 37 PostgreSQL artifact tests, 13 expiry
policy tests, 20 orphan predicate/sweeper tests and 4 local storage tests. Full
workspace typechecking passes. The standard full suite passes with 23,949 tests
and 1,932 environment skips; the focused PostgreSQL group executes without skips.
The full workspace build passes. Browser execution and service residuals
remain open; this checkpoint does not close M3.

## Browser approval implementation checkpoint

The staged browser guest can wait for a bounded decision through a private
mailbox. Its worker controller scrubs prompt text, binds the request to the full
run identity and matches the returned frozen decision before delivering it.
Concurrent replay delivers a decision once; cancellation closes pending requests.
The sandbox delivery helper uses effect authority and publishes complete decision
metadata atomically. Browser credentials and endpoints do not cross that helper.

Accepted browser permission events now create an immutable runtime decision in
the accepted-event transaction. Reusing an approval ID cannot change its nonce or
scope. The bridge returns the original request revision and the same prompt hash,
fixing a mismatch that previously rejected legitimate human decisions.

Full workspace typechecking and build pass. The full test suite passes across
four sequential shards: 23,972 tests with 1,935 environment skips. Two earlier
unsharded runs hit native Node allocation failures on this machine. Focused
browser, worker and existing runtime-decision regressions also pass.

The guest mailbox, worker controller and delivery helper are not yet composed
into actual browser dispatch. Browser capability remains absent. Network
enforcement, credential materialization, reconnect/UI, agent/Commander sources,
and service residuals remain open. Anthropic live verification stays deferred.

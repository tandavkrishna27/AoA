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
four sequential shards: 23,973 tests with 1,935 environment skips. Two earlier
unsharded runs hit native Node allocation failures on this machine. Focused
browser, worker and existing runtime-decision regressions also pass.

The guest mailbox, worker controller and delivery helper are not yet composed
into actual browser dispatch. Browser capability remains absent. Network
enforcement, credential materialization, reconnect/UI, agent/Commander sources,
and service residuals remain open. Anthropic live verification stays deferred.

## Service renewal implementation checkpoint

Lease renewal consumes the server's owned-labels capability extension and refreshes
the per-run driver without resolving credentials again. Refresh requires the same
ownership tuple and an active fence. A cancellation response refreshes cleanup
authority before closing the fence.

Service handoffs enable owned process launch, status, signal and sandbox lifetime
relays in the networked factory. Each operation uses the adapter-manager ownership
gate, rechecks primary authority at use and has a five-second bound. Process results
contain bounded metadata only; signal acceptance never implies process exit.
Warm Commander resources cannot use service lifetime renewal.
Launch acknowledgement is bounded independently of background process runtime;
the sandbox TTL and fenced service loop own runtime. Pending launch retries share
one launch, and a late acknowledgement is retained for replay under a key scoped
to the sandbox and full ownership identity.

An asynchronous sandbox TTL acknowledgement extends the service's observed expiry
only while its original fence remains live. Requested expiry is capped by the
renewed capability and frozen job deadline. Failure or a pending acknowledgement
keeps the previous teardown window. The provider retains the existing credential
scanner set for the acknowledged lifetime and cannot revive an expired registry.

Focused tests exercise the HTTP path with a newly signed capability, health past
the initial four-minute window, deadline stop, failed and late acknowledgement,
foreign ownership, missing authority, cancellation ordering and metadata projection.
Full workspace typechecking and build pass. The integrated full suite passes
across four sequential shards: 24,026 tests with 1,935 environment skips. The
E2B launch deadline regression and lost-response replay tests pass against the
real transport with an injected SDK, without provider calls. Browser dispatch and the remaining service
recovery, rollout and readiness work remain open.

## Current integration — 2026-10-07

The preceding checkpoints record their own revisions. Current integration now
composes the staged guest, network-policy digest and provider attestation into
the worker supervisor. The guest enforces pinned HTTPS egress, redirects and
credential-origin scope. Operator permissions, reconnect refresh and service
controls use the native APIs. Agent browser requests inherit their active task,
parent job and authority, with parent cancellation and fence checks.

Service recovery now uses witnessed crash history with bounded backoff and an
automatic pause. Portable checkpoints contain approved application JSON files;
they do not claim arbitrary process-memory continuity. Export requires an
observed service exit, and restore validates the immutable generation binding,
committed bytes and staged paths before launch.

Browser approval and credential delivery use owned interrupt operations, so a
guest waiting inside its main execute call does not lock out its own reply.
Pending decisions temporarily request bounded one-second control polling rather
than waiting for the ordinary lease renewal interval. Scoped-session grants
require a matched human allow-once decision and refuse after closure. Cookie
bytes stay in the control-plane broker, provider and isolated guest; the worker
receives grant metadata. Credential redemption observes withdrawal and primary
authority before writer dispatch. An already-dispatched guest write cannot be
atomically undone; guest expiry checks and sandbox cancellation bound that race.

The encrypted server broker and native evidence links are integrated. Optional
credential requests require a configured, encryption-ready broker before
admission. Issuance and one-use redemption recheck human approval, the current
child and parent fences, connector access and immutable origin scope. Storage
writes have a bounded response and retain cleanup tombstones for late writes;
process-death uncertainty retains the metadata pointer for cleanup retries.
Cookie-state and storage-state artifacts cannot use ordinary evidence downloads.

The native permission aggregate advances its revision when answered and relayed;
the broker validates the separate immutable request/result revision. Explicit
distributed request UUIDs identify distinct decisions even when they share one
trusted session binding. Reusing an immutable request with changed content is
refused. Broker regressions use the real native create/answer/relay lifecycle.

The combined workspace build, recursive typechecking and server lint pass.
The full suite passes across four sequential shards: 24,259 tests, with 1,997
skips. Two Windows OpenCode process tests timed out on separate concurrent
attempts of the final shard; its complete rerun passed with explicit one-fork,
nonparallel file execution and the original assertions/timeouts. All 11 real
PostgreSQL broker tests pass, including the native permission lifecycle.
Normal PR CI must pass before merging into the program branch. This is not M3
closure.

Browser exposure remains off until the provider supplies verified default-deny
attestation. The accepted BRW-008 decision retains the Commander host path until
the governed path is proven end to end. No paid calls, deployment, main merge or
calendar certification campaign is part of this execution. Anthropic M1b live
verification remains deferred.

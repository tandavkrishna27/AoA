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
The browser teardown suite now executes the production-equivalent staged guest
bundle and requires real HTTPS fixture navigation before killing the runner.
The full browser package passes locally on Windows: 179 tests, with seven
platform skips. Linux retains real kernel socket measurement and its cancellation
cases passed in normal Linux PR CI: 185 browser tests, with one Windows-only
skip. PR #679 merged into the program branch at ebea76dd65 after all 16 checks
passed. Its first shard had an unrelated workspace navigation test failure;
the unchanged file passed locally and the same CI job passed on rerun.
This is not M3 closure.

Browser exposure remains off until the provider supplies verified default-deny
attestation. The accepted BRW-008 decision retains the Commander host path until
the governed path is proven end to end. No paid calls, deployment, main merge or
calendar certification campaign is part of this execution. Anthropic M1b live
verification remains deferred.

## E8-F006 staged browser guard reconciliation

The existing gate-clause policy guard now enrolls E8-1 as a conditional wired
production path. Its fixed composition check follows control-plane runner bundling
and stage-in, lease path/policy extensions, runtime supervisor/staging composition,
worker target/provider refusal gates, fixed guest execution and capability-ceiling
intersection. It does not infer reachability from an extra host reference to the
guest function. Whitespace/comments are skipped by a dependency-free lexer; strings, templates
and regular expressions remain opaque tokens. Diagnostics cannot substitute for
executable composition.

The existing policy test command includes deletion regressions for every required
link using current production source. Other declared dormant clauses are retained.
This is a structural regression guard, not a general boot import-graph proof or
provider conformance. Browser advertisement and rollout are unchanged; verified
provider enforcement and the governed host-retirement prerequisite remain open.

Focused verification: 59 existing-policy tests passed with zero skips, including
28 production-link deletion regressions. Disabling the composition checker made
all 28 fail while both controls passed; restoring it returned green. The old
`unwired` manifest failed the enrollment regression before correction. The policy
checker reports 29 wired and five unchanged dormant clauses, with both provider
claims matching source. Individual JavaScript syntax checks and diff checks pass.
No full suite, recursive types/build, provider calls or runtime changes were made.

## October 7 program checkpoint

PR #680 merged service recovery, checkpoint, company-budget and bounded history
visibility at 076e9ddd5a after required normal CI passed. The first local full
suite was interrupted by temporary D: drive loss; the complete C: rerun passed
24,262 tests, with 1,998 skips. Recursive types, full build, lint and 39 focused
service tests (including real PostgreSQL) passed.

PR #681 merged signed human-owned Commander browser requests and scoped sessions
at 0c3e37ac00 after all 16 normal CI checks passed. Recursive types, full build,
lint, 163 integrated focused tests and the full normal local suite passed:
24,279 tests, with 2,031 skips. Current human ownership is checked consistently
at admission and use; agent grants remain separate. Browser rollout stays off.

The keyless integrated Commander journey is the next proof. Production provider
default-deny enforcement and application cookie-issuer compatibility are still
unproven. This checkpoint does not close M3.

Read-only provider reconciliation examined released E2B SDK 2.53.1; this repo
remains pinned to 2.30.5. Its host-side SOCKS5 `egressProxy` is a different
mechanism from the September probes, but its official contract excludes UDP
(including DNS and QUIC) and removing it on network replacement restores direct
routing. It cannot establish the required sandbox-wide default-deny boundary by
itself. No upgrade, new attestation or paid probe was performed. A supported
backend configuration that actually blocks every escape class is required before
a changed-mechanism probe is meaningful. Sources:
[released SDK](https://github.com/e2b-dev/E2B/releases/tag/e2b%402.53.1),
[versioned network contract](https://github.com/e2b-dev/E2B/blob/e2b%402.53.1/packages/js-sdk/src/sandbox/sandboxApi.ts).

## October 8 scope and journey checkpoint

The user explicitly selected the current stop-and-export recovery contract for
M3; live checkpoint requests are not added. Hard runtime limits remain the
server-owned job deadlines with bounded renewal, and service health follows the
locked process-observation contract. No configurable service lifetime or HTTP
readiness contract is invented from older residual-plan wording.

PR #682 merged at 8cd4af665e after required normal CI passed. Full local normal
suite passed 24,291 tests, with 2,034 skips. Integrated real PostgreSQL and staged
Chromium checks passed 99 tests without skips. Linux browser CI passed 192 tests
(one Windows-only skip) and all 32 producer/journey cases, explicitly including
both guest variants. Timer cleanup and persistent-context video persistence are
fixed; continuous process identity census runs before evidence upload/cleanup.
This establishes local governed wiring, not production provider enforcement or
application cookie-issuer compatibility. Host retirement remains gated.
### Clean policy job dependency correction

The initial composition checker imported TypeScript, but the policy job runs
before dependency installation. A clean temporary fixture reproduced
`ERR_MODULE_NOT_FOUND`. The checker now uses only native Node modules and a
bounded lexical tokenizer, preserving exact literal tokens while excluding
comments and refusing literal prose as composition. Templates, nested templates
and regex diagnostics (including after a control condition) cannot supply a
missing link. Same-line slash pairs are conservatively opaque; unusual division
expressions may refuse a link rather than fabricate one. This is not AST parsing.

The clean fixture now imports without node_modules and refuses all missing
production files. All 28 deletion regressions and both existing controls remain.
No dependency installation, workflow change or runtime code change was needed.

Focused correction verification: the existing policy command passed 60 tests
with zero skips, including the clean dependency-free fixture, all 28 link
deletions and both controls. Native JavaScript syntax and diff checks pass.
Full suites and recursive workspace checks were not run for this script-only fix.

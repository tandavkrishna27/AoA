# M4 requirement-to-evidence audit

Updated 2026-10-08. M4 is **in progress**. The authoritative scope is
`epic-regrooming/scope-triage.md` §M4: WRK-016, REL-003/DBR-001 recovery, and full D5.
Thresholds below come from `test-gates.md` §D5. This audit records existing
requirements; it adds no certification process or scheduled campaign.

## Local desktop execution

Application candidate `480b30000` now has built local control-plane, worker and
deterministic provider images. The isolated guarded-worker spine passed 10/10
live checks with no skips, including worker execution, usage/cost/audit projection,
tenant isolation and drain. Two guarded slots enrolled with distinct identities,
preserved identity across restart and refused duplicate ownership. The second
slot keeps dispatch disabled; task execution was proved on the first slot.
The native UI on port 3210 uses a separate onboarding database and is not connected
to this distributed test stack. See `m4-code-execution.md` for commands and evidence.

This adds local lifecycle and execution evidence. Full D5 load/fairness, independent
failure domains, production recovery objectives and recovered fleet rollout remain
open. The deterministic provider does not establish production E2B execution or a
desktop-local coding backend.

## What has landed

PR #685 merged to `docs/replatform-program` at
`e1d9950e017a2210206fc3401db4285b409b8a20`, with required PR CI green. It supplies
independent durable Docker worker slots, exclusive Linux ownership, enrollment
persistence barriers, bounded fleet rendering and operator instructions. Dispatch
remains disabled. Validated legacy adoption is still unavailable because current
receipt/ticket contracts lack authenticated organization metadata for it; the
supported replacement is revoke/retire and provision a new target.

PR #686 landed the COPY restore/driver correction at
`f77437a43a72be7d368718b4253f432b85197acb`. PR #687 landed backup security and
recovered-byte verification at `22fd322d9c6ae7e91058303f834c45b544dd6370`.
Both merged into `docs/replatform-program` with required CI green. The CLI fixture
executes SQL/gzip restore, negative-input rollback and ACL fallback refusal. The
native fixture executes full migrated-schema restore with four stale-authority
scenarios and a current-authority positive control. These disposable engineering
fixtures do not establish production recovery objectives.

PR #688 landed durable company-scoped artifact quarantine at
`493e016285c692b334893f8513be42487879d93e`; PR #689 landed combined native
database/file snapshot recovery at `b0576a77213089e4a073562bdbc72d012bf568ca`.
Both have required CI green. At `d40998068`, recursive typecheck, 24,334
local tests and production build pass. Separately enabled real-PostgreSQL
migration readiness passes 4/4 after a reproduced replay failure was corrected
with C14 guards. Native CI explicitly reports two executed database/file recovery
cases passed, alongside the four fence scenarios. This is an isolated PostgreSQL
and local-file fixture, not external-store or running-fleet recovery.

## Requirement audit

“Partial” means the inspected evidence supports only the stated portion. A source
file, declared CI lane or passing component test is not a measured D5 result.

| Requirement | Inspected evidence and its scope | Still needed |
|---|---|---|
| WRK-016 | `worker-slots-runbook.md`; `slot-ownership.ts`, `slot-binding.ts`, `slot-host.ts`; built-image Linux fixtures `m4-slot-{ownership,host}.test.mjs`; PR #685 | Legacy adoption contract remains a design gap; live fleet retirement/replacement and restored identity journeys remain unexecuted. |
| D5-00 topology | Dormant `docker-compose.staging.yml` declares two control-plane services and four distinct workers over two domains; `e6f-12-staging-render.test.mjs` checks rendering | Running production load balancer/TLS, external stores, managed secrets, telemetry and image policy on the candidate are unverified. |
| D5-HA01 zero lost accepted writes / double execution | `e6f-11-two-replica.test.mjs` asserts lease/capacity/terminal races and replica-loss convergence over real control-plane routes; its header explicitly says the harness plays the worker | Candidate with running worker daemons, provider execution and production load balancer under replica loss. |
| D5-HA02 failover ≤60 s, accepted-write RPO 0 | Shared PostgreSQL authority and replica-loss correctness tests are prerequisites | Timed application failover through the actual load balancer and accepted-mutation reconciliation. |
| D5-HA03 rolling deploy, drain, broker catch-up, migration-first, protocol compatibility | Worker poll/outbox drain components, `dr-staging-rollout-invariants.test.ts`, frozen protocol baseline and migration startup suites | One candidate rolling deployment linking those behaviors with a running fleet. Non-identical N/N-1 is required when a release changes protocol, not invented for unchanged frozen v1. |
| D5-HA04 catch-up ≤5 min | `e6f-13-realtime-fanout.test.mjs` verifies real PostgreSQL append, LISTEN/NOTIFY, cross-replica reads and safety-poll recovery after a dropped wake; its header excludes the literal cross-replica socket leg | Timed authenticated socket catch-up after broker recovery on the actual topology. |
| D5-L01 20 orgs / 2,000 queued / 100 leases / 10,000 events per minute, 60 min +15 min churn | Existing race/component tests exercise correctness at bounded fixture scale | Full stated load and churn evidence. No current fixture count substitutes for this requirement. |
| D5-L02 noisy org ≥10× quiet rate | Capacity/admission tests enforce per-org caps | Measured noisy/quiet workload at the stated ratio. |
| D5-L03 quiet throughput ≥90%, p95 delay ≤2× baseline | Per-org concurrency isolation is a prerequisite | Isolated quiet baseline and comparable noisy run; throughput and queue-delay measurements. |
| D5-L04 API 5xx ≤0.1% | HTTP correctness tests assert individual responses | Complete load-run response denominator and error counts. |
| D5-L05 submit/poll/event ACK p95 ≤750/1,000/500 ms | Route/component correctness does not establish percentiles | Measured latency distributions under the stated load. |
| D5-L06 quota/spend cap, no double release | `job-quotas.integration.test.ts` drives real RLS-scoped capacity claims, shared legacy/distributed counting, racing releases, budget hard-stop and fail-closed storage; focused M4 baseline executed these cases | Same behavior throughout the candidate topology/load journey. |
| D5-DR01 same-candidate DB restore + object reconciliation | Landed CLI recovery and native full-schema/fence fixtures. PR #689 native CI passes both DB/file snapshot cases, requiring deleted manifests and files to be restored before bounded-role reconciliation. Earlier catalog probe matched 203 tables, 286 migration entries, 37 policies, 26 FORCE-RLS tables, seven functions and 187 grants | Execute the same release candidate against external stores and the recovered fleet. |
| D5-DR02 DB RPO ≤15 min, full-service RTO ≤4 h | CLI fixture proves limited round-trip behavior | Declared fault, recoverable commit age and restored full-service timing on live substrate. |
| D5-DR03 object RPO ≤15 min, reconciliation RTO ≤4 h | Wired verifier streams real stored bytes against the company-scoped DB manifest; local-file integration passes. No production timing is inferred | Actual recoverable external object versions and measured complete reconciliation against the recovered authoritative set. |
| D5-DR04 hash/size/scope/prefix/identity, missing+corrupt injection, zero unresolved on success | Actual-byte SHA-256/size verification, unsafe-prefix refusal and durable denial pass locally. Combined native DB/file restore with missing/corrupt injections passes CI; healthy governed replay rules out stale-authority masking | External-store recovered manifest/checkpoint identity and serving checks with signed capabilities isolated. |
| D5-DR05 quarantine, never promote bad objects | Durable recovery quarantine preserves committed identity; native DB/file restore regressions pass download/upload/commit replay denial, sticky repair refusal and one company audit. Offline operator entry point enforces bounded role and explicit scope. Local full verification and required CI are green | Live recovered-candidate journey, including existing signed URL isolation and every required object/consumer. Engineering integration is not live D5 proof. |
| D5-DR06 reject every pre-restore stale fence | Native CI at `068a74d23` actually restores full-schema backups and reaches the real tenant guard for post-snapshot leases, expired snapshot leases, captured generation cutoff and post-backup revocation followed by pre-serving generation advance. Fresh authority succeeds | Recovered running fleet and governed HTTP-route replay on the staging candidate; all target authority must advance before worker ingress resumes. |
| D5-DR07 reenrollment/revocation and compatible rollout after restore | `dr-reenroll-revoke.integration.test.ts`, frozen baseline and staging rollout unit tests | Execute these on the recovered candidate and running workers, observing production revocation convergence. |

## Next code and test work

Local load update (2026-10-08): the bounded attempt-terminal diagnostic at
`f7077a695` reproduced a fairness/latency failure with one quiet organization
at 2 scheduled arrivals/s and one noisy organization at 20/s. With a separate
generator, quiet throughput was 0.111 of baseline and p95 queue-to-ACK delay
was 5.115x; poll/event ACK p95 were 2,412/1,923 ms. Zero observed HTTP 5xx
does not offset these failures. This is an open finding for investigation,
not D5-L01–L05 completion; see `m4-code-execution.md` for scope and evidence.

2026-10-09 correction: profiling confirmed repeated migration-file reads and
short-lived pool creation in the per-request readiness gate. The source fix
keeps the image identity immutable and checks the live canonical ledger through
the existing pool on every request. Unit and real PostgreSQL regressions verify
continued corruption/newer-ledger refusal and recovery. With the compiled fix,
the ten-loop adversarial case reached 90% quiet throughput and 316/274 ms
poll/event p95 but still failed at 3.382x queue delay. A separate one-loop
comparison passed at 100% throughput and 0.863x delay. This partial improvement
does not close D5-L03 or substitute for actual daemon/fleet load evidence.

1. Investigate local authority-lock and serving-pool contention using the new
   opt-in load diagnostic; reproduce realistic worker concurrency, fix only
   the confirmed cause, and retain the arrival ratio and thresholds on retest.
2. Obtain the operator's staging environment/access method or run results. Execute
   the existing REL-003 runbook against external stores, using compatible native
   clients, explicit destinations, isolated worker traffic and current authority.
3. Measure D5 topology, failover, broker catch-up, load/fairness and recovery at the
   stated scope. Local fixtures cannot supply those timings or workload floors.
4. Keep M3's unresolved provider/application-session dependency visible. Do not
   promote M4 until all explicit D5 requirements and its dependency are proven.

M1b/Anthropic live verification remains deferred by user direction. Full D2's
ownership was assigned to M4 by TK on 2026-10-16 (W00 in scope-triage); this adds no campaign execution or provider-spend approval. Desktop-local coding remains a separate execution
backend; a networked desktop slot currently delegates through the remote provider.


Real-daemon follow-up (2026-10-09): rebuilt images executed both quiet and noisy
organization jobs. A 15-second 2/s versus 20/s comparison with explicit 32-slot
workers preserved quiet throughput (1.042 of baseline) and ACK-receipt delay
(1.061x), but failed overall with 180/300 noisy jobs unresolved at the 30-second
drain deadline. Both ratified provider profiles still cap concurrent operations
at eight. Receipt transaction timestamps are a proxy; HTTP distributions and
full D5 floors remain unmeasured. See m4-code-execution.md for retained failures,
eventual completion and the next profile-capacity investigation.

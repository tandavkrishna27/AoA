# M4 requirement-to-evidence audit

Updated 2026-10-08. M4 is **in progress**. The authoritative scope is
`epic-regrooming/scope-triage.md` §M4: WRK-016, REL-003/DBR-001 recovery, and full D5.
Thresholds below come from `test-gates.md` §D5. This audit records existing
requirements; it adds no certification process or scheduled campaign.

## What has landed

PR #685 merged to `docs/replatform-program` at
`e1d9950e017a2210206fc3401db4285b409b8a20`, with required PR CI green. It supplies
independent durable Docker worker slots, exclusive Linux ownership, enrollment
persistence barriers, bounded fleet rendering and operator instructions. Dispatch
remains disabled. Validated legacy adoption is still unavailable because current
receipt/ticket contracts lack authenticated organization metadata for it; the
supported replacement is revoke/retire and provision a new target.

The next recovery correction is under verification: automatic backup's COPY
format must restore through the JavaScript fallback, including prompt failure and
rollback when PostgreSQL rejects COPY data. Its disposable CLI fixture covers
SQL/gzip, migration journal, two company payloads and negative inputs. This is a
synthetic database, not the application's complete recovered schema.

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
| D5-DR01 same-candidate DB restore + object reconciliation | New CLI fallback regression and native source/destination probe (203 tables, 286 migration entries, 37 policies, 26 FORCE-RLS tables, seven functions, 187 grants, two company rows match); existing `dr-manifest-reconciliation.test.ts` verifies pure decisions | Reproducible full-schema restore with functional non-owner-role checks, matching object bytes/manifests and release candidate identity in one journey. |
| D5-DR02 DB RPO ≤15 min, full-service RTO ≤4 h | CLI fixture proves limited round-trip behavior | Declared fault, recoverable commit age and restored full-service timing on live substrate. |
| D5-DR03 object RPO ≤15 min, reconciliation RTO ≤4 h | Pure verifier compares manifest metadata and supplied object probes | Actual recoverable object versions and measured complete reconciliation against the recovered authoritative set. |
| D5-DR04 hash/size/scope/prefix/identity, missing+corrupt injection, zero unresolved on success | `manifest-reconciliation.ts` validates scope/path, existence, hash and size; its tests inject bad probes | Real stored bytes and recovered DB manifests, artifact/checkpoint identity checks and serving behavior after injected faults. |
| D5-DR05 quarantine, never promote bad objects | Durable recovery quarantine implemented separately from orphan disposition, preserving committed identity; real PostgreSQL + local-file corruption/deletion regressions prove download/upload/commit replay denial, sticky repair refusal and one company audit. Offline operator entry point enforces bounded role and explicit scope | Latest-change verification and actual recovered-candidate journey, including existing signed URL isolation and every required object/consumer. Local component integration is not live D5 proof. |
| D5-DR06 reject every pre-restore stale fence | `dr-stale-fence-after-restore.integration.test.ts` reaches the real guard with expired/absent lease rows and generation mismatch; it explicitly models restore with mutations | Invoke actual backup/restore, then replay pre-restore stale authority through the real governed route. Preserve an active-fence positive control. |
| D5-DR07 reenrollment/revocation and compatible rollout after restore | `dr-reenroll-revoke.integration.test.ts`, frozen baseline and staging rollout unit tests | Execute these on the recovered candidate and running workers, observing production revocation convergence. |

## Next code and test work

1. Land the reviewed COPY restore and driver-error correction through normal CI.
2. Exercise full application-schema recovery into an isolated destination. Inspect
   migration history, RLS/roles/grants/functions/triggers, data and sequence state;
   data-only success cannot establish schema/security recovery. The JavaScript
   backup writer does not currently serialize the full security-object set.
   Native PostgreSQL tools are available in the combined Dockerfile, while the
   split control-plane image installs only CA certificates and curl. Tool placement
   therefore must be explicit in any operational recovery invocation.
3. Couple real restore with fence replay, current-generation positive control,
   recovered object bytes, missing/corrupt injection and durable quarantine.
4. Close engineering gaps identified by those executions. Preserve the D5 load,
   failover and live recovery requirements as unverified until measured at their
   required scope. Keep the unresolved M3 dependency visible.

M1b/Anthropic live verification remains deferred by user direction. Full D2's
M3/M4 ownership remains unresolved in scope-triage; this audit does not silently
assign it or add a campaign. Desktop-local coding remains a separate execution
backend; a networked desktop slot currently delegates through the remote provider.

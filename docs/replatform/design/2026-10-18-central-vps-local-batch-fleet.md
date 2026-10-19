# Central VPS and local batch workers: proposed P1 delivery plan

Created: 18 October 2026. Updated: 19 October 2026. Reviewed baseline: `docs/replatform-program` at `920ea681d97934762d30f9eb39a6bb5857feb3d3`.

Status: proposed design and delivery sequence, prepared at the user's request. This document does not amend locked decisions, enable deployment, change existing release gates, or certify a supported execution mode. No implementation or live credential experiment was performed for this plan.

The implementation pickup list is [P1 local-worker fleet implementation plan](../../aoa/plans/2026-10-19-p1-local-worker-fleet.md). Its seven local ticket IDs are proposed work items, not filed GitHub issues. Continue the owning W work through these bounded slices; do not reopen completed components or create duplicate W tickets.

Actual application tests use the user-supplied local PC and testing VPS under the [shared-host access, reservation and cleanup protocol](../../aoa/plans/2026-10-19-p1-test-resources.md). Disk/RAM/CPU are constrained; central books host capacity, isolates concurrent chats and requires removal of owned disposable test resources after each batch. The protocol records the SSH command; no host connection was made to prepare these documents.

## Outcome and scope

One authenticated VPS installation coordinates a small fleet of trusted, explicitly enrolled PCs and Linux VPSs. Jobs actually execute on worker hardware. P1 supports company API keys and owner-bound Codex personal subscriptions. Codex is the first CLI; Claude subscription support is deferred.

Recommended initial support envelope: one organization, batch task runs, Linux job containers on Linux VPSs and Windows PCs using Docker Desktop's Linux engine. Operator-managed installation and a small existing Settings extension are sufficient. Native Windows task processes, macOS qualification, Commander/crew/one-shot migration, browser sessions, services, HA, autoscaling and checkpoint continuation are outside this increment. Docker availability and broker confinement on each advertised host are acceptance prerequisites.

Both credential modes remain P1 requirements. Completing the API-key lane alone does not complete P1. Personal jobs keep owner/device identity; P1 recovery does not move a personal credential to another host.

## Reuse ledger: completed W work and remaining acceptance

“Reuse” means the recorded implementation or bounded evidence below exists. It does not mark an entire W package complete or carry an old test verdict to a new candidate. Read the linked latest handoffs before using older unchecked checklist rows as current status.

| W item | Reuse in P1 | Remaining work / disposition |
| --- | --- | --- |
| W01 | Model/default resolution, account/auth separation, managed config and picker regressions. | Qualify the chosen pinned Codex build in the new local path; do not rebuild model selection. Broader native onboarding remains separately qualified. |
| W02 | Native adapter outcome/usage/audit, signed tool authority, accounting, cancellation and graceful child drain repairs. | Reuse these contracts. Durable abrupt-crash custody and other vendor/source journeys are not established by native successes. |
| W03 | Strict Playwright dependency/parity repair. | Retain it; no browser expansion is required by batch P1. |
| W04 | Captured native results, fixture isolation, ACL/readiness and receipt-checked graceful PostgreSQL teardown. | Reuse helpers and targeted functional tests. No baseline repair campaign is a new P1 prerequisite. |
| W05 | Export/deadline/destroy ordering, caller-abort propagation, upload-origin checks and actual-byte HTTP integrity. | Complete actual local-worker generated-file/export/commit/UI download in P1-04/P1-07; do not repeat historical attribution investigations. |
| W06 | Reference-only broker contract and activation-expiry policy. | Working protected Codex credential activation is missing: P1-01/P1-03. Interfaces are not an implementation. |
| W07 | Enrollment, durable identity, desktop host/control and slot composition primitives. | Local execution backend plus both credential-mode integration are missing: P1-02/P1-03/P1-04. |
| W08 | Existing batch source/invocation, staging and E2B coding path; useful Codex/API-key execution is demonstrated by the W12 cohort. | Qualify actual task-run local compute/output only in P1-04/P1-07. Existing E2B evidence is not local execution or full W08 acceptance. |
| W09 / W10 | Existing browser-specific components and tests remain intact. | Browser enforcement and application sessions are outside this batch increment. Required local-worker network/credential isolation is still part of P1-01/P1-02/P1-03. |
| W11 | Shared terminal convergence, prompt quota release on success/cancel, durable event-drain scheduling and capacity/terminal-ACK polling wakeups. | Add functional fleet selection/reservations/waiting in P1-05. Do not resume deferred load/fairness/latency work or label its historical failures passed. |
| W12 | Device/slot identity, drain/revoke/replacement, restored authority denial, exact restored output and bounded operator-directed useful successor rehearsal. | Add automatic safe new-attempt re-placement and local orphan cleanup in P1-02/P1-06. Operator replacement does not prove automatic failover. |
| W13 | Authenticated realtime/outage replay, duplicate handling, backpressure, and relevant Windows workspace-service containment work. | Reuse runtime/status and testing patterns; services and long continuity campaigns are outside P1. Job Objects are not the missing Docker batch provider. |
| W14 | Existing staging manifests/invariants. | HA and expanded staging are outside single-controller P1; no new staging project is required. |
| W15 | Existing backup/restore, stale-fence and sticky artifact-quarantine machinery; W12 demonstrates a bounded restored journey. | Full external-store disaster recovery remains separate. Reuse safety rules; P1-06 addresses worker loss, not database disaster recovery. |
| W16 | Existing authorization, audit, drain/revoke and operator seams. | Reuse those controls; release signing/promotion and full operational qualification stay in their owning work. |
| W17 | Targeted build/type/protocol/functional evidence and repaired fixtures. | Add P1-specific functional acceptance in P1-07. Whole suite stays in GitHub CI; performance campaigns remain deferred. |

Evidence: [W02/W05 handoff](../../aoa/plans/2026-10-17-w02-w05-handoff.md), [W12 current restored journey](../../aoa/plans/2026-10-18-w12-handoff.md), [W11/W13/W17 handoff](../../aoa/plans/2026-10-18-w11-w13-w17-handoff.md), [19 October polling/Windows follow-up](../../aoa/reports/2026-10-19-w11-windows-followup.md), and [current test policy](../../aoa/plans/2026-10-19-implementation-test-policy.md). No historical acceptance record is rewritten by this mapping.

## Remaining implementation, in pickup order

| Order | Ticket | Remaining deliverable | Dependency |
| --- | --- | --- | --- |
| 1 | P1-01 | Codex confinement feasibility, runtime/profile and shared interface decisions. | First; required subscription mode must be feasible. |
| 2A | P1-02 | Docker batch provider and private per-host composition. | P1-01; parallel with P1-03/P1-05. |
| 2B | P1-03 | Protected device activation plus company-key integration. | P1-01; parallel with P1-02/P1-05. |
| 2C | P1-05 | Explicit fleet intent, durable unplaced waiting and atomic organization/target-slot admission. | P1-01; one server/database owner. |
| 3A | P1-04 | Actual app-to-pinned-local-worker execution and output for both credentials/host classes. | P1-02 + P1-03. |
| 3B | P1-06 | Worker-loss recovery using fresh attempts, re-placement and fresh authority. | P1-05; runtime acceptance also needs P1-02/P1-03. |
| 4 | P1-07 | Combined mixed-node functional acceptance and operator pickup runbook. | P1-04 + P1-06. |

This is one initial qualification job followed by six implementation/integration tickets. On a single implementation lane, use numeric order P1-01 through P1-07. With available parallel capacity, use the dependency order above: P1-05 may start before P1-04. UI/runbook/acceptance-fixture preparation can overlap after P1-01; final live acceptance waits for all prerequisites.

The genuine additions beyond the landed W repairs are local batch execution, protected subscription activation, durable fleet placement/slot reservations, and automatic cross-target new-attempt restart. Enrollment, task outputs, quotas, event delivery, identity recovery and existing isolation checks are reused.

## Execution choice and networking

The current distributed production path is worker daemon -> adapter-manager -> E2B. The provider interface is extensible, but its production composition currently selects E2B. Extra worker VPSs do not supply E2B sandbox CPU. An E2B-only SaaS can start with one worker service and adapter-manager beside the VPS control plane, in separate processes/containers; extra supervisory replicas are an availability/throughput choice. Customers need no worker installation in that model.

For this P1, add a local Docker provider. Each worker host has its own worker daemon, private local provider-management endpoint and job containers. Only the management process can control Docker. Job containers and the VPS control plane receive no worker Docker socket. The management endpoint is reachable locally by its worker and is not published to the Internet.

Workers initiate outbound HTTPS to the VPS and the configured object-store endpoint. They need no public hostname, inbound task endpoint, worker certificate or VPN. The central VPS still needs a reachable authenticated HTTPS endpoint; object-store grants also require HTTPS. A restricted container-to-host broker route must be qualified separately on Docker Desktop; host loopback and guest loopback are not interchangeable.

## P1 behavior

| Area | Selected behavior |
| --- | --- |
| Authority | Existing control-plane PostgreSQL, scoped APIs, quotas, audit and fenced leases. No worker database replication. |
| Enrollment | Reuse target creation, enrollment ticket, device identity, durable slot binding and state. One target/identity per independent runtime slot. Never clone identity. |
| Execution | One isolated Linux container per attempt, explicit workspace and resource limits, pinned runtime image. Execute Codex on that host; no implicit E2B or control-plane fallback. |
| Inputs and outputs | Immutable portable input snapshots; staged through existing artifact machinery. Return verified files/patches and usage to the real task UI. No live filesystem mirroring or arbitrary host project mounts. |
| API keys | Explicit organization fleet policy permits compatible authorized targets. Existing company/credential authority remains mandatory. |
| Codex subscriptions | Device-local broker, exact owner/device binding and independently established local login. No copied login bundle in the task container, VPS or job envelope. |
| Capacity | Operator assigns conservative fixed slots/resources. Initially one active batch attempt per registered slot; stronger hosts can have multiple independently provisioned slots with disjoint resource budgets. Free-resource measurements narrow admission. |
| Distribution | Select a free, healthy, compatible slot from an explicit organization fleet allowlist, rotating ties using durable last-assignment order. Pins override fleet routing. Do not choose busy slots while a compatible free slot exists. |
| All eligible workers busy/offline | Durable pending work, visible reason, periodic bounded reconsideration. No silent legacy execution. |
| Offline recovery | New attempt from immutable inputs, after old authority expires/revokes; fresh placement and credentials for replay-safe API-key jobs. Personal/pinned work waits for its authorized target. |
| Side effects | P1 jobs produce files/patches. Publishing, deployment and other irreversible effects require separate approval/idempotency and are not automatically replayed. |

This is local execution of tools and commands; model inference remains at the configured model service. Restart recovery does not preserve process memory or an unfinished CLI conversation. Existing job deadlines and retry limits remain effective.

## Delivery sequence

The five capability sections below define the design; the seven tickets above define implementation ownership and pickup order. Finish P1-01 before broad implementation. Extend the existing scheduler and credential seams; reuse the existing desktop installation path.

### 0. Prove Codex credential confinement and pin the runtime — P1-01

Reuse W06's required feasibility experiment. Record exact CLI version, container image and host configuration. Establish a supported authenticated request path in which the trusted device component holds subscription authentication and arbitrary job commands cannot read or bypass it. A configured proxy URL alone is not evidence of this property.

Verify subscription login/refresh, streamed inference, actual tool execution, cancellation, logout, reboot and simultaneous jobs. Keep public Internet available while cutting access to the AoA authority: the next governed request must be refused when current authority cannot be established. Credential activations must expire no later than the authenticated lease deadline. Test raw sockets, alternative endpoints and malicious project configuration, not only cooperative CLI use.

Existing references: `server/src/services/device-local-broker.ts`, `device-local-activation-policy.ts`, `secret-broker.ts`, and W06/W07 in `docs/aoa/plans/2026-10-16-replatform-completion.md`. The broker contract already exists; the device implementation and trustworthy deadline delivery do not. Official Codex authentication documentation describes API-key and ChatGPT authentication, local credential storage, refresh and custom-provider options; it does not prove AoA's required confinement.

Exit: measured feasible design for both Linux VPS and Windows/Docker Desktop, with no reusable login material exposed to job commands. If this cannot be achieved for the pinned CLI, report the exact obstacle and stop expansion; P1 remains incomplete. A trust-scope or credential-boundary change requires an explicit product/security decision rather than silently weakening W06. API-only success cannot substitute for the required subscription mode.

### 1. Add actual local batch execution — P1-02 / P1-04

Create `packages/sandbox-docker-provider/` implementing the authoritative `SandboxProvider` in `packages/worker-daemon/src/supervisor/provider.ts`. Add only batch capabilities: create/execute/cancel/kill/destroy/list/inspect/reconcile-cleanup, plus the staging, file enumeration, digest and direct artifact export required by task output. Advertise checkpoint, browser and service operations as unsupported.

Compose it in `packages/adapter-manager/src/bin/adapter-manager.ts`. Reuse `server.ts`, `create-gate.ts`, `owned-op-gate.ts` and `idempotency-ledger.ts`; reuse the capability-bound networked worker client. The local provider endpoint stays private. Extend `scripts/lib/worker-slot-inventory.mjs` and `docker/worker/` for a local provider on each worker host without weakening the existing remote-HTTPS validation. Authenticate the private provider channel using existing capabilities.

Use explicit per-container CPU, memory, PID and storage limits; attempt-specific workspaces; ownership labels; bounded operations; full process-tree cancellation; startup orphan reconciliation and independently enforced execution/authority expiry. `packages/adapter-utils/src/execution-target.ts` supplies existing Docker hardening patterns, not a substitute for the distributed provider contract. The container cannot mount host homes, broker custody, worker state or Docker sockets. Required network/credential boundaries must be measured on both host classes.

Exit: an actual task submitted through the authenticated VPS app runs in a local worker container with E2B disabled/unavailable, produces exact verified file bytes in the task UI, and records usage/audit. Cancellation and provider/daemon restart leave no runnable orphan. Test both host classes; a mocked provider is insufficient.

### 2. Wire both credential modes into that execution path — P1-03 / P1-04

Implement `packages/worker-keystore/src/device-local-broker.ts` using the proven design from task 0. Preserve `activate({ handoff }): Promise<DeviceLocalActivation>` and `deactivate(activationId): Promise<void>`: activations return references, never the reusable login value. Deliver authenticated owner/company/target/generation/attempt/lease-deadline facts to the device; invoke the existing expiry clamp in the actual activation path. Revoke activation on fence loss, expiry, owner removal, credential removal and target replacement.

Keep company-key redemption separate. Do not send plaintext credentials through the constrained worker-daemon package or reuse the legacy host-auth-copy path. A streamed model transport and enforced network route are implementation work; the current status-only `egress-proxy.ts` seam is not a ready Codex streaming broker. Extract/share transport-neutral types only through a reviewed allowed package boundary; do not import server runtime into worker packages.

Register the backend's real capabilities. A Docker slot on a PC may use organization scope for company-key work; personal work must use the required owner-bound target/profile. A host can expose separate runtime slots when the two authority modes require it. Never reinterpret a subscription as a company key or reroute to E2B.

Exit: both credential modes perform a real task with the expected owner/backend attribution and returned artifact. Wrong owner, OS identity, company, target generation, expired/missing deadline, removed membership and direct-network bypass are denied. Subscription logout/expiry has an actionable task status; no automatic credential substitution occurs.

### 3. Add explicit fleet placement and durable waiting — P1-05

Primary changes: `server/src/services/execution-target-resolver.ts`, `job-placement.ts`, `job-placement-transaction.ts`, `job-control-sweeper.ts`, `run-execution-owner.ts`, `packages/db/src/repositories/tenant/job-control.ts`, relevant DB/shared policy schemas and existing Settings/task status UI.

Introduce an opt-in organization fleet policy containing approved target IDs/version and replay eligibility. Only compatible company-key batch tasks enter this lane. Personal bindings and explicit pins retain required target identity. Preserve company, owner, locality, provider-profile, budget and revocation checks. Fleet membership grants no credential authority.

For P1, use company-scoped authoritative environment configuration and the existing immutable job policy snapshot/hash/placement request; a separate fleet-management service/table is unnecessary. Add typed bounded target allowlists, version/hash and replay policy. Validate every listed target against the actual organization and credential authority. API-key fleet members use one compatible Docker batch profile cohort; personal/pinned requirements preserve the existing exact owner/target restrictions.

Add a durable bounded placement evaluator. An unavailable/full fleet leaves a pending, unplaced attempt with a wait reason and next evaluation time. Heartbeat/release hints accelerate it; periodic DB scanning guarantees eventual reconsideration after process restart or a missed hint. Do not persist the current immutable `queued` placement decision and assume polling will reconsider it. Prevent these waiting jobs from entering legacy fallback.

Current `job-submission.ts` claims organization capacity before placement, and `run-execution-owner.ts` falls back on nonselected placement. The explicit P1 waiting path must defer the initial claim and retain distributed source ownership. A waiting attempt is `pending`, placement columns null and capacity `unclaimed`; do not claim then release and attempt to reuse a terminal `released` claim. Cancellation while waiting must terminalize once, settle the source run and prevent later selection. Preserve current non-P1 admission behavior.

Select and reserve one slot atomically under existing tenant/target authority locks. Count selected and offered work as reserved, not only running leases. Use durable last-assignment ordering for free slots; keep exact target/generation/profile matching in lease SQL and existing one-worker-per-target constraints. Release the reservation once at completion/cancellation/expiry, retaining correct organization quota accounting. Any new schema must use Drizzle generation and required RLS/grants under existing decisions.

Exit: a burst fills independent PC/VPS slots, queues excess work without oversubscription, resumes as slots free, and survives control-plane restart. Initially offline nodes are skipped; personal jobs remain device-bound. Concurrent evaluator ticks cannot select the same single free slot twice. No implicit pool/host/E2B fallback is reachable.

### 4. Add new-attempt offline recovery and prove the whole journey — P1-06 / P1-07

Change retry allocation in `packages/db/src/repositories/tenant/job-control.ts` and reconciliation in `server/src/services/job-reconciliation.ts` with placement evaluation from task 3. API-key fleet retries start unplaced; personal/pinned retries retain target restrictions. Never overwrite a selected placement or reuse old attempt-bound secrets/grants. Record this as an explicit new policy for cross-target batch restart, not a claim that current mobility support exists.

For this new opt-in fleet mode, release the old target and organization reservation once; the successor starts unplaced/unclaimed and claims both afresh only at successful placement. Keep existing W11 held-capacity transfer for all existing non-fleet retry paths. Rehydrate credential authority from the trusted stored source/policy on each evaluation; a background evaluator must never accept an arbitrary mint-authority argument or persist a reusable secret.

Cover selected-but-never-offered work with a bounded start timeout. It races offer/ACK under the same authoritative locks: expire the old pending attempt and release once before creating its successor. Reuse existing offered/active lease expiry and retry backoff. Re-placement mints fresh target-bound authority. A terminal success accepted before connection loss prevents replay. Exhausted retry/deadline policy surfaces failure/operator action.

Disconnect at selection->offer, offer->ACK, running->result and committed-result->lost-response boundaries. On authority loss, the worker closes governed effects and cleans up; if powered off, startup reconciliation cleans its recorded resources before new execution. The central service cannot remotely prove a partitioned physical process has stopped, so governed effects and commits must require live authority. Replay only side-effect-safe work; external exactly-once execution is not promised.

Final acceptance topology: one authenticated VPS control plane, one Windows PC worker and one separate Linux VPS worker, with distinct targets/state. Submit real tasks through the app. Demonstrate host-local process/workspace evidence, both credential modes, capacity saturation, API-key failover, personal-device waiting/reconnect, revocation, stale result/secret denial, output digest/UI download, cleanup and preserved identity across restart. Repeat expiry/race cases without relying on a test-only SQL placement or fabricated provider output.

## Verification and review boundaries

Add focused provider, broker, placement/waiting, reservation and reconciliation tests before their production changes. Reuse existing enrollment/quotas/leasing suites. Explicitly test duplicate create/events, worker cloning, revocation races, missing object bytes, symlink/path escape, daemon-only crash while Docker remains alive, and partition with public Internet retained. A second slot on a host must not independently reserve the same physical memory budget.

Follow the 19 October implementation test policy: run targeted functional tests plus affected-package typecheck/build; leave whole-suite verification to GitHub CI. Keep performance flags unset; do not provision/rerun W11 fairness, quantitative W13, D4/D5/D6 load/latency/soak campaigns. Preserve their historical verdicts. Execute required PostgreSQL correctness cases rather than counting gated skips. New cases include fleet waiting/reservation/recovery and actual local output, supported by W04/W17's existing capture/teardown infrastructure. No runtime tests were run for this planning-only update.

P1-01 is the critical uncertainty. Local provider plus protected Codex authentication is the largest engineering slice; fleet selection and recovery reuse substantial infrastructure but still require transaction/race work. No reliable calendar estimate is asserted before the feasibility result. After P1-01, provider, broker and scheduling lanes can overlap. One owner writes `job-control.ts`, admission, attempt schema and generated migration through P1-05 then P1-06. Integrate those changes sequentially; parallelize fixtures/UI work against their agreed interfaces.

## P2 / P3

- P2: Claude subscriptions; additional execution sources; native desktop installation/management; richer fleet health and resource telemetry; separately authorized personal credentials on multiple devices.
- P3: PC-hosted control plane and its networking setup, controller HA, unattended autoscaling, multi-tenant local-worker hosting, browser/service migration and checkpoint-based movement.
- E2B-only SaaS remains an alternative deployment track using existing provider code. It is not a prerequisite or an automatic fallback for local fleet P1.

Existing replatform browser/service/HA/release obligations remain recorded in their owning documents. This P1 is a proposed smaller engineering milestone, not closure of the entire replatform program or amendment of its beta gates.

## Grounding

- `docs/replatform/program-design.md`; `docs/architecture/decisions.md` Decisions 117, 121 and 124.
- `docs/replatform/worker-slots-runbook.md`; `docs/aoa/plans/2026-10-16-replatform-completion.md` W06/W07.
- `packages/worker-daemon/src/supervisor/provider.ts`; `packages/worker-networked-host/src/make-run-provider.ts`.
- `packages/adapter-manager/src/bin/adapter-manager.ts`; `packages/worker-keystore/src/bin/sandbox-provider.ts`.
- `server/src/services/job-placement.ts`; `job-placement-transaction.ts`; `run-execution-owner.ts`; tenant `job-control.ts`.
- [Official Codex authentication documentation](https://learn.chatgpt.com/docs/auth), inspected 18 October 2026. Vendor support is context; task 0 must prove compatibility with AoA's authority and custody requirements on the selected pinned build.

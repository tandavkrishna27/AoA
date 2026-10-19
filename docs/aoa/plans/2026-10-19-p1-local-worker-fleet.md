# Central VPS and Local Worker Fleet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This document authorizes planning only; no implementation, credential experiment or deployment was performed in its preparation.

**Goal:** One VPS dispatches batch task runs to actual PC/Linux-VPS hardware, using company API keys or owner-bound Codex subscriptions, with functional capacity routing and safe worker-loss recovery.

**Architecture:** Extend the existing worker protocol, provider-management process, admission, immutable placement, artifact and recovery paths. Add a Docker batch provider and protected local credential activation; add opt-in durable waiting, one-slot target reservations and new-attempt fleet restart. PostgreSQL remains the only execution authority.

**Tech Stack:** Existing TypeScript/Node 24, pnpm 9.15.4, Vitest, PostgreSQL/Drizzle, Docker Linux containers, worker-protocol v1, worker-keystore and adapter-manager; pin the actual Codex/image versions in P1-01.

**Spec:** [Updated P1 design and W01-W17 reuse ledger](../../replatform/design/2026-10-18-central-vps-local-batch-fleet.md).

**Optional multi-chat execution:** [Astra/Sol/Luna orchestration and launch prompt](2026-10-19-p1-orchestration.md). It applies only after explicit human activation; ticket scope, dependencies and acceptance remain defined here.

**Baseline:** `docs/replatform-program`, `920ea681d97934762d30f9eb39a6bb5857feb3d3`, 19 October 2026. Recheck HEAD and superseding results before pickup. All seven ticket IDs below are local planning identifiers, status `not_started`; no external issues or result/QA records have been created. Existing W packages keep their own status.

## Global Constraints

- One central authenticated VPS; one trusted organization; batch `task_run` only; Windows PCs using Linux containers under Docker Desktop and Linux VPS workers.
- Both company API keys and owner-bound Codex personal subscriptions are P1 requirements. Claude subscriptions and other source/workload qualification are deferred.
- Workers connect outbound. Only the VPS/object store need reachable HTTPS; private worker/provider/broker channels are not public worker endpoints.
- One active batch attempt per provisioned target slot. Multiple slots on one physical host require separate identities/state and disjoint conservative resource budgets. Keep existing worker cardinality and exact-target lease checks.
- Personal credentials and explicit pins remain required-target routes. Automatic cross-target restart is only for explicitly replay-safe, authorized company-key jobs in an approved fleet.
- Preserve company/owner scope, approvals, budgets, quota accounting, current fence/generation, immutable terminal/placement records, credential custody, audit and quarantine. Reuse existing claim/release and source-projector authorities.
- No new control-plane command executor, credential copying, silent legacy/E2B fallback, parallel database authority, general fleet service, or worker-protocol v1 operation/byte changes.
- New database fields/indexes are generated through Drizzle; security-only grants/RLS follow Decisions 122/123 and startup certification. Never edit old migrations to fit this feature.
- Use [19 October test policy](2026-10-19-implementation-test-policy.md): targeted functional tests and affected-package types/builds; whole suite in GitHub CI. Performance/load/fairness/latency/soak campaigns remain deferred. Correctness deadlines and fault/race tests stay active.
- Keep existing release exposure and gates unchanged. Record necessary local-provider, credential-route and cross-target-retry decisions in their owning records before code changes; this plan does not certify a release or change the disabled desktop/mobility matrix.

## Review Focus

1. Submission currently claims organization quota before placement: waiting work must start `unclaimed`, not claim then release an attempt that can never claim again. P1-05 owns this test.
2. A background evaluator must reconstruct current credential/membership authority from trusted source/policy; it cannot reuse a request-time mint proof indefinitely. P1-03 defines delivery; P1-05/P1-06 test reevaluation/retry.
3. A PC can have Internet while losing its control-plane connection: govern requests and lease expiry independently of a cleanup callback. P1-01/P1-03/P1-07 own this test.
4. The daemon can crash while Docker and job commands remain alive: expiry, owned startup reconciliation and full-tree cleanup must work without PID guessing. P1-02/P1-06 own this test.
5. A terminal result may commit while its response is lost: retry cannot repeat accepted success, double-release quota, overwrite output or revive cancelled waiting work. P1-05/P1-06/P1-07 own these tests.

## Completed inputs: carry forward, do not rebuild

| Input | Reused from | Qualification boundary |
| --- | --- | --- |
| Model/default/account handling | W01 | Recheck chosen pinned CLI only; complete fresh native entitlement is not implied. |
| Adapter outcome, tool authority/audit, accounting and graceful cancellation | W02 | Native repairs are not distributed personal credential confinement or abrupt-crash recovery. |
| Dependency parity, capture, isolated DB/ACL fixtures, graceful teardown | W03/W04/W17 | Reuse targeted infrastructure; no whole-baseline repair campaign. |
| Artifact export/deadline/abort/integrity | W05 | Actual local-worker-to-UI journey remains to execute. |
| Task invocation/staging and existing API-key/E2B execution | W08 and W12 cohort | No proof of local Docker compute or full W08/source matrix. |
| Terminal convergence, org-quota release, event drain and poll wakes | W11 | Extend these paths for target slots. Historical loaded fairness failures remain deferred. |
| Identity, revoke/replacement, restore/quarantine and useful successor | W12/W15 machinery | Operator-directed E2B successor evidence is not automatic local failover. |
| Realtime replay and relevant Windows process-containment patterns | W13 | Retain them; no new browser/service/HA acceptance. |
| Existing disable/drain/revoke/access/audit seams | W16 prerequisites | Reuse, with small status/UI additions only. Release pipeline work remains separate. |

The detailed W01-W17 mapping and authoritative source handoffs are in the spec. Latest W12/W11 handoffs supersede older unchecked summary rows only for their recorded bounded work; no whole W package is declared complete here.

## Pickup order and fastest delivery

| Pickup | Ticket | Owner | Depends on | Output |
| --- | --- | --- | --- | --- |
| First | P1-01 | Credential/runtime engineer | Existing W06 contract | Measured feasible Codex boundary and fixed interfaces/profile |
| Parallel A | P1-02 | Local-provider engineer | P1-01 | Docker batch provider + local node packaging |
| Parallel B | P1-03 | Credential engineer | P1-01 | Working protected credentials for both modes |
| Parallel C | P1-05 | Server/database engineer | P1-01 | Durable queue + atomic fleet placement/reservations |
| Next A | P1-04 | Integration engineer, or provider owner | P1-02 + P1-03 | Pinned app-to-local-task/output journey |
| Next C | P1-06 | Same server/database owner | P1-05; runtime checks consume P1-02/P1-03 | Automatic bounded worker-loss restart |
| Last | P1-07 | Integration/functional reviewer | P1-04 + P1-06 | Combined mixed-node functional evidence + runbook |

Single-lane order: P1-01, P1-02, P1-03, P1-04, P1-05, P1-06, P1-07. Parallel order: P1-01 -> {P1-02, P1-03, P1-05} -> {P1-04, P1-06} -> P1-07. P1-06's deterministic server tests can progress while P1-04 integrates; its actual runtime acceptance waits for the local-provider/credential composition.

Keep one writer on `job-control.ts`, `job_attempts.ts`, quota/admission integration and the generated migration through P1-05/P1-06. Give adapter-manager/provider composition to P1-02, credential implementation to P1-03, and fleet selectors/status to P1-05; P1-04 consumes their interfaces. Prepare functional fixtures/runbook in parallel rather than editing those shared modules from another lane. Integrate and review each dependent slice once; reuse captures at their exact source scope and rerun only changed boundaries.

## Shared interface decisions

- P1-01 records the pinned image/CLI, protected streaming/auth path, supported host-to-container route and authenticated lease-context delivery. These are feasibility outputs, not assumed Codex features. Downstream work cannot start against an invented proxy interface.
- P1-02 implements the existing `SandboxProvider` in `packages/worker-daemon/src/supervisor/provider.ts`; compose it through existing signed provider-wire gates. Do not implement the conformance-only `SandboxProviderDriver` as the production port.
- P1-03 preserves existing `DeviceLocalCredentialBroker.activate({ handoff }): Promise<DeviceLocalActivation>` and `deactivate(activationId): Promise<void>`. Its activation references, not credential bytes, cross the boundary. Keep company-key resolution separate and reuse existing authority checks.
- P1-05 introduces an internal, trusted `FleetExecutionPolicyV1`: version `1`, mode `fleet | required_target`, bounded target ID allowlist, optional required target, and restart mode `restart_safe | manual`. Source is company-scoped authorized environment configuration, snapshotted into existing `jobs.policySnapshot`/`policyHash`/`placementRequest`. A raw job body or worker report cannot authorize a fleet or credential.
- Proposed P1-05 service: `evaluateFleetAttempt({ organizationId, companyId, jobId, attemptId, now }): Promise<{ kind: "selected"; targetId: string } | { kind: "waiting"; reason: FleetWaitReason } | { kind: "terminal" }>`; `FleetWaitReason` is `no_eligible_target | target_busy | org_capacity | required_target_offline`. A waiting result is an internal outcome, not an immutable E1 placement decision.
- Proposed bounded worker: `runFleetPlacementTick({ organizationId, now, limit }): Promise<{ examined: number; selected: number; waiting: number }>` in a small service composed beside the existing sweeper. The periodic DB scan is authoritative; existing readiness hints only accelerate it.

## P1-01 — Qualify Codex credentials and freeze the local runtime boundary

**Owning work:** W06, with W01/W07 inputs. **Status:** `not_started`.

**Files:** Read existing `server/src/services/device-local-broker.ts`, `device-local-activation-policy.ts`, `secret-broker.ts`, `packages/worker-keystore/src/bin/sandbox-provider.ts`, Codex adapter/auth code and current provider port. Add a bounded probe under `scripts/p1/` and actual result/interface decisions to the owning W06/P1 record only after execution. No production implementation belongs in the feasibility probe.

**Consumes / produces:** Current reference-only broker and lease authority; produces the concrete pinned CLI/image/profile, protected authentication/streaming design, lease-context validation and private node composition that P1-02/P1-03/P1-05 implement. Review compatibility with locked decisions and required local network controls here, before coding dependent modes.

- [ ] Build the smallest isolated actual-Codex probe for company-key and subscription modes on the selected Linux and Windows/Docker Desktop setups. Retain the exact build/configuration and expected useful tool effect; no credential content in captures.
- [ ] Prove login/refresh, streamed inference and actual tools while job commands cannot read reusable authentication, reconfigure the trusted broker or bypass it with alternative clients/raw network paths.
- [ ] Keep public Internet working, remove AoA authority and prove governed requests refuse when current authority cannot be established; activation cannot outlive the authenticated lease. Include logout, malicious project config, process restart and concurrent jobs.
- [ ] Record the implementable boundary and exact targeted probe command/results, including host-specific routing/custody. Audit current placement/admission/reaper lock order for P1-05 before adding reservations. Freeze interfaces; do not change user-global CLI/login installations to make the probe succeed.
- [ ] Review and commit only the bounded probe/result/design. If no protected supported subscription path exists, report that exact result and stop downstream expansion: both modes remain required, so API-key success cannot complete P1 or silently waive the boundary.

**Exit:** Measured feasible design on each advertised host class; no assumption that a proxy setting alone solves credential confinement. This ticket resolves uncertainty before large implementation spend.

## P1-02 — Implement the local Docker batch provider and node composition

**Owning work:** W07/W08, consuming W05/W12. **Depends:** P1-01. **Status:** `not_started`.

**Files:** Create `packages/sandbox-docker-provider/` with manifest/build/test setup, `src/provider.ts`, local Docker transport and focused tests. Modify `packages/adapter-manager/src/bin/adapter-manager.ts`/manifest, `docker/worker/`, `scripts/lib/worker-slot-inventory.mjs` and its tests only for the private local-provider composition. Reuse provider server, create/owned-operation gates, durable idempotency ledger, networked host, W05 artifact sequencing and W12 slot stores.

**Consumes / produces:** P1-01 profile/boundary; produces a `SandboxProvider` implementation and a runnable local-node composition. Both credential modes will use it; P1-03 owns actual credential activation.

- [ ] Add failing contract tests for owned create replay, command exit/error, resource ceilings, path/symlink bounds, staging/enumeration/digest/export, caller abort, process-tree cancellation, daemon/provider crash and cleanup idempotency. Test a dead daemon with Docker still running.
- [ ] Implement the eight core operations plus required file capabilities. Enforce one attempt container/workspace, pinned image, resource budgets, finite execution/authority expiry and owned startup orphan cleanup. Advertise browser/service/checkpoint features as unsupported.
- [ ] Compose provider selection with fail-closed local configuration; retain remote HTTPS checks. Only trusted local management controls Docker. Keep Docker socket, broker custody, worker state and host homes unavailable to task containers; apply the measured network boundary from P1-01.
- [ ] Run `pnpm --filter @armyofagents/sandbox-docker-provider test:run`, affected adapter-manager/worker-host tests, affected-package typecheck/build and isolated Docker functional tests on both engines. Tests must observe actual container/process termination, not only a cancel request.
- [ ] Review and commit the provider/composition slice; record remaining integration acceptance for P1-04/P1-07. Preserve E2B behavior for deployments that explicitly select it.

**Exit:** Genuine local batch commands and artifact transfer work with E2B unavailable, and owned containers are cleaned after stop/restart. A deterministic fake remains a test input, not locality evidence.

## P1-03 — Implement protected company-key and Codex subscription activation

**Owning work:** W06/W07, consuming W01/W02 and W12 API-key handling. **Depends:** P1-01. **Status:** `not_started`.

**Files:** Create `packages/worker-keystore/src/device-local-broker.ts` and tests. Modify existing broker/activation delivery and `server/src/services/secret-broker.ts`, `job-credential-routing.ts`, relevant handle-mint paths, and worker-host composition only as required by P1-01. Preserve allowed package boundaries; shared contracts must be transport-neutral and must not import server runtime into workers.

**Consumes / produces:** P1-01's proven transport and current authorized handoff; produces reference-only activation/deactivation and separate company-key integration consumable by P1-02/P1-04. The actual owner/company/target/generation/attempt/lease deadline must be authenticated, not supplied by the tenant command.

- [ ] Add failing cases for wrong owner/OS identity/company/target generation, missing/expired lease deadline, removed membership, logout/revocation, refresh races and direct bypass. Pin the missing-deadline rejection before implementing activation.
- [ ] Implement the proven activation path, invoke the existing expiry clamp in production and reauthorize governed requests. Preserve separate company-key resolution and plaintext-secret boundaries; W12 stdin/private-home API-key evidence does not authorize copying personal login material.
- [ ] Integrate streaming, tools, refresh and cancellation with the selected CLI. Make credential readiness and owner-bound target profiles honest. Use separate scoped target/identity slots where credential ceilings require it; allocate disjoint host resources.
- [ ] Run focused new worker-keystore broker tests, existing server broker/routing/mint tests and affected types/builds; execute the P1-01 retained-Internet partition and actual credential-mode probes against the implementation. A skipped live mode is not a completed ticket.
- [ ] Review and commit. Record the exact supported mode/build/host combinations for P1-04; keep unsupported vendors/modes refused without host/E2B/credential substitution.

**Exit:** Both modes actually execute under the required boundary; expiry/revocation destroys job authority even if the underlying personal login remains stored locally.

## P1-04 — Connect actual task execution to pinned local workers and outputs

**Owning work:** W05/W07/W08. **Depends:** P1-02 + P1-03. **Status:** `not_started`.

**Files:** Reuse `server/src/services/task-run-batch-workload.ts`, `task-run-sandbox-invocation.ts`, `sandbox-coding-staging.ts`, `job-output-bridge.ts`, worker artifact export and normal task-output content routes. Update only demonstrated integration defects. Add a bounded functional journey under `tests/d1/p1-local-task.test.mjs`; reuse W04/W17 capture and W12 identity/teardown helpers. Use existing explicit target configuration; P1-05 owns fleet selectors.

**Consumes / produces:** Local provider + credential activation; produces an actual task-run composition and exact output/UI readback on a selected local target. This is the first useful product checkpoint, before full failover acceptance.

- [ ] Add keyless functional regressions for the normal source-to-job envelope/staging/ownership/output joins, wrong backend/profile and unavailable credential; observe initial failures without SQL-inserting placement or synthesizing provider success.
- [ ] Wire the missing local provider/credential capability route and source-result projection. Retain W01 model selection, W02 accounting/audit/cancel and W05 export integrity; do not rebuild those subsystems or change unrelated sources.
- [ ] Submit actual authenticated VPS tasks for the four host-class x credential-mode combinations. Verify local container/process/workspace provenance, E2B absence, generated file bytes/hash/size, normal UI/download readback and one durable usage/audit attribution. Login separately to a worker when the mode requires it.
- [ ] Exercise normal cancellation, missing/corrupt input and output denial using targeted tests. Run the selected actual journey via `node --test tests/d1/p1-local-task.test.mjs`, plus affected package types/builds. Preserve actual credential/platform skips as open acceptance.
- [ ] Review and commit integration plus exact bounded evidence. Keep final burst, mixed-fleet and offline recovery acceptance in P1-07.

**Exit:** The actual app can use both credentials on actual worker hardware and return usable output. A local provider unit test or E2B task cannot substitute for this checkpoint.

## P1-05 — Add durable fleet waiting and atomic slot placement

**Owning work:** Additional functional fleet scope related to W11; reuse its landed convergence/wake fixes. **Depends:** P1-01. **Status:** `not_started`.

**Files:** Modify `server/src/services/job-submission.ts`, `run-execution-owner.ts`, `job-placement.ts`, `job-placement-transaction.ts`, `execution-target-resolver.ts`, `org-concurrency.ts`, server composition, tenant `job-control.ts` and `packages/db/src/schema/job_attempts.ts`. Create small `server/src/services/fleet-placement.ts` / `fleet-placement-sweeper.ts`. Extend existing shared/environment config validators and existing Settings/task-status API/UI. Generate one owned migration for required wait/reservation fields and indexes. Add `server/src/__tests__/job-fleet-placement.integration.test.ts` and extend existing quota/cancellation/projection cases.

**Consumes / produces:** Fixed P1-01 cohort and trusted policy; produces the internal evaluator/tick interface above. Use existing job policy snapshot/hash/placement request; add nullable `placementWaitReason`, `placementEvaluateAfter` and target-slot claim state/timestamps to attempts. A partial unique index on held `(organization_id, placement_target_id)` enforces the one-slot rule. Existing organization claims remain the quota authority.

- [ ] Add failing real-PG tests: offline/full fleet waits with null placement and zero org/target claims; duplicate submission creates one job; waiting survives restart; cancellation/deadline expiry finalizes once; removed actor/credential cannot later dispatch; existing non-P1 admission retains its behavior.
- [ ] Add opt-in trusted fleet/required-target policy derivation and a durable distributed-waiting outcome. Defer submit-time org claim only for that validated mode. Do not claim/release/reclaim an attempt, return waiting work to legacy, or terminalize its source merely because no slot is free. Preserve single-assignee/per-agent admission while it waits.
- [ ] Add the bounded DB evaluator and atomic select/reserve/org-quota/immutable-placement/mint/readiness transaction. Filter scope, membership, policy/profile hashes, generation, liveness, locality, budget and credential authority; use durable least-recently-assigned free-slot ordering with target-ID tie break. Use one compatible Docker batch profile cohort, not a general resource optimizer. Derive fresh mint authority from the trusted source on reevaluation.
- [ ] Cover concurrent evaluators, one remaining slot, org quota full, actor removal, revocation, mint failure rollback, partial selection failure, missed hints and wait cancellation. Reuse W11 release paths for success/cancel and extend every terminal/cancel/expiry path to release target slots once; preserve non-fleet retry transfer. Expose only minimal fleet choice and waiting reasons in existing UI/API.
- [ ] Run targeted `pnpm exec vitest run server/src/__tests__/job-fleet-placement.integration.test.ts server/src/__tests__/job-quotas.integration.test.ts server/src/__tests__/job-terminal-convergence.integration.test.ts` with real PostgreSQL cases enabled on the host, plus affected types/builds, generated-migration/startup/RLS checks and UI regressions. Review/commit with one DB owner and no performance flags.

**Exit:** Compatible free PC/VPS slots receive work, excess work waits without execution claims, and restart/cancel/races neither lose accepted work nor oversubscribe. Exact-target lease SQL and selected-placement immutability remain intact.

## P1-06 — Recover offline workers through safe fresh attempts

**Owning work:** W12 extension; reuse W05/W15 fencing/quarantine and W11 terminal release. **Depends:** P1-05; actual runtime checks also require P1-02/P1-03. **Status:** `not_started`.

**Files:** Same repository owner modifies retry allocation in tenant `job-control.ts`, `server/src/services/job-reconciliation.ts`, `job-control-sweeper.ts`, the fleet evaluator and current source-terminal projector/secret mint composition. Change worker renewal/local-provider cleanup only for demonstrated remaining gaps. Add `server/src/__tests__/job-fleet-recovery.integration.test.ts` and extend current retry-capacity-transfer and lease-less cancellation tests.

**Consumes / produces:** P1-05's wait/claim API; produces fresh pending/unplaced/unclaimed successors for the new policy, preserving immutable inputs and exact required-target restrictions. Current non-fleet retries continue their established held-capacity transfer. Reuse existing lease deadlines/backoff/retry limits; a selected-but-unoffered start deadline is recorded and enforced as a correctness contract.

- [ ] Add failing tests at selection->offer, offer->ACK, running->terminal and accepted-terminal->lost-response boundaries, including competing reapers/ACK/result and worker return after replacement.
- [ ] On bounded selected-start timeout or expired lease, release old target/org claims exactly once and create the increasing successor atomically. Before placement, offline/busy waiting must not consume retries. Cancelled/revoked jobs never revive; an accepted final success never restarts.
- [ ] Re-place only opted-in replay-safe API-key work, revalidate current policy/credential authority and mint new attempt/target authority. Stage the successor from the original verified immutable input manifest/base hash using current authorized artifact grants; never reuse old lease-bound URLs or a failed worker's partial filesystem. Personal/pinned successors retain required target and wait there under their original deadline/retry policy. Retain stale result/secret/ordinary-commit rejection and quarantine. No automatic deployment/publishing or unknown external side effects are replayed.
- [ ] Extend source-run/heartbeat completion and wakeup so worker failure does not require W12's manual board cancel to unblock the next eligible task. Exercise crash while Docker lives, startup cleanup, partition with Internet retained and old worker reconnect; use P1-02/P1-03's authority boundary rather than unsafe remote PID termination.
- [ ] Run targeted `pnpm exec vitest run server/src/__tests__/job-fleet-recovery.integration.test.ts server/src/__tests__/job-reconciliation.integration.test.ts`, existing retry/quota/terminal regressions and affected worker/provider types/tests; review/commit. Runtime failure checks wait for actual local composition, not a fabricated provider result.

**Exit:** One authoritative terminal result, no leaked/double claims, no old authority reuse, automatic eligible API-key restart, and honest bound-device waiting. This is restart from immutable inputs, not checkpoint/process-memory migration or full disaster recovery.

## P1-07 — Verify the mixed-node product and publish pickup instructions

**Owning work:** Narrow W17 acceptance consuming W05/W07/W08/W12; existing W16 operator controls. **Depends:** P1-04 + P1-06. **Status:** `not_started`.

**Files:** Extend `tests/d1/p1-local-task.test.mjs` and add a small mixed-worker functional fault driver; reuse existing capture/identity/teardown helpers. Update `docs/replatform/worker-slots-runbook.md` and a P1 operator section describing installation, configuration, enrollment, resource budgets, credential readiness, drain/revoke/replacement and exact supported matrix. Use actual result/evidence records only after execution.

**Consumes / produces:** Composed local execution, both credential lanes, durable scheduling and recovery. Produces an exact-candidate functional verdict and reviewable operator commands, not a release/HA/load certification.

- [ ] Prepare one isolated VPS authority with reachable HTTPS storage, one Windows PC worker and one separate Linux VPS worker; preserve unrelated installations. Provision distinct identities, scoped credential profiles and conservative resources. Workers need no inbound/public endpoint or VPN.
- [ ] Run actual task submission/output for both credentials on both supported host classes. Use a small barrier-controlled burst to occupy configured slots, select another free compatible slot and then visibly queue excess work; cancel one waiting task and restart the controller to prove durable progress.
- [ ] Disconnect a running API-key worker and show a fresh successful attempt on the other eligible host with exact output readback. Prove stale authority/output denial; verify selected/offer/ACK/result-loss boundaries and no duplicate success. Keep authority unavailable with public Internet retained for the credential denial case.
- [ ] Show a personal task remains on its authorized device, waits through its outage and restarts there when permitted; another machine cannot receive the login/job by fallback. Verify pin, owner/company/locality, budget-stop, duplicate identity and target revocation denials.
- [ ] Run only the selected functional integration commands, affected types/builds and CI-required guards. Verify each owned process/container/artifact disposition and capture actual native exits. Publish supported mode/host/runtime versions, exact evidence and remaining exclusions; independent review checks source-to-result joins and retained W regressions.

**Exit:** All required functional rows have actual useful-work evidence on one candidate; unsupported rows refuse; no owned runnable orphan remains. Whole-suite GitHub CI remains its own result. No W11 throughput, 15-minute realtime repetition, 72-hour service run, expanded HA/DR, D6 beta or main/release merge is required or implied by this P1 increment.

## Handoff and progress tracking

The first job to pick up is **P1-01**. Once its boundary/interface review passes, dispatch **P1-02/P1-03/P1-05** concurrently if capacity permits. Work on the shared server/database lane remains sequential through P1-06. P1-04 gives an early useful local execution checkpoint while that lane finishes; P1-07 is the final join.

Use the existing repository worktree, review, result and evidence conventions at execution time. Record completed sub-scope back against its owning W item; do not mark W06/W07/W08/W11/W12/W17 wholly complete from a narrower P1 result. Preserve all prior immutable failures and test qualifications. No further global refactor, fresh scheduler, reinstall wizard or whole-suite/performance campaign belongs in the pickup queue.

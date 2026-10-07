import { createHash } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { companies, heartbeatRuns, internalAgentRuns, issues, jobs, leases, workers, executionTargets, companyMcpConnectors,companyMcpConnectorAgents,type Db } from "@armyofagents/db";
import { workerHelloV1Schema } from "@armyofagents/worker-protocol";
import { runInTenant } from "../db/tenant-context.js";
import { HttpError } from "../errors.js";
import type { StorageProvider } from "../storage/types.js";
import { browserSessionRequestSchema, buildBrowserRunnerConfig, parseAuthoritativeBrowserPolicy, parseBrowserPreparation, type BrowserPreparation } from "./browser-runtime-preparation.js";
import { browserRuntimeInputFiles } from "./browser-runtime-bundle.js";
import { getBrowserSessionCredentialPort } from "./browser-session-credentials.js";
import { stageJobInputFiles } from "./job-input-staging.js";
import { submitJobWithinTenant } from "./job-submission.js";
import { budgetService } from "./budgets.js";
import { createJobReconciliationService } from "./job-reconciliation.js";
import { normalizePlacementRegistryTarget } from "./execution-target-resolver.js";
import type { JobPlacementServiceDependencies } from "./job-placement.js";
import type { PreparedActivityEvent } from "./activity-log.js";
import type { AdmissionDenialSink } from "./worker-admission-denial-audit.js";
import {browserSessionBindingSchema} from "../config/browser-session-bindings.js";

export interface AgentBrowserRequestActor { companyId: string; agentId: string; runId: string; runKind?: "heartbeat" | "internal_agent" }
export interface AgentBrowserRequestResult { browserRequestId: string; jobId: string; attemptId: string; status: "queued"; replayed: boolean }
export interface AgentBrowserRequestPort { request(actor: AgentBrowserRequestActor, raw: unknown): Promise<AgentBrowserRequestResult> }
let registered: AgentBrowserRequestPort | undefined;
const browserTargetColumns = { id: executionTargets.id, slug: executionTargets.slug, kind: executionTargets.kind,
  trustClass: executionTargets.trustClass, status: executionTargets.status, organizationId: executionTargets.organizationId,
  ownerUserId: executionTargets.ownerUserId, scope: executionTargets.scope, targetAuthorityKey: executionTargets.targetAuthorityKey,
  deviceGeneration: executionTargets.deviceGeneration, registeredProfile: executionTargets.registeredProfile,
  registeredProfileHash: executionTargets.registeredProfileHash, providerConstraintProfile: executionTargets.providerConstraintProfile,
  lastSeenAt: executionTargets.lastSeenAt };
export function setAgentBrowserRequestPort(port: AgentBrowserRequestPort | undefined): void { registered = port; }
export function requestBrowserSessionForActiveRun(actor: AgentBrowserRequestActor, raw: unknown): Promise<AgentBrowserRequestResult> {
  if (!registered) throw new HttpError(503, "Governed browser execution is unavailable");
  return registered.request(actor, raw);
}

function refusal(message: string): never { throw new HttpError(409, message); }
function requestId(actor: AgentBrowserRequestActor, key: string): string {
  const hash = createHash("sha256").update(JSON.stringify([actor.companyId, actor.agentId, actor.runId, key])).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Credential/TRUST/locality ceilings are inherited by pinning the exact parent
 * target, profile and generation. No provider key or parent secret is copied. */
export async function resolveBrowserChildCredentialBinding(appDb: Db, registryDb: Db,
  input: Parameters<JobPlacementServiceDependencies["resolveCredentialBinding"]>[0]) {
  return runInTenant(appDb, input.organizationId, async (_repos, tx) => {
    const [job] = await tx.select({ policy: jobs.policySnapshot, source: jobs.sourceIntent }).from(jobs).where(and(eq(jobs.id, input.jobId), eq(jobs.organizationId, input.organizationId), eq(jobs.companyId, input.companyId), eq(jobs.sourceKind, "browser_request")));
    const preparation = parseBrowserPreparation(job?.policy.browserPreparation);
    if (!preparation || job?.source.parentJobId !== preparation.parentJobId) refusal("Browser parent binding unavailable");
    const [parent] = await tx.select({ id: leases.id }).from(leases).innerJoin(jobs, eq(jobs.id, leases.jobId)).where(and(
      eq(leases.organizationId, input.organizationId), eq(leases.companyId, input.companyId), eq(leases.id, preparation.parentLeaseId),
      eq(leases.jobId, preparation.parentJobId), eq(leases.attemptId, preparation.parentAttemptId), eq(leases.status, "active"),
      eq(jobs.status, "running"), sql`${leases.expiresAt} > clock_timestamp()`));
    const [row] = await tx.select(browserTargetColumns).from(executionTargets).where(and(eq(executionTargets.id, preparation.targetId), eq(executionTargets.targetAuthorityKey, preparation.targetAuthorityKey)));
    const target = row ? await normalizePlacementRegistryTarget(row) : null;
    if (!parent || !target || target.status !== "active" || target.targetGeneration !== preparation.targetGeneration || target.profileHash !== preparation.targetProfileHash || target.providerConstraintHash !== preparation.providerConstraintHash) refusal("Browser parent target authority unavailable");
    return { credentialId: "inherited-browser-authority", credentialKind: target.targetClass === "owner_desktop" ? "personal_subscription" as const : "company_api_key" as const,
      executionTargetSlug: target.targetSlug, pinnedTargetId: target.targetId,
      ...(target.targetClass === "owner_desktop" ? { credentialOwnerPrincipalId: target.registeredProfile.ownerPrincipalId } : {}) };
  });
}

/** Captures the app pool, storage and placement service once in the composition
 * root. Callers supply their authenticated run identity, never a parent/target. */
export function createAgentBrowserRequestService(input: {
  appDb: Db; identityDb: Db; registryDb: Db; storage: StorageProvider;
  enabled(organizationId: string, companyId: string): Promise<boolean>;
  place(input: { organizationId: string; companyId: string; jobId: string; attemptId: string; now: Date; maxHeartbeatAgeMs: number }): Promise<{ leaseEligible: boolean }>;
}): AgentBrowserRequestPort {
  return { async request(actor, raw) {
    if (!actor.agentId || !actor.runId || !actor.companyId) throw new HttpError(403, "Browser requests require an authenticated agent run");
    const [company] = await input.identityDb.select({ organizationId: companies.organizationId }).from(companies).where(eq(companies.id, actor.companyId));
    if (!company?.organizationId || !await input.enabled(company.organizationId, actor.companyId)) throw new HttpError(503, "Governed browser execution is unavailable");
    const parsed = browserSessionRequestSchema.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, "Invalid browser session request");
    const request = parsed.data;
    const browserRequestId = requestId(actor, request.idempotencyKey);
    const organizationId = company.organizationId;
    const auditSink: { event: PreparedActivityEvent | null } = { event: null };
    const denialSink: AdmissionDenialSink = { intent: null };
    const prepared = await runInTenant(input.appDb, organizationId, async (repos, tx) => {
      const heartbeat = actor.runKind !== "internal_agent" ? await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, actor.runId), eq(heartbeatRuns.companyId, actor.companyId), eq(heartbeatRuns.agentId, actor.agentId))).then((rows) => rows[0]) : null;
      const crew = !heartbeat && actor.runKind !== "heartbeat" ? await tx.select().from(internalAgentRuns).where(and(eq(internalAgentRuns.id, actor.runId), eq(internalAgentRuns.companyId, actor.companyId), eq(internalAgentRuns.agentId, actor.agentId))).then((rows) => rows[0]) : null;
      const run = heartbeat ?? crew;
      if (!run || run.status !== "running" || run.executionOwner !== "distributed" || !run.distributedJobId || !run.distributedAttemptId) refusal("Browser requests require an active distributed task run");
      const [parent] = await tx.select().from(jobs).where(and(eq(jobs.id, run.distributedJobId), eq(jobs.organizationId, organizationId), eq(jobs.companyId, actor.companyId)));
      const [lease] = await tx.select().from(leases).where(and(eq(leases.organizationId, organizationId), eq(leases.companyId, actor.companyId), eq(leases.jobId, run.distributedJobId), eq(leases.attemptId, run.distributedAttemptId), eq(leases.status, "active"))).limit(1);
      if (!parent || parent.status !== "running" || !(parent.executorPrincipalId === actor.agentId ||
          (parent.sourceKind === "one_shot" && parent.authenticatedPrincipalKind === "agent" && parent.authenticatedPrincipalId === actor.agentId)) || !["task_run", "crew_run", "one_shot"].includes(parent.sourceKind) ||
          !lease?.workerId || !lease.targetId || !lease.targetAuthorityKey || !lease.targetGeneration || !lease.profileHash || !lease.providerConstraintHash || !lease.attemptNumber) refusal("Browser parent authority unavailable");
      await repos.jobControl.lockActiveFence({ organizationId, companyId: actor.companyId, jobId: parent.id, attemptId: run.distributedAttemptId,
        attemptNumber: lease.attemptNumber, leaseId: lease.id, workerId: lease.workerId, targetId: lease.targetId, targetAuthorityKey: lease.targetAuthorityKey,
        targetGeneration: lease.targetGeneration, profileHash: lease.profileHash, providerConstraintHash: lease.providerConstraintHash, fence: lease.fence });
      const [issue] = await tx.select({ id: issues.id, projectId: issues.projectId }).from(issues).where(and(eq(issues.companyId, actor.companyId), eq(issues.assigneeAgentId, actor.agentId), eq(issues.status, "in_progress"), or(eq(issues.checkoutRunId, actor.runId), eq(issues.executionRunId, actor.runId)))).limit(1);
      if (!issue) refusal("Browser requests require the agent's active task checkout");
      if ((parent.sourceKind === "task_run" || parent.sourceKind === "crew_run") && parent.sourceIdentity !== actor.runId) refusal("Browser parent run identity mismatch");
      if (parent.sourceKind === "task_run" && parent.sourceIntent.issueId !== issue.id) refusal("Browser parent task identity mismatch");
      const children = await tx.select({ id: jobs.id, sourceIdentity: jobs.sourceIdentity }).from(jobs).where(and(eq(jobs.organizationId, organizationId), eq(jobs.companyId, actor.companyId),
        eq(jobs.sourceKind, "browser_request"), sql`${jobs.policySnapshot}->'browserPreparation'->>'parentJobId' = ${parent.id}`,
        inArray(jobs.status, ["queued", "running", "cancel_requested"]))).limit(33);
      if (children.length >= 32 && !children.some((child) => child.sourceIdentity === browserRequestId)) refusal("Browser parent concurrency limit reached");
      const block = await budgetService(tx).getInvocationBlock(actor.agentId, actor.companyId, { projectId: issue.projectId });
      if (block) throw new HttpError(429, "Browser request budget hard-stop reached");
      const [worker] = await tx.select({ profile: workers.profileSnapshot, status: workers.status, revokedAt: workers.revokedAt, fresh: sql<boolean>`(${workers.lastSeenAt} > clock_timestamp() - interval '90 seconds')` }).from(workers).where(and(eq(workers.id, lease.workerId), eq(workers.executionTargetId, lease.targetId), eq(workers.targetAuthorityKey, lease.targetAuthorityKey), eq(workers.profileHash, lease.profileHash), eq(workers.deviceGeneration, lease.targetGeneration)));
      const hello = workerHelloV1Schema.safeParse(worker?.profile);
      if (!worker) refusal("Browser parent worker identity unavailable");
      if (!["active", "enrolled"].includes(worker.status) || worker.revokedAt) refusal("Browser parent worker is unavailable");
      if (worker.fresh !== true) refusal("Browser parent worker heartbeat is stale");
      if (!hello.success || !hello.data.reportedCapabilities.includes("workload.browser_session") || !hello.data.reportedCapabilities.includes("sandbox.filtered_egress") || hello.data.capacity.browserSessionSlots < 1) refusal("Browser capability or capacity unavailable");
      const [targetRow] = await tx.select(browserTargetColumns).from(executionTargets).where(and(eq(executionTargets.id, lease.targetId), eq(executionTargets.targetAuthorityKey, lease.targetAuthorityKey)));
      const target = targetRow ? await normalizePlacementRegistryTarget(targetRow) : null;
      if (!target || target.status !== "active" || target.targetGeneration !== lease.targetGeneration || target.providerConstraintHash !== lease.providerConstraintHash ||
          !target.registeredProfile.capabilityCeiling.includes("workload.browser_session") || !target.registeredProfile.capabilityCeiling.includes("sandbox.filtered_egress")) refusal("Browser target enforcement unavailable");
      const policy = parseAuthoritativeBrowserPolicy(parent.policySnapshot.networkPolicy);
      if (!policy) refusal("Authoritative parent network policy unavailable");
      const bindings=Array.isArray(parent.policySnapshot.browserSessionBindings)?parent.policySnapshot.browserSessionBindings:[];
      const selected=request.sessionBindingId?bindings.map(binding=>browserSessionBindingSchema.safeParse(binding)).find(binding=>binding.success&&binding.data.bindingId===request.sessionBindingId):null;
      const sessionBinding=selected?.success?selected.data:undefined;
      if(request.sessionBindingId) {
        if (!getBrowserSessionCredentialPort()) refusal("Scoped browser session broker unavailable");
        try { await getBrowserSessionCredentialPort()!.assertReady(); } catch { refusal("Scoped browser session encryption unavailable"); }
        if(!sessionBinding)refusal("Trusted browser session binding unavailable");
        const [connector]=await input.identityDb.select({id:companyMcpConnectors.id}).from(companyMcpConnectors)
          .innerJoin(companyMcpConnectorAgents,and(eq(companyMcpConnectorAgents.connectorId,companyMcpConnectors.id),eq(companyMcpConnectorAgents.companyId,actor.companyId),eq(companyMcpConnectorAgents.agentId,actor.agentId)))
          .where(and(eq(companyMcpConnectors.id,sessionBinding.connectorId),eq(companyMcpConnectors.companyId,actor.companyId),eq(companyMcpConnectors.status,"active"),eq(companyMcpConnectors.source,"catalog")));
        if(!connector)refusal("Agent browser connector authority unavailable");
      }
      const { workload, config } = buildBrowserRunnerConfig(request, policy, Array.isArray(parent.policySnapshot.controlPlaneDenyCidrs) ? parent.policySnapshot.controlPlaneDenyCidrs as string[] : [],sessionBinding);
      const preparation: BrowserPreparation = { schemaVersion: 1, requestDigest: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
        runId: actor.runId, agentId: actor.agentId, issueId: issue.id, parentJobId: parent.id, parentAttemptId: run.distributedAttemptId, parentLeaseId: lease.id,
        targetId: lease.targetId, targetAuthorityKey: lease.targetAuthorityKey, targetGeneration: lease.targetGeneration,
        profileHash: lease.profileHash, targetProfileHash: target.profileHash, providerConstraintHash: lease.providerConstraintHash, networkPolicy: policy,...(sessionBinding?{sessionBinding}:{}) };
      await tx.insert(internalAgentRuns).values({ id: browserRequestId, companyId: actor.companyId, agentId: actor.agentId,
        triggerType: "sub_agent", triggerSource: "browser_request", status: "running", relatedEntityType: "task", relatedEntityId: issue.id }).onConflictDoNothing();
      const response = await submitJobWithinTenant(repos, { organizationId, companyId: actor.companyId, principal: { kind: "agent", id: actor.agentId },
        command: { idempotencyKey: request.idempotencyKey, source: { kind: "browser_request", browserRequestId, parentJobId: parent.id }, input: workload }, trustedBrowserPreparation: preparation }, tx, denialSink, auditSink);
      await tx.update(internalAgentRuns).set({ executionOwner: "distributed", distributedJobId: response.jobId, distributedAttemptId: response.attemptId }).where(and(eq(internalAgentRuns.id, browserRequestId), eq(internalAgentRuns.companyId, actor.companyId), eq(internalAgentRuns.agentId, actor.agentId)));
      return { response, config };
    }).finally(async () => {
      if (denialSink.intent) {
        const { drainAdmissionDenial } = await import("./worker-admission-denial-audit.js");
        await drainAdmissionDenial(input.appDb, denialSink, { control: "server/src/services/agent-browser-request.ts:request" });
      }
    });
    if (auditSink.event) {
      const { publishJobControlActivity } = await import("./job-control-audit.js");
      publishJobControlActivity([auditSink.event]);
    }
    try {
      const files = await browserRuntimeInputFiles(prepared.config);
      await stageJobInputFiles({ appDb: input.appDb, storage: input.storage, organizationId, companyId: actor.companyId, jobId: prepared.response.jobId, attemptId: prepared.response.attemptId, files });
      const placement = await input.place({ organizationId, companyId: actor.companyId, jobId: prepared.response.jobId, attemptId: prepared.response.attemptId, now: new Date(), maxHeartbeatAgeMs: 90_000 });
      if (!placement.leaseEligible) refusal("Browser placement unavailable");
      return { browserRequestId, ...prepared.response };
    } catch (error) {
      await createJobReconciliationService({ appDb: input.appDb }).requestCancellation({ organizationId, companyId: actor.companyId, jobId: prepared.response.jobId, reason: "browser_preparation_failed", graceful: false });
      throw error;
    }
  } };
}

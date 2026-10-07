import { and, eq } from "drizzle-orm";
import { companies, companyMemberships, internalAgentConversations, internalAgentMessages, internalAgentRuns, jobs, type Db } from "@armyofagents/db";
import { submitJobSourceSchema } from "@armyofagents/shared";
import { resolveUserRole } from "../mcp/tools/scope.js";

/** User admission stores the requester role; authentication stores the user identity. */
export function commanderJobHasHumanOwner(job: Pick<typeof jobs.$inferSelect,
  "requesterPrincipalKind" | "requesterPrincipalId" | "authenticatedPrincipalKind" | "authenticatedPrincipalId">): boolean {
  return ["user", "founder", "team_lead", "team_member"].includes(job.requesterPrincipalKind) &&
    job.authenticatedPrincipalKind === "user" && job.authenticatedPrincipalId === job.requesterPrincipalId;
}

/** Shared trusted source read for routing and at-use Commander credential/JWT redemption. */
export async function loadCommanderJobAuthority(db: Db, input: { companyId: string; jobId: string; organizationId?: string }) {
  return loadAuthority(db, input, true);
}

/** Owner-only status cleanup; never used for credentials, logs or reply delivery. */
export async function loadCommanderJobRetirementAuthority(db: Db, input: { companyId: string; jobId: string; organizationId?: string }) {
  return loadAuthority(db, input, false);
}

async function loadAuthority(db: Db, input: { companyId: string; jobId: string; organizationId?: string }, requireActiveMembership: boolean) {
  const [row] = await db.select({ job: jobs, organizationId: companies.organizationId }).from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId)).where(and(eq(jobs.id, input.jobId), eq(jobs.companyId, input.companyId),
      eq(jobs.organizationId, companies.organizationId), ...(input.organizationId ? [eq(jobs.organizationId, input.organizationId)] : []))).limit(1);
  if (!row || !row.organizationId || row.job.sourceKind !== "commander_turn" ||
    !commanderJobHasHumanOwner(row.job)) return null;
  const parsed = submitJobSourceSchema.safeParse(row.job.sourceIntent);
  if (!parsed.success || parsed.data.kind !== "commander_turn") return null;
  const source = parsed.data;
  if (row.job.sourceIdentity !== source.internalAgentRunId || row.job.executorPrincipalKind !== "sandbox" ||
    row.job.executorPrincipalId !== source.internalAgentRunId) return null;
  const runQuery = db.select({ provider: internalAgentRuns.provider, userId: internalAgentRuns.userId,
    executionOwner: internalAgentRuns.executionOwner, distributedJobId: internalAgentRuns.distributedJobId, distributedAttemptId: internalAgentRuns.distributedAttemptId, status: internalAgentRuns.status })
    .from(internalAgentRuns)
    .innerJoin(internalAgentMessages, eq(internalAgentMessages.runId, internalAgentRuns.id))
    .innerJoin(internalAgentConversations, eq(internalAgentConversations.id, internalAgentMessages.conversationId));
  const authorizedQuery = requireActiveMembership ? runQuery
    .innerJoin(companyMemberships, and(eq(companyMemberships.companyId, internalAgentRuns.companyId),
      eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, row.job.requesterPrincipalId), eq(companyMemberships.status, "active"))) : runQuery;
  const [run] = await authorizedQuery
    .where(and(eq(internalAgentRuns.id, source.internalAgentRunId), eq(internalAgentRuns.companyId, input.companyId),
      eq(internalAgentRuns.triggerType, "conversation"), eq(internalAgentRuns.userId, row.job.requesterPrincipalId),
      eq(internalAgentConversations.id, source.conversationId), eq(internalAgentConversations.companyId, input.companyId),
      eq(internalAgentConversations.userId, row.job.requesterPrincipalId))).limit(1);
  if (!run?.userId || (run.provider !== "openai" && run.provider !== "anthropic")) return null;
  const activeMembership = requireActiveMembership || Boolean((await db.select({ id: companyMemberships.id }).from(companyMemberships)
    .where(and(eq(companyMemberships.companyId, input.companyId), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, run.userId), eq(companyMemberships.status, "active"))).limit(1))[0]);
  return { activeMembership, organizationId: row.organizationId, companyId: input.companyId, jobId: input.jobId,
    turnId: source.internalAgentRunId, conversationId: source.conversationId, userId: run.userId,
    userRole: await resolveUserRole(db, input.companyId, run.userId),
    provider: run.provider, adapterType: run.provider === "openai" ? "codex_local" : "claude_local",
    executionOwner: run.executionOwner, distributedJobId: run.distributedJobId, distributedAttemptId: run.distributedAttemptId, status: run.status };
}

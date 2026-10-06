import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { companies, companyMemberships, internalAgentConversations, internalAgentMessages, internalAgentRuns, jobs, jobAttempts, jobArtifacts, type Db } from "@armyofagents/db";
import { submitJobSourceSchema } from "@armyofagents/shared";
import { runInTenant } from "../db/tenant-context.js";
import { loadCommanderJobAuthority } from "./commander-job-authority.js";
import { createOneShotDistributedResultReader } from "./one-shot-distributed-result-store.js";
import { isKnownRateModel } from "./internal-agent/cost-model.js";
import { buildCommanderDistributedInvocation } from "./commander-distributed-invocation.js";
import { stagedPathMarker } from "./job-input-staging.js";
import type { StorageProvider } from "../storage/types.js";
import type { CommanderDistributedInput } from "./commander-distributed-port.js";
import type { SandboxStagedFile } from "./task-run-sandbox-invocation.js";

export function createCommanderDistributedResultReader(appDb: Db, storage: StorageProvider) {
  return createOneShotDistributedResultReader(appDb, storage, async (tx, job, scope) => {
    const source = submitJobSourceSchema.safeParse(job.sourceIntent);
    if (!source.success || source.data.kind !== "commander_turn" || source.data.internalAgentRunId !== scope.operationId ||
      job.sourceKind !== "commander_turn" || job.sourceIdentity !== scope.operationId ||
      job.executorPrincipalKind !== "sandbox" || job.executorPrincipalId !== scope.operationId) return false;
    const authority = await loadCommanderJobAuthority(tx, scope);
    return !!authority && authority.executionOwner === "distributed" && authority.distributedJobId === scope.jobId &&
      authority.distributedAttemptId === scope.attemptId;
  });
}
export function createCommanderExistingTurnReader(db: Db) {
  return async (input: CommanderDistributedInput & { stagedFiles: SandboxStagedFile[] }) => {
    let [run] = await db.select().from(internalAgentRuns).where(and(eq(internalAgentRuns.id, input.turnId),
      eq(internalAgentRuns.companyId, input.companyId), eq(internalAgentRuns.userId, input.userId))).limit(1);
    if (run?.executionOwner !== "distributed") {
      const [message] = await db.select({ runId: internalAgentMessages.runId }).from(internalAgentMessages)
        .innerJoin(internalAgentConversations, eq(internalAgentConversations.id, internalAgentMessages.conversationId))
        .where(and(eq(internalAgentMessages.id, input.messageId), eq(internalAgentMessages.role, "user"),
          eq(internalAgentConversations.id, input.conversationId), eq(internalAgentConversations.companyId, input.companyId),
          eq(internalAgentConversations.userId, input.userId))).limit(1);
      if (message?.runId) [run] = await db.select().from(internalAgentRuns).where(and(eq(internalAgentRuns.id, message.runId),
        eq(internalAgentRuns.companyId, input.companyId), eq(internalAgentRuns.userId, input.userId))).limit(1);
    }
    if (run?.executionOwner !== "distributed") return null;
    if (!run.distributedJobId || !run.distributedAttemptId || run.conversationMessageId !== input.messageId || run.model !== input.model) {
      throw new Error("Existing Commander turn identity mismatch");
    }
    const [company] = await db.select({ organizationId: companies.organizationId }).from(companies).where(eq(companies.id, input.companyId)).limit(1);
    if (!company?.organizationId) throw new Error("Existing Commander organization missing");
    const organizationId = company.organizationId;
    return runInTenant(db, organizationId, async (_repos, tx) => {
      const authority = await loadCommanderJobAuthority(tx, { companyId: input.companyId, jobId: run.distributedJobId!, organizationId });
      if (!authority || authority.userId !== input.userId || authority.turnId !== run.id || authority.conversationId !== input.conversationId) {
        throw new Error("Existing Commander source authority mismatch");
      }
      const [attempt] = await tx.select().from(jobAttempts).where(and(eq(jobAttempts.organizationId, organizationId),
        eq(jobAttempts.companyId, input.companyId), eq(jobAttempts.id, run.distributedAttemptId!), eq(jobAttempts.jobId, run.distributedJobId!))).limit(1);
      if (!attempt) throw new Error("Existing Commander attempt missing");
      const staged = await tx.select().from(jobArtifacts).where(and(eq(jobArtifacts.organizationId, organizationId),
        eq(jobArtifacts.jobId, run.distributedJobId!), eq(jobArtifacts.attempt, attempt.attemptNumber),
        eq(jobArtifacts.kind, "staged_input"), eq(jobArtifacts.status, "committed"), isNull(jobArtifacts.leaseId), isNull(jobArtifacts.fenceToken)));
      const expectedFiles = run.id === input.turnId ? input.stagedFiles : buildCommanderDistributedInvocation({ ...input, turnId: run.id })?.stagedFiles;
      if (!expectedFiles || expectedFiles.some((file) => !staged.some((row) => row.contentType === stagedPathMarker(file.path) &&
        row.sizeBytes === file.bytes.byteLength && row.sha256 === createHash("sha256").update(file.bytes).digest("hex")))) {
        throw new Error("Existing Commander staged input mismatch");
      }
      return { organizationId, jobId: run.distributedJobId!, attemptId: run.distributedAttemptId!, operationId: run.id };
    });
  };
}
/** Persist the actual user message and selected model before a worker can redeem the turn. */
export function createCommanderSourcePreparer(db: Db) {
  return async (input: CommanderDistributedInput & { provider: "openai" | "anthropic" }) => {
    if (!input.model || !isKnownRateModel(input.model)) throw new Error("Commander model has no known cost rate");
    return db.transaction(async (tx) => {
    const [row] = await tx.select({ run: internalAgentRuns }).from(internalAgentRuns)
      .innerJoin(companyMemberships, and(eq(companyMemberships.companyId, internalAgentRuns.companyId),
        eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, input.userId), eq(companyMemberships.status, "active")))
      .where(and(eq(internalAgentRuns.id, input.turnId), eq(internalAgentRuns.companyId, input.companyId),
        eq(internalAgentRuns.userId, input.userId), eq(internalAgentRuns.triggerType, "conversation"),
        eq(internalAgentRuns.status, "running"), isNull(internalAgentRuns.distributedJobId))).for("update");
    if (!row) return false;
    const [message] = await tx.select({ id: internalAgentMessages.id, runId: internalAgentMessages.runId }).from(internalAgentMessages)
      .innerJoin(internalAgentConversations, eq(internalAgentConversations.id, internalAgentMessages.conversationId))
      .where(and(eq(internalAgentMessages.id, input.messageId), eq(internalAgentMessages.role, "user"),
        eq(internalAgentConversations.id, input.conversationId), eq(internalAgentConversations.companyId, input.companyId),
        eq(internalAgentConversations.userId, input.userId))).for("update");
    if (!message) return false;
    if (message.runId && message.runId !== input.turnId) {
      const [previous] = await tx.select().from(internalAgentRuns).where(and(eq(internalAgentRuns.id, message.runId),
        eq(internalAgentRuns.companyId, input.companyId), eq(internalAgentRuns.userId, input.userId))).limit(1);
      if (!previous || !["failed", "cancelled"].includes(previous.status)) return false;
      if (previous.distributedJobId) return false;
    }
    await tx.update(internalAgentMessages).set({ runId: input.turnId }).where(eq(internalAgentMessages.id, message.id));
    await tx.update(internalAgentRuns).set({ provider: input.provider, model: input.model ?? null, conversationMessageId: message.id })
      .where(and(eq(internalAgentRuns.id, input.turnId), eq(internalAgentRuns.companyId, input.companyId)));
    return true;
    });
  };
}

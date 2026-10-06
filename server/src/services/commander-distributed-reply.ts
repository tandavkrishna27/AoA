import { and, eq, sql } from "drizzle-orm";
import { internalAgentConversations, internalAgentMessages, internalAgentRuns, jobAttempts, type Db } from "@armyofagents/db";
import type { AgentStreamChunk } from "./internal-agent/agent-loop.js";
import type { OneShotResultScope } from "./one-shot-distributed-result.js";
import { loadCommanderJobAuthority } from "./commander-job-authority.js";
import { collectChunkRefs, mergeOutputRefs } from "./internal-agent/output-refs.js";
import type { ShowRef } from "@armyofagents/shared";
import { runInTenant } from "../db/tenant-context.js";
import { insertActivityLog } from "./activity-log.js";

/** Called only with chunks parsed from the accepted, integrity-checked result.
 * Serializing on the originating user row makes HTTP delivery and restart recovery
 * converge on one reply, one conversation count and one completion audit. */
export async function persistCommanderDistributedReply(db: Db, input: OneShotResultScope & {
  userId: string; conversationId: string; messageId: string; chunks: AgentStreamChunk[];
}): Promise<void> {
  const done = input.chunks.findLast((chunk) => chunk.type === "done");
  if (done?.type !== "done" || done.summary.runId !== input.operationId) throw new Error("Commander reply terminal authority mismatch");
  let content = ""; let reasoning = ""; const refs: ShowRef[] = []; const tools: unknown[] = [];
  for (const chunk of input.chunks) {
    if (chunk.type === "error") throw new Error(chunk.message);
    if (chunk.type === "text") content += chunk.delta;
    if (chunk.type === "reasoning") reasoning = (reasoning + chunk.delta).slice(0, 16000);
    if (chunk.type === "tool_call") tools.push({ id: chunk.id, name: chunk.name, input: chunk.input });
    if (chunk.type === "tool_result") tools.push({ id: chunk.id, name: chunk.name, result: chunk.result });
    collectChunkRefs(refs, chunk);
  }
  if (!content.trim() && !reasoning.trim() && !tools.length) throw new Error("Commander produced no durable reply");
  await runInTenant(db, input.organizationId, async (_repos, tx) => {
    const authority = await loadCommanderJobAuthority(tx, input);
    if (!authority || authority.turnId !== input.operationId || authority.userId !== input.userId ||
      authority.conversationId !== input.conversationId || authority.executionOwner !== "distributed" ||
      authority.distributedJobId !== input.jobId || authority.distributedAttemptId !== input.attemptId) {
      throw new Error("Commander reply source authority mismatch");
    }
    const [user] = await tx.select().from(internalAgentMessages).where(and(
      eq(internalAgentMessages.id, input.messageId), eq(internalAgentMessages.conversationId, input.conversationId),
      eq(internalAgentMessages.role, "user"), eq(internalAgentMessages.runId, input.operationId))).for("update");
    if (!user) throw new Error("Commander reply message authority mismatch");
    const [existing] = await tx.select().from(internalAgentMessages).where(and(
      eq(internalAgentMessages.conversationId, input.conversationId), eq(internalAgentMessages.role, "assistant"),
      eq(internalAgentMessages.replyToUserMessageId, input.messageId))).limit(1);
    if (existing && existing.runId !== input.operationId) throw new Error("Commander reply belongs to another turn");
    if (!existing) {
      await tx.insert(internalAgentMessages).values({ conversationId: input.conversationId, role: "assistant", content,
        reasoning: reasoning || null, toolCalls: tools.length ? tools : null, outputRefs: mergeOutputRefs([], refs),
        runId: input.operationId, replyToUserMessageId: input.messageId });
      await tx.update(internalAgentConversations).set({ messageCount: sql`${internalAgentConversations.messageCount} + 1`, updatedAt: new Date() })
        .where(and(eq(internalAgentConversations.id, input.conversationId), eq(internalAgentConversations.companyId, input.companyId),
          eq(internalAgentConversations.userId, input.userId)));
      await insertActivityLog(tx as unknown as Db, { companyId: input.companyId, actorType: "user", actorId: input.userId,
        action: "commander.execution.completed", entityType: "internal_agent_run", entityId: input.operationId,
        details: { jobId: input.jobId, attemptId: input.attemptId, recoveredReply: true } });
    }
    await tx.update(internalAgentRuns).set({ status: "completed", errorMessage: null, completedAt: new Date(),
      toolsCalled: done.summary.toolsCalled, durationMs: done.summary.durationMs, tokenUsage: done.summary.tokenUsage,
      costCents: done.summary.costCents, model: done.summary.model, provider: done.summary.provider })
      .where(and(eq(internalAgentRuns.id, input.operationId), eq(internalAgentRuns.companyId, input.companyId),
        eq(internalAgentRuns.userId, input.userId), eq(internalAgentRuns.distributedJobId, input.jobId),
        eq(internalAgentRuns.distributedAttemptId, input.attemptId)));
    await tx.update(internalAgentMessages).set({ turnStatus: "done", turnClaimedAt: null, turnClaimToken: null })
      .where(eq(internalAgentMessages.id, user.id));
  });
}

/** A failed accepted attempt cannot be replaced by an HTTP retry. */
export async function persistCommanderDistributedFailure(db: Db, input: OneShotResultScope & {
  userId: string; conversationId: string; messageId: string;
}): Promise<void> {
  await runInTenant(db, input.organizationId, async (_repos, tx) => {
    const authority = await loadCommanderJobAuthority(tx, input);
    if (!authority || authority.userId !== input.userId || authority.turnId !== input.operationId ||
      authority.conversationId !== input.conversationId || authority.distributedJobId !== input.jobId ||
      authority.distributedAttemptId !== input.attemptId) throw new Error("Commander failure authority mismatch");
    const [attempt] = await tx.select({ status: jobAttempts.status }).from(jobAttempts).where(and(
      eq(jobAttempts.organizationId, input.organizationId), eq(jobAttempts.companyId, input.companyId),
      eq(jobAttempts.id, input.attemptId), eq(jobAttempts.jobId, input.jobId))).limit(1);
    if (!attempt || !["failed", "cancelled", "canceled", "expired"].includes(attempt.status)) return;
    const status = ["cancelled", "canceled"].includes(attempt.status) ? "cancelled" : "failed";
    const [updated] = await tx.update(internalAgentRuns).set({ status, completedAt: new Date(),
      errorMessage: "Distributed Commander attempt did not produce an accepted reply" }).where(and(
        eq(internalAgentRuns.id, input.operationId), eq(internalAgentRuns.companyId, input.companyId),
        eq(internalAgentRuns.userId, input.userId), eq(internalAgentRuns.status, "running"),
        eq(internalAgentRuns.distributedJobId, input.jobId), eq(internalAgentRuns.distributedAttemptId, input.attemptId))).returning({ id: internalAgentRuns.id });
    if (!updated) return;
    await tx.update(internalAgentMessages).set({ turnStatus: "failed", turnClaimToken: null, turnClaimedAt: null }).where(and(
      eq(internalAgentMessages.id, input.messageId), eq(internalAgentMessages.conversationId, input.conversationId),
      eq(internalAgentMessages.role, "user"), eq(internalAgentMessages.runId, input.operationId)));
    await insertActivityLog(tx as unknown as Db, { companyId: input.companyId, actorType: "user", actorId: input.userId,
      action: "commander.execution.failed", entityType: "internal_agent_run", entityId: input.operationId,
      details: { jobId: input.jobId, attemptId: input.attemptId, status } });
  });
}

import { and, eq, isNull } from "drizzle-orm";
import { internalAgentRuns, internalAgentMessages, internalAgentConversations, type Db } from "@armyofagents/db";
import { insertActivityLog } from "./activity-log.js";
/** Keep the original paid turn as the run authority when a network retry rejoins it. */
export async function rejoinCommanderRun(db: Db, input: {
  companyId: string; userId: string; originalRunId: string; placeholderRunId: string; conversationId?: string | null;
}): Promise<string> {
  if (input.originalRunId === input.placeholderRunId) return input.originalRunId;
  return db.transaction(async (tx) => {
    const [owned] = await tx.select({ id: internalAgentRuns.id }).from(internalAgentRuns)
      .innerJoin(internalAgentMessages, eq(internalAgentMessages.id, internalAgentRuns.conversationMessageId))
      .innerJoin(internalAgentConversations, eq(internalAgentConversations.id, internalAgentMessages.conversationId))
      .where(and(eq(internalAgentRuns.id, input.originalRunId), eq(internalAgentRuns.companyId, input.companyId),
        eq(internalAgentRuns.userId, input.userId), eq(internalAgentRuns.executionOwner, "distributed"),
        eq(internalAgentMessages.runId, input.originalRunId), eq(internalAgentMessages.role, "user"),
        eq(internalAgentConversations.companyId, input.companyId), eq(internalAgentConversations.userId, input.userId),
        ...(input.conversationId ? [eq(internalAgentConversations.id, input.conversationId)] : []))).limit(1);
    if (!owned) throw new Error("Commander replay source mismatch");
    const removed = await tx.delete(internalAgentRuns).where(and(eq(internalAgentRuns.id, input.placeholderRunId),
      eq(internalAgentRuns.companyId, input.companyId), eq(internalAgentRuns.userId, input.userId),
      eq(internalAgentRuns.status, "running"), isNull(internalAgentRuns.distributedJobId))).returning({ id: internalAgentRuns.id });
    if (removed.length !== 1) throw new Error("Commander replay placeholder mismatch");
    await insertActivityLog(tx as unknown as Db, { companyId: input.companyId, actorType: "user", actorId: input.userId,
      action: "commander.execution.rejoined", entityType: "internal_agent_run", entityId: owned.id,
      details: { placeholderRunId: input.placeholderRunId } });
    return owned.id;
  });
}

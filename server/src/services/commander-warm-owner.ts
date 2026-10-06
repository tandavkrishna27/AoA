import { and, eq, isNotNull, inArray, or, sql } from "drizzle-orm";
import { internalAgentRuns, internalAgentConversations, environmentLeases, type Db } from "@armyofagents/db";

/** Private ownership remains sticky through quarantine/retirement and rollback.
 * Only authenticated cleanup after capability expiry clears this marker. */
export async function hasCommanderWarmOwner(db: Db, input: {
  companyId: string; userId: string; conversationId: string;
}): Promise<boolean> {
  const rows = await db.select({ id: internalAgentRuns.id }).from(internalAgentRuns).where(and(
    eq(internalAgentRuns.companyId, input.companyId), eq(internalAgentRuns.userId, input.userId),
    eq(internalAgentRuns.distributedWarmConversationId, input.conversationId),
    isNotNull(internalAgentRuns.distributedWarmState),
  )).limit(1);
  return rows.length !== 0;
}

/** An existing legacy warm snapshot stays with its legacy owner. Missing
 * provider IDs and failed/pending teardown never certify physical absence. */
export async function hasLegacyCommanderWarmOwner(db: Db, input: {
  companyId: string; userId: string; conversationId: string;
}): Promise<boolean> {
  const rows = await db.select({ id: environmentLeases.id }).from(environmentLeases)
    .innerJoin(internalAgentConversations, and(eq(internalAgentConversations.id, environmentLeases.commanderConversationId),
      eq(internalAgentConversations.companyId, environmentLeases.companyId)))
    .where(and(eq(environmentLeases.companyId, input.companyId), eq(environmentLeases.commanderConversationId, input.conversationId),
      eq(internalAgentConversations.userId, input.userId),
      or(inArray(environmentLeases.status, ['active', 'paused']), and(isNotNull(environmentLeases.providerLeaseId),
        sql`COALESCE(${environmentLeases.cleanupStatus}, '') <> 'success'`)),
    )).limit(1);
  return rows.length !== 0;
}

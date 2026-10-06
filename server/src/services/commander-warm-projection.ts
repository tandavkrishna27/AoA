import { and, desc, eq, sql } from "drizzle-orm";
import { internalAgentRuns, jobEvents, leases, type Db } from "@armyofagents/db";
import { logPayloadV1Schema } from "@armyofagents/worker-protocol";
import { runInTenant } from "../db/tenant-context.js";
import { loadCommanderJobRetirementAuthority } from "./commander-job-authority.js";
import { insertActivityLog } from "./activity-log.js";
import { COMMANDER_WARM_CHECKPOINT_PREFIX, COMMANDER_WARM_IDLE_MS, commanderWarmCheckpointSchema,
  commanderWarmStateSchema, loadAcceptedCommanderWarmCheckpoint, type CommanderWarmState } from "./commander-warm-store.js";
export interface CommanderWarmProjectionScope { organizationId: string; companyId: string; jobId: string; attemptId: string }
/** Called only after event commit, or from restart convergence. Reads accepted
 * ledger rows; never dispatches a provider operation or changes that append. */
export async function projectCommanderWarmCheckpoint(appDb: Db, scope: CommanderWarmProjectionScope): Promise<"ignored" | "paused" | "quarantined"> {
  return runInTenant(appDb, scope.organizationId, async (repos, tx) => {
    await tx.execute(sql`select set_config('lock_timeout', '5000ms', true), set_config('statement_timeout', '10000ms', true)`);
    const source = await loadCommanderJobRetirementAuthority(tx, scope);
    if (!source || source.executionOwner !== "distributed" || source.distributedJobId !== scope.jobId ||
        source.distributedAttemptId !== scope.attemptId) return "ignored";
    const [run] = await tx.select().from(internalAgentRuns).where(and(eq(internalAgentRuns.id, source.turnId),
      eq(internalAgentRuns.companyId, scope.companyId), eq(internalAgentRuns.userId, source.userId))).for("update");
    const parsed = commanderWarmStateSchema.safeParse(run?.distributedWarmState);
    if (!parsed.success || run.distributedWarmConversationId !== source.conversationId) return "ignored";
    const old = parsed.data;
    if (old.status !== "claimed" || old.currentJobId !== scope.jobId || old.currentAttemptId !== scope.attemptId ||
        old.organizationId !== scope.organizationId || old.companyId !== scope.companyId ||
        old.userId !== source.userId || old.conversationId !== source.conversationId || !old.currentLeaseId || !old.workerId) return "ignored";
    const [lease] = await tx.select().from(leases).where(and(eq(leases.organizationId, scope.organizationId),
      eq(leases.companyId, scope.companyId), eq(leases.jobId, scope.jobId), eq(leases.attemptId, scope.attemptId),
      eq(leases.id, old.currentLeaseId), eq(leases.workerId, old.workerId), eq(leases.targetId, old.targetId),
      eq(leases.targetGeneration, old.targetGeneration))).limit(1);
    if (!lease?.expiresAt || lease.attemptNumber === null || !Number.isSafeInteger(lease.attemptNumber) || lease.attemptNumber < 1) return "ignored";
    const now = await repos.jobControl.currentDatabaseTime();
    const checkpointLabels = { organizationId: scope.organizationId, targetId: old.targetId, workerId: old.workerId,
      jobId: scope.jobId, attempt: lease.attemptNumber, leaseId: lease.id, deviceGeneration: old.targetGeneration };
    const physical = old.resource?.labels ?? checkpointLabels;
    const events = await tx.select().from(jobEvents).where(and(eq(jobEvents.organizationId, scope.organizationId),
      eq(jobEvents.companyId, scope.companyId), eq(jobEvents.jobId, scope.jobId), eq(jobEvents.attemptId, scope.attemptId),
      eq(jobEvents.leaseId, lease.id), eq(jobEvents.fenceToken, lease.fence), eq(jobEvents.eventType, "log")))
      .orderBy(desc(jobEvents.sequence)).limit(32);
    let next: CommanderWarmState | null = null;
    for (const event of events) {
      const log = logPayloadV1Schema.safeParse(event.event.payload);
      if (!log.success || log.data.stream !== "stdout" || !log.data.message.startsWith(COMMANDER_WARM_CHECKPOINT_PREFIX)) continue;
      let data: unknown;
      try { data = JSON.parse(log.data.message.slice(COMMANDER_WARM_CHECKPOINT_PREFIX.length)); } catch { continue; }
      const receipt = commanderWarmCheckpointSchema.safeParse(data);
      if (!receipt.success || receipt.data.sessionId !== old.id || receipt.data.generation !== old.generation ||
          (old.resource && receipt.data.resourceId !== old.resource.id) || Object.keys(physical).some((key) =>
            receipt.data.resourceLabels[key as keyof typeof physical] !== physical[key as keyof typeof physical])) continue;
      const paused: CommanderWarmState = { ...old, status: "paused", currentJobId: null, currentAttemptId: null, currentLeaseId: null,
        expiresAtMs: event.createdAt.getTime() + COMMANDER_WARM_IDLE_MS, resource: { id: receipt.data.resourceId,
          labels: physical, checkpointLabels, checkpointEventId: event.eventId, attemptId: scope.attemptId,
          previousCapabilityExpiresAtMs: lease.expiresAt.getTime(), previousFenceRetired: true } };
      // A success terminal invalidates the online fence immediately. The
      // database reaper later retires its lease; effects still require that
      // retirement AND its original capability deadline via the strict loader.
      const proof = await loadAcceptedCommanderWarmCheckpoint(tx, paused, now.getTime(), {
        requirePreviousCapabilityExpired: false, allowTerminalActiveLease: true });
      if (proof && source.activeMembership && paused.expiresAtMs > now.getTime()) { next = paused; break; }
    }
    if (!next) {
      const [terminal] = await tx.select({ id: jobEvents.id }).from(jobEvents).where(and(
        eq(jobEvents.organizationId, scope.organizationId), eq(jobEvents.companyId, scope.companyId),
        eq(jobEvents.jobId, scope.jobId), eq(jobEvents.attemptId, scope.attemptId), eq(jobEvents.leaseId, lease.id),
        eq(jobEvents.fenceToken, lease.fence), eq(jobEvents.eventType, "terminal"))).limit(1);
      if (!terminal) return "ignored";
      next = { ...old, status: "quarantined" };
    }
    await tx.update(internalAgentRuns).set({ distributedWarmState: next }).where(and(
      eq(internalAgentRuns.id, source.turnId), eq(internalAgentRuns.companyId, scope.companyId), eq(internalAgentRuns.userId, source.userId)));
    await insertActivityLog(tx, { companyId: scope.companyId, actorType: "user", actorId: source.userId,
      action: "commander.warm." + next.status, entityType: "internal_agent_run", entityId: source.turnId,
      details: { sessionId: next.id, generation: next.generation, jobId: scope.jobId, attemptId: scope.attemptId } });
    return next.status === "paused" ? "paused" : "quarantined";
  });
}

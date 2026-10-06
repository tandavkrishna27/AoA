import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { companyMemberships, executionTargets, internalAgentRuns, jobAttempts, leases, type Db } from "@armyofagents/db";
import { z } from "zod";
import { runInTenant } from "../db/tenant-context.js";
import { insertActivityLog } from "./activity-log.js";
import { loadCommanderJobRetirementAuthority } from "./commander-job-authority.js";
import { projectCommanderWarmCheckpoint } from "./commander-warm-projection.js";
import { normalizePlacementRegistryTarget } from "./execution-target-resolver.js";
import { commanderWarmStateSchema, loadAcceptedCommanderWarmCheckpoint } from "./commander-warm-store.js";
export const COMMANDER_WARM_ENABLED_ENV = "AOA_DISTRIBUTED_COMMANDER_WARM_ENABLED";
export const warmPhysicalLabelsSchema = z.object({ organizationId: z.string().uuid(), targetId: z.string().uuid(),
  workerId: z.string().uuid(), jobId: z.string().uuid(), attempt: z.number().int().positive().safe(),
  leaseId: z.string().uuid(), deviceGeneration: z.number().int().positive().safe() }).strict();
export const warmResourceTruthSchema = z.object({ resourceId: z.string().min(1).max(256), physicalLabels: warmPhysicalLabelsSchema }).strict();
export type WarmResourceTruthInput = z.infer<typeof warmResourceTruthSchema>;
const sameLabels = (a: WarmResourceTruthInput["physicalLabels"], b: WarmResourceTruthInput["physicalLabels"]) =>
  Object.keys(a).every((key) => a[key as keyof typeof a] === b[key as keyof typeof b]);

/** Separate from the frozen lease oracle: retention protects one physical VM,
 * never every sibling carrying its lease. Retirement is committed before orphan
 * authorization, so a later member re-add or warm claim cannot revive ownership. */
export function createCommanderWarmResourceTruth(options: { appDb: Db; isWarmEnabled(): boolean }) {
  const inspect = async (input: WarmResourceTruthInput, confirm?: { providerOpId: string }) => {
    const labels = input.physicalLabels;
    return runInTenant(options.appDb, labels.organizationId, async (repos, tx) => {
      await tx.execute(sql`select set_config('lock_timeout', '5000ms', true), set_config('statement_timeout', '10000ms', true)`);
      const [physicalLease] = await tx.select().from(leases).where(and(eq(leases.id, labels.leaseId),
        eq(leases.organizationId, labels.organizationId), eq(leases.jobId, labels.jobId), eq(leases.attemptNumber, labels.attempt),
        eq(leases.workerId, labels.workerId), eq(leases.targetId, labels.targetId), eq(leases.targetGeneration, labels.deviceGeneration))).for("update");
      if (!physicalLease?.companyId) return { verdict: "unknown" as const, acknowledged: false };
      const verdict = (await repos.jobControl.classifyLeaseTruth([labels.leaseId])).get(labels.leaseId);
      if (verdict !== "terminal" && verdict !== "superseded") return { verdict: "unknown" as const, acknowledged: false };
      const holders = await tx.select().from(internalAgentRuns).where(and(eq(internalAgentRuns.companyId, physicalLease.companyId),
        isNotNull(internalAgentRuns.distributedWarmState), or(
          sql`${internalAgentRuns.distributedWarmState} -> 'resource' ->> 'id' = ${input.resourceId}`,
          sql`${internalAgentRuns.distributedWarmState} ->> 'currentLeaseId' = ${labels.leaseId}`))).limit(2);
      if (holders.length === 0) return { verdict: "orphan" as const, acknowledged: true };
      if (holders.length !== 1) return { verdict: "unknown" as const, acknowledged: false };
      const snapshot = commanderWarmStateSchema.safeParse(holders[0].distributedWarmState);
      if (!snapshot.success) return { verdict: "unknown" as const, acknowledged: false };
      // Lock the latest lease before the run, preserving issuer's lease -> run order.
      const latestLeaseId = snapshot.data.currentLeaseId ?? snapshot.data.resource?.checkpointLabels?.leaseId ?? snapshot.data.resource?.labels.leaseId;
      const [latestLease] = latestLeaseId ? await tx.select().from(leases).where(and(eq(leases.id, latestLeaseId),
        eq(leases.organizationId, labels.organizationId), eq(leases.companyId, physicalLease.companyId))).for("update") : [];
      const [run] = await tx.select().from(internalAgentRuns).where(eq(internalAgentRuns.id, holders[0].id)).for("update");
      const parsed = commanderWarmStateSchema.safeParse(run?.distributedWarmState);
      if (!parsed.success) return { verdict: "unknown" as const, acknowledged: false };
      const state = parsed.data;
      if (state.id !== snapshot.data.id || state.generation !== snapshot.data.generation || state.currentLeaseId !== snapshot.data.currentLeaseId ||
          state.organizationId !== labels.organizationId || state.companyId !== physicalLease.companyId || state.userId !== run.userId ||
          state.conversationId !== run.distributedWarmConversationId || state.targetId !== labels.targetId ||
          state.targetGeneration !== labels.deviceGeneration || state.workerId !== labels.workerId ||
          (state.resource && (state.resource.id !== input.resourceId || !sameLabels(state.resource.labels, labels)))) {
        return { verdict: "unknown" as const, acknowledged: false };
      }
      const now = await repos.jobControl.currentDatabaseTime();
      const [member] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
        eq(companyMemberships.companyId, state.companyId), eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, state.userId), eq(companyMemberships.status, "active"))).limit(1);
      const [targetRow] = await tx.select({ id: executionTargets.id, slug: executionTargets.slug,
        kind: executionTargets.kind, trustClass: executionTargets.trustClass, status: executionTargets.status,
        organizationId: executionTargets.organizationId, ownerUserId: executionTargets.ownerUserId,
        scope: executionTargets.scope, targetAuthorityKey: executionTargets.targetAuthorityKey,
        deviceGeneration: executionTargets.deviceGeneration, registeredProfile: executionTargets.registeredProfile,
        registeredProfileHash: executionTargets.registeredProfileHash, providerConstraintProfile: executionTargets.providerConstraintProfile,
        lastSeenAt: executionTargets.lastSeenAt })
        .from(executionTargets).where(eq(executionTargets.id, state.targetId)).limit(1);
      const target = targetRow ? await normalizePlacementRegistryTarget(targetRow) : null;
      let retained = options.isWarmEnabled() && !!member && target?.status === "active" && target.targetGeneration === state.targetGeneration &&
        state.expiresAtMs > now.getTime() && (state.status === "paused" || state.status === "claimed") && !!state.resource;
      if (retained) {
        const proof = await loadAcceptedCommanderWarmCheckpoint(tx, state, now.getTime(), {
          requirePreviousCapabilityExpired: state.status === "claimed", allowTerminalActiveLease: state.status === "paused" });
        const [attempt] = state.resource ? await tx.select({ profileHash: jobAttempts.placementProfileHash })
          .from(jobAttempts).where(and(eq(jobAttempts.id, state.resource.attemptId), eq(jobAttempts.companyId, state.companyId))).limit(1) : [];
        const profile = target?.providerConstraintProfile;
        retained = !!proof && !!attempt && !!target?.profileHash && attempt.profileHash === target.profileHash &&
          profile?.checkpointMode === "snapshot" && Array.isArray(profile.supportedOperations) &&
          profile.supportedOperations.includes("checkpoint") && profile.supportedOperations.includes("restore");
        if (retained && state.status === "claimed") {
          const source = state.currentJobId ? await loadCommanderJobRetirementAuthority(tx, { organizationId: state.organizationId,
            companyId: state.companyId, jobId: state.currentJobId }) : null;
          const [current] = state.currentAttemptId ? await tx.select({ status: jobAttempts.status }).from(jobAttempts)
            .where(and(eq(jobAttempts.id, state.currentAttemptId), eq(jobAttempts.companyId, state.companyId))).limit(1) : [];
          retained = !!source && source.activeMembership && source.status === "running" && source.turnId === run.id &&
            source.distributedJobId === state.currentJobId && source.distributedAttemptId === state.currentAttemptId &&
            !!current && !["failed", "cancelled", "succeeded"].includes(current.status);
        }
      }
      if (retained && !confirm) return { verdict: "retained" as const, acknowledged: false };
      const next = { ...state, status: "retired" as const, ...(confirm ? { reclaimedResource: {
        id: input.resourceId, labels, providerOpId: confirm.providerOpId, confirmedAtMs: now.getTime() } } : {}) };
      const capabilityDead = !!latestLease?.expiresAt && latestLease.expiresAt.getTime() <= now.getTime();
      const clear = !!confirm && capabilityDead;
      await tx.update(internalAgentRuns).set({ distributedWarmState: clear ? null : next,
        ...(clear ? { distributedWarmConversationId: null } : {}) }).where(eq(internalAgentRuns.id, run.id));
      if (state.status !== "retired" || clear) await insertActivityLog(tx, { companyId: state.companyId, actorType: "user",
        actorId: state.userId, action: clear ? "commander.warm.reclaimed" : "commander.warm.retired",
        entityType: "internal_agent_run", entityId: run.id, details: { sessionId: state.id, generation: state.generation } });
      return { verdict: "orphan" as const, acknowledged: clear };
    });
  };
  const projectPending = async (input: WarmResourceTruthInput) => {
    // Close the terminal-commit/projection gap before deciding resource retention.
    const labels = input.physicalLabels;
    const rows = await runInTenant(options.appDb, labels.organizationId, async (_repos, tx) => {
      const [physical] = await tx.select({ companyId: leases.companyId }).from(leases).where(and(eq(leases.id, labels.leaseId),
        eq(leases.organizationId, labels.organizationId), eq(leases.jobId, labels.jobId), eq(leases.attemptNumber, labels.attempt),
        eq(leases.workerId, labels.workerId), eq(leases.targetId, labels.targetId), eq(leases.targetGeneration, labels.deviceGeneration))).limit(1);
      if (!physical?.companyId) return [];
      return tx.select({
      companyId: internalAgentRuns.companyId, jobId: internalAgentRuns.distributedJobId, attemptId: internalAgentRuns.distributedAttemptId })
      .from(internalAgentRuns).where(and(eq(internalAgentRuns.companyId, physical.companyId), isNotNull(internalAgentRuns.distributedWarmState),
        sql`${internalAgentRuns.distributedWarmState} ->> 'status' = 'claimed'`, or(
          sql`${internalAgentRuns.distributedWarmState} -> 'resource' ->> 'id' = ${input.resourceId}`,
          sql`${internalAgentRuns.distributedWarmState} ->> 'currentLeaseId' = ${labels.leaseId}`))).limit(2);
    });
    for (const row of rows) if (row.jobId && row.attemptId) await projectCommanderWarmCheckpoint(options.appDb, {
      organizationId: labels.organizationId, companyId: row.companyId, jobId: row.jobId, attemptId: row.attemptId });
  };
  return {
    async truth(input: WarmResourceTruthInput) { await projectPending(input); return (await inspect(input)).verdict; },
    async reclaimed(input: WarmResourceTruthInput & { providerOpId: string }) {
      await projectPending(input); return (await inspect(input, { providerOpId: input.providerOpId })).acknowledged;
    },
  };
}

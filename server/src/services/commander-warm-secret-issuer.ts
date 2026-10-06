import type { KeyObject } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { executionTargets, internalAgentRuns, jobs, type Db } from "@armyofagents/db";
import { signWarmResourceCapability, type WarmResourceCapability } from "@armyofagents/provider-capability";
import { runInTenant } from "../db/tenant-context.js";
import { normalizePlacementRegistryTarget } from "./execution-target-resolver.js";
import { loadCommanderJobAuthority } from "./commander-job-authority.js";
import { COMMANDER_WARM_IDLE_MS, COMMANDER_WARM_RUNNER_PATH, commanderWarmStateSchema,
  loadAcceptedCommanderWarmCheckpoint } from "./commander-warm-store.js";
import { createCommanderWarmCanaryVault, mergeCommanderWarmCanaries, type CommanderWarmCanaryVault } from "./commander-warm-canaries.js";
import { mintOwnedLabelsCapability, OWNED_LABELS_CAPABILITY_DEFAULT_TTL_MS } from "./owned-labels-mint.js";
import type { ResolvedFenceContext } from "./worker-fence-context.js";
import type { SecretResolveOutcome } from "./secret-broker.js";

export interface CommanderWarmSecretControl {
  version: 1; sessionId: string; generation: number; mode: "create" | "resume";
  resourceId: string | null; idleTtlMs: number; historicalCanaries: string[];
  warmResourceCapability?: WarmResourceCapability;
}
export function isCommanderWarmWorkload(value: Record<string, unknown>): boolean {
  return value.command === "node" && Array.isArray(value.args) && value.args.length === 4 &&
    value.args[0] === COMMANDER_WARM_RUNNER_PATH && ["claude", "codex"].includes(value.args[1]) &&
    value.args[2] === "/home/user/aoa-commander-input.json" &&
    value.args[3] === "/home/user/aoa-output/aoa-one-shot-result.json";
}
function refuse(): never { throw new Error("Commander warm authority unavailable"); }
/** Runs after device proof verification and value resolution. Rechecks the active
 * fence without consuming that proof twice; the existing tenant transaction locks
 * the actual turn before reseeding its encrypted redaction history and signing.
 * No default rollout or provider effect is introduced by this delivery seam. */
export function createCommanderWarmSecretIssuer(options: {
  appDb: Db; controlPlaneSigningKey?: KeyObject; shortTtlMs?: number; vault?: CommanderWarmCanaryVault;
  isWarmEnabled?: () => boolean;
}) {
  const vault = options.vault ?? createCommanderWarmCanaryVault();
  return async (outcome: SecretResolveOutcome, context: ResolvedFenceContext): Promise<SecretResolveOutcome> => {
    if (outcome.outcome !== "resolved" || outcome.seam !== "sandbox_local_only" || outcome.material.materialization !== "env") return outcome;
    const fence = context.fenceIdentity;
    return runInTenant(options.appDb, fence.organizationId, async (repos, tx) => {
      const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, fence.jobId),
        eq(jobs.organizationId, fence.organizationId), eq(jobs.companyId, context.companyId))).limit(1);
      if (!job || !isCommanderWarmWorkload(job.input)) return outcome;
      if (!options.isWarmEnabled?.() || !options.controlPlaneSigningKey || job.sourceKind !== "commander_turn") return refuse();
      let active = await repos.jobControl.lockActiveFence(fence);
      const source = await loadCommanderJobAuthority(tx, { organizationId: fence.organizationId,
        companyId: context.companyId, jobId: fence.jobId });
      if (!source || source.status !== "running" || source.executionOwner !== "distributed" ||
          source.distributedJobId !== fence.jobId || source.distributedAttemptId !== active.attempt.id) return refuse();
      const [run] = await tx.select().from(internalAgentRuns).where(and(eq(internalAgentRuns.id, source.turnId),
        eq(internalAgentRuns.companyId, context.companyId), eq(internalAgentRuns.userId, source.userId))).for("update");
      const parsed = commanderWarmStateSchema.safeParse(run?.distributedWarmState);
      if (!parsed.success || run.distributedWarmConversationId !== source.conversationId) return refuse();
      const state = parsed.data;
      let now = await repos.jobControl.currentDatabaseTime();
      if (state.status !== "claimed" || state.organizationId !== fence.organizationId || state.companyId !== context.companyId ||
          state.userId !== source.userId || state.conversationId !== source.conversationId ||
          state.currentJobId !== fence.jobId || state.currentAttemptId !== active.attempt.id ||
          state.targetId !== fence.targetId || state.targetGeneration !== fence.targetGeneration || state.expiresAtMs <= now.getTime() ||
          (state.workerId !== null && state.workerId !== fence.workerId) ||
          (state.currentLeaseId !== null && state.currentLeaseId !== fence.leaseId)) return refuse();
      const [targetRow] = await tx.select({ id: executionTargets.id, slug: executionTargets.slug,
        kind: executionTargets.kind, trustClass: executionTargets.trustClass, status: executionTargets.status,
        organizationId: executionTargets.organizationId, ownerUserId: executionTargets.ownerUserId,
        scope: executionTargets.scope, targetAuthorityKey: executionTargets.targetAuthorityKey,
        deviceGeneration: executionTargets.deviceGeneration, registeredProfile: executionTargets.registeredProfile,
        registeredProfileHash: executionTargets.registeredProfileHash, providerConstraintProfile: executionTargets.providerConstraintProfile,
        lastSeenAt: executionTargets.lastSeenAt }).from(executionTargets).where(eq(executionTargets.id, fence.targetId)).limit(1);
      const target = targetRow ? await normalizePlacementRegistryTarget(targetRow) : null;
      const provider = target?.providerConstraintProfile;
      if (!target || target.status !== "active" || target.targetGeneration !== fence.targetGeneration ||
          target.profileHash !== active.attempt.placementProfileHash || target.providerConstraintHash !== fence.providerConstraintHash ||
          provider?.checkpointMode !== "snapshot" || !provider.supportedOperations.includes("checkpoint") ||
          !provider.supportedOperations.includes("restore") || provider.maxIdleSeconds * 1000 < COMMANDER_WARM_IDLE_MS) return refuse();
      if (state.generation === 1 ? state.resource !== null : state.resource === null) return refuse();
      const proof = state.resource ? await loadAcceptedCommanderWarmCheckpoint(tx, state, now.getTime()) : null;
      if (state.resource && !proof) return refuse();
      const historicalCanaries = state.redactionBeforeTurn ? await vault.open(state, state.redactionBeforeTurn) : [];
      const currentCanaries = state.redaction ? await vault.open(state, state.redaction) : [];
      const redaction = await vault.seal(state, mergeCommanderWarmCanaries(currentCanaries, historicalCanaries, [outcome.material.value]));
      // Encryption/profile checks can await I/O. Use a fresh database clock and
      // fence after them, so a late resolve never signs past lease expiration.
      if (!options.isWarmEnabled?.()) return refuse();
      active = await repos.jobControl.lockActiveFence(fence);
      now = await repos.jobControl.currentDatabaseTime();
      const freshSource = await loadCommanderJobAuthority(tx, { organizationId: fence.organizationId,
        companyId: context.companyId, jobId: fence.jobId });
      if (!freshSource || freshSource.status !== "running" || freshSource.executionOwner !== "distributed" ||
          freshSource.distributedJobId !== fence.jobId || freshSource.distributedAttemptId !== active.attempt.id ||
          !active.lease.expiresAt || state.expiresAtMs <= now.getTime()) return refuse();
      const primary = mintOwnedLabelsCapability({ fenceIdentity: fence, authorityNow: now,
        leaseDeadline: active.lease.expiresAt }, options.controlPlaneSigningKey,
        options.shortTtlMs ?? OWNED_LABELS_CAPABILITY_DEFAULT_TTL_MS);
      const expiresAt = Math.min(primary.expiresAt, state.expiresAtMs);
      if (expiresAt <= now.getTime()) return refuse();
      const warmControl: CommanderWarmSecretControl = { version: 1, sessionId: state.id, generation: state.generation,
        mode: state.resource ? "resume" : "create", resourceId: state.resource?.id ?? null,
        idleTtlMs: COMMANDER_WARM_IDLE_MS, historicalCanaries,
        ...(state.resource && proof ? { warmResourceCapability: signWarmResourceCapability({ v: 1,
          audience: "adapter-manager-warm-resource", sessionId: state.id, generation: state.generation,
          resourceId: state.resource.id, physicalLabels: state.resource.labels, ownedLabels: primary.ownedLabels,
          previousCapabilityExpiresAt: proof.previousCapabilityExpiresAtMs, issuedAt: now.getTime(), expiresAt },
          options.controlPlaneSigningKey) } : {}) };
      await tx.update(internalAgentRuns).set({ distributedWarmState: { ...state, workerId: fence.workerId,
        currentLeaseId: fence.leaseId, redaction } }).where(and(eq(internalAgentRuns.id, source.turnId),
          eq(internalAgentRuns.companyId, context.companyId), eq(internalAgentRuns.userId, source.userId)));
      return { ...outcome, ownedLabelsCapability: primary, warmControl };
    });
  };
}

import { randomUUID } from "node:crypto";
import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { internalAgentRuns, jobAttempts, jobEvents, leases, companyMemberships, type Db } from "@armyofagents/db";
import { z } from "zod";
import { logPayloadV1Schema, terminalEventPayloadV1Schema } from "@armyofagents/worker-protocol";
import { loadCommanderJobAuthority } from "./commander-job-authority.js";
import { insertActivityLog } from "./activity-log.js";
import { decideCommanderWarmClaim } from "./commander-warm-authority.js";
import { commanderWarmCanaryMaterialSchema } from "./commander-warm-canaries.js";

export const COMMANDER_WARM_RUNNER_PATH = "/home/user/aoa-commander-warm-v1.cjs";
export const COMMANDER_WARM_IDLE_MS = 30 * 60_000;
const labels = z.object({ organizationId: z.string().uuid(), targetId: z.string().uuid(), workerId: z.string().uuid(),
  jobId: z.string().uuid(), attempt: z.number().int().positive(), leaseId: z.string().uuid(), deviceGeneration: z.number().int().positive() }).strict();
const resource = z.object({ id: z.string().min(1).max(256), labels, checkpointLabels: labels.optional(), checkpointEventId: z.string().uuid(),
  attemptId: z.string().uuid(), previousCapabilityExpiresAtMs: z.number().int().safe(),
  previousFenceRetired: z.literal(true) }).strict();
export const commanderWarmStateSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), generation: z.number().int().positive().safe(),
  organizationId: z.string().uuid(), companyId: z.string().uuid(), conversationId: z.string().uuid(), userId: z.string().min(1),
  targetId: z.string().uuid(), targetGeneration: z.number().int().positive(), workerId: z.string().uuid().nullable(),
  status: z.enum(["claimed", "paused", "quarantined", "retired"]), expiresAtMs: z.number().int().safe(),
  resource: resource.nullable(), currentJobId: z.string().uuid().nullable(), currentAttemptId: z.string().uuid().nullable(),
  currentLeaseId: z.string().uuid().nullable(),
  redaction: commanderWarmCanaryMaterialSchema.optional(),
  redactionBeforeTurn: commanderWarmCanaryMaterialSchema.optional(),
}).strict();
export type CommanderWarmState = z.infer<typeof commanderWarmStateSchema>;
export const COMMANDER_WARM_CHECKPOINT_PREFIX = "aoa-commander-checkpoint-v1:";
export const commanderWarmCheckpointSchema = z.object({ version: z.literal(1), sessionId: z.string().uuid(),
  generation: z.number().int().positive().safe(), resourceId: z.string().min(1).max(256),
  checkpointRef: z.string().min(1).max(512), resourceLabels: labels }).strict();
/** Accepted log + later success terminal + exact retired database lease. A
 * mutable warm marker alone is never evidence of a checkpoint or fence expiry. */
export async function loadAcceptedCommanderWarmCheckpoint(tx: Db, state: CommanderWarmState, nowMs: number, options: { requirePreviousCapabilityExpired?: boolean; allowTerminalActiveLease?: boolean } = {}) {
  if (!state.resource || !Number.isFinite(nowMs)) return null;
  const physical = state.resource.labels;
  // Physical labels never change. The accepted checkpoint and prior capability
  // belong to the most recent turn, which has a fresh job/attempt/lease tuple.
  const checkpointOwner = state.resource.checkpointLabels ?? physical;
  if (physical.organizationId !== state.organizationId || physical.targetId !== state.targetId ||
      physical.deviceGeneration !== state.targetGeneration || checkpointOwner.organizationId !== state.organizationId ||
      checkpointOwner.targetId !== state.targetId || checkpointOwner.deviceGeneration !== state.targetGeneration ||
      checkpointOwner.workerId !== state.workerId) return null;
  const [lease] = await tx.select().from(leases).where(and(eq(leases.id, checkpointOwner.leaseId),
    eq(leases.organizationId, state.organizationId), eq(leases.companyId, state.companyId), eq(leases.jobId, checkpointOwner.jobId),
    eq(leases.attemptId, state.resource.attemptId), eq(leases.attemptNumber, checkpointOwner.attempt),
    eq(leases.workerId, checkpointOwner.workerId), eq(leases.targetId, checkpointOwner.targetId), eq(leases.targetGeneration, checkpointOwner.deviceGeneration))).limit(1);
  if (!lease || (!['released', 'expired', 'revoked'].includes(lease.status) &&
      !(options.allowTerminalActiveLease === true && lease.status === 'active')) || !lease.expiresAt) return null;
  const previousCapabilityExpiresAtMs = lease.expiresAt.getTime();
  if (!Number.isFinite(previousCapabilityExpiresAtMs) || state.resource.previousCapabilityExpiresAtMs !== previousCapabilityExpiresAtMs) return null;
  const [attempt] = await tx.select({ status: jobAttempts.status }).from(jobAttempts).where(and(
    eq(jobAttempts.id, state.resource.attemptId), eq(jobAttempts.organizationId, state.organizationId),
    eq(jobAttempts.companyId, state.companyId), eq(jobAttempts.jobId, checkpointOwner.jobId), eq(jobAttempts.attemptNumber, checkpointOwner.attempt))).limit(1);
  if (attempt?.status !== "succeeded") return null;
  const scope = [eq(jobEvents.organizationId, state.organizationId), eq(jobEvents.companyId, state.companyId),
    eq(jobEvents.jobId, checkpointOwner.jobId), eq(jobEvents.attemptId, state.resource.attemptId), eq(jobEvents.attemptNumber, checkpointOwner.attempt),
    eq(jobEvents.leaseId, checkpointOwner.leaseId), eq(jobEvents.fenceToken, lease.fence)];
  const [checkpoint] = await tx.select().from(jobEvents).where(and(...scope,
    eq(jobEvents.eventId, state.resource.checkpointEventId), eq(jobEvents.eventType, "log"))).limit(1);
  if (!checkpoint) return null;
  const log = logPayloadV1Schema.safeParse(checkpoint.event.payload);
  if (!log.success || log.data.stream !== "stdout" || !log.data.message.startsWith(COMMANDER_WARM_CHECKPOINT_PREFIX)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(log.data.message.slice(COMMANDER_WARM_CHECKPOINT_PREFIX.length)); } catch { return null; }
  const receipt = commanderWarmCheckpointSchema.safeParse(parsed);
  const expectedGeneration = state.status === "paused" ? state.generation : state.generation - 1;
  if (!receipt.success || receipt.data.sessionId !== state.id || receipt.data.generation !== expectedGeneration ||
      receipt.data.resourceId !== state.resource.id || Object.keys(physical).some((key) =>
        receipt.data.resourceLabels[key as keyof typeof physical] !== physical[key as keyof typeof physical])) return null;
  const [terminal] = await tx.select().from(jobEvents).where(and(...scope, eq(jobEvents.eventType, "terminal"),
    gt(jobEvents.sequence, checkpoint.sequence))).limit(1);
  const verdict = terminalEventPayloadV1Schema.safeParse(terminal?.event.payload);
  if (!verdict.success || verdict.data.status !== "succeeded") return null;
  if (options.requirePreviousCapabilityExpired !== false && previousCapabilityExpiresAtMs > nowMs) throw new CommanderWarmClaimError("previous_capability_live");
  return { lease, receipt: receipt.data, checkpoint, previousCapabilityExpiresAtMs };
}

export class CommanderWarmClaimError extends Error {
  constructor(readonly reason: string) { super(`Commander warm claim refused: ${reason}`); this.name = "CommanderWarmClaimError"; }
}

/** Placement's existing tenant transaction owns this call. The column is moved
 * between actual turns, never a sentinel run. The advisory lock serializes first
 * claims as well as successor claims; the partial unique index is the backstop.
 * Target operation support must come from the verified placement profile. */
export async function claimCommanderWarmTurn(tx: Db, input: {
  organizationId: string; companyId: string; jobId: string; attemptId: string;
  targetId: string; targetGeneration: number; supportsCheckpointRestore: boolean;
}): Promise<CommanderWarmState> {
  const source = await loadCommanderJobAuthority(tx, input);
  if (!source || source.status !== "running" || source.executionOwner !== "distributed" ||
      source.distributedJobId !== input.jobId || source.distributedAttemptId !== input.attemptId) throw new CommanderWarmClaimError("source_authority");
  if (!input.supportsCheckpointRestore) throw new CommanderWarmClaimError("provider_unsupported");
  const [attempt] = await tx.select().from(jobAttempts).where(and(eq(jobAttempts.id, input.attemptId),
    eq(jobAttempts.organizationId, input.organizationId), eq(jobAttempts.companyId, input.companyId), eq(jobAttempts.jobId, input.jobId))).limit(1);
  if (!attempt || attempt.placementTargetId !== input.targetId || attempt.placementTargetGeneration !== input.targetGeneration ||
      !attempt.placementLeaseEligible) throw new CommanderWarmClaimError("placement_authority");
  await tx.execute(sql`select set_config('lock_timeout', '5000ms', true)`);
  const identity = JSON.stringify([input.organizationId, input.companyId, source.userId, source.conversationId]);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
  // Recheck membership after the conversation lock. Credential redemption
  // independently checks current membership before granting any effect.
  const [member] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
    eq(companyMemberships.companyId, input.companyId), eq(companyMemberships.principalType, "user"),
    eq(companyMemberships.principalId, source.userId), eq(companyMemberships.status, "active"))).limit(1);
  if (!member) throw new CommanderWarmClaimError("owner_inactive");
  const clock = await tx.execute(sql`select clock_timestamp() as now`);
  const nowMs = new Date((clock as unknown as { now: Date }[])[0]?.now).getTime();
  if (!Number.isFinite(nowMs)) throw new CommanderWarmClaimError("database_clock");
  const holders = await tx.select().from(internalAgentRuns).where(and(eq(internalAgentRuns.companyId, input.companyId),
    eq(internalAgentRuns.userId, source.userId), eq(internalAgentRuns.distributedWarmConversationId, source.conversationId), isNotNull(internalAgentRuns.distributedWarmState))).for("update");
  if (holders.length > 1) throw new CommanderWarmClaimError("multiple_owners");
  const holder = holders[0];
  let old: CommanderWarmState | null = null;
  if (holder) {
    const parsed = commanderWarmStateSchema.safeParse(holder.distributedWarmState);
    if (!parsed.success) throw new CommanderWarmClaimError("invalid_durable_state");
    old = parsed.data;
    if (old.organizationId !== input.organizationId || old.companyId !== input.companyId ||
        old.userId !== source.userId || old.conversationId !== source.conversationId) throw new CommanderWarmClaimError("identity_mismatch");
    if (old.targetId !== input.targetId || old.targetGeneration !== input.targetGeneration) throw new CommanderWarmClaimError("identity_mismatch");
    if (holder.id === source.turnId && old.status === "claimed" && old.currentJobId === input.jobId && old.currentAttemptId === input.attemptId) return old;
    if (old.status !== "paused" || !old.resource || !old.workerId) throw new CommanderWarmClaimError("resource_busy");
    if (!await loadAcceptedCommanderWarmCheckpoint(tx, old, nowMs)) throw new CommanderWarmClaimError("checkpoint_unaccepted");
    const decision = decideCommanderWarmClaim({ ...input, userId: source.userId, conversationId: source.conversationId,
      workerId: old.workerId, nowMs, activeMembership: true, supportsCheckpoint: true, supportsRestore: true }, {
      ...old, workerId: old.workerId, resourceId: old.resource.id, resourceLabels: old.resource.labels,
      previousFenceRetired: old.resource.previousFenceRetired,
      previousCapabilityExpiresAtMs: old.resource.previousCapabilityExpiresAtMs, acceptedCheckpoint: true,
    });
    if (decision.action !== "resume") throw new CommanderWarmClaimError(decision.action === "deny" ? decision.reason : "invalid_resume");
    // The issuer reloads the same proof before granting an effect. This
    // transaction reserves the generation and grants no provider effect.
  }
  const state: CommanderWarmState = { version: 1, id: old?.id ?? randomUUID(), generation: old ? old.generation + 1 : 1,
    organizationId: input.organizationId, companyId: input.companyId, conversationId: source.conversationId, userId: source.userId,
    targetId: input.targetId, targetGeneration: input.targetGeneration, workerId: old?.workerId ?? null,
    status: "claimed", expiresAtMs: nowMs + COMMANDER_WARM_IDLE_MS, resource: old?.resource ?? null,
    currentJobId: input.jobId, currentAttemptId: input.attemptId, currentLeaseId: null,
    ...(old?.redaction ? { redaction: old.redaction, redactionBeforeTurn: old.redaction } : {}) };
  commanderWarmStateSchema.parse(state);
  if (holder) await tx.update(internalAgentRuns).set({ distributedWarmState: null }).where(and(
    eq(internalAgentRuns.id, holder.id), eq(internalAgentRuns.companyId, input.companyId), eq(internalAgentRuns.userId, source.userId)));
  const updated = await tx.update(internalAgentRuns).set({ distributedWarmState: state, distributedWarmConversationId: source.conversationId })
    .where(and(eq(internalAgentRuns.id, source.turnId), eq(internalAgentRuns.companyId, input.companyId), eq(internalAgentRuns.userId, source.userId),
      eq(internalAgentRuns.status, "running"))).returning({ id: internalAgentRuns.id });
  if (updated.length !== 1) throw new CommanderWarmClaimError("source_authority");
  await insertActivityLog(tx, { companyId: input.companyId, actorType: "user", actorId: source.userId,
    action: "commander.warm.claimed", entityType: "internal_agent_run", entityId: source.turnId,
    details: { sessionId: state.id, generation: state.generation, conversationId: source.conversationId,
      jobId: input.jobId, attemptId: input.attemptId, mode: old ? "resume" : "create" } });
  return state;
}

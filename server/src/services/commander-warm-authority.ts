/** Physical resource ownership is distinct from the new attempt's effect fence.
 * Only trusted session/checkpoint reads may supply this snapshot. The caller must
 * reserve the selected generation atomically with placement before issuing a cap. */
export interface CommanderWarmClaimInput {
  organizationId: string; companyId: string; conversationId: string; userId: string; jobId: string; attemptId: string;
  targetId: string; workerId: string; targetGeneration: number; nowMs: number;
  activeMembership: boolean; supportsCheckpoint: boolean; supportsRestore: boolean;
}
export interface CommanderWarmResourceLabels {
  organizationId: string; targetId: string; workerId: string; jobId: string; attempt: number; leaseId: string; deviceGeneration: number;
}
export interface CommanderWarmSessionSnapshot {
  organizationId: string; companyId: string; conversationId: string; userId: string;
  status: "paused" | "claimed" | "quarantined" | "retired";
  targetId: string; workerId: string; targetGeneration: number; generation: number; expiresAtMs: number;
  resourceId: string; resourceLabels: CommanderWarmResourceLabels;
  previousFenceRetired: boolean; previousCapabilityExpiresAtMs: number; acceptedCheckpoint: boolean;
  currentJobId: string | null; currentAttemptId: string | null;
}
export type CommanderWarmClaimDecision = { action: "create"; generation: number }
  | { action: "resume"; generation: number; resourceId: string; resourceLabels: CommanderWarmResourceLabels }
  | { action: "deny"; reason: "owner_inactive" | "provider_unsupported" | "identity_mismatch" | "resource_busy" | "resource_expired" | "checkpoint_unaccepted" | "resource_labels_mismatch" | "previous_capability_live" };
export function decideCommanderWarmClaim(input: CommanderWarmClaimInput, session: CommanderWarmSessionSnapshot | null): CommanderWarmClaimDecision {
  if (!input.activeMembership) return { action: "deny", reason: "owner_inactive" };
  if (!input.supportsCheckpoint || !input.supportsRestore) return { action: "deny", reason: "provider_unsupported" };
  if (!Number.isFinite(input.nowMs) || !Number.isSafeInteger(input.targetGeneration) || input.targetGeneration < 1 ||
    [input.organizationId, input.companyId, input.conversationId, input.userId, input.jobId, input.attemptId, input.targetId, input.workerId].some((id) => !id)) {
    return { action: "deny", reason: "identity_mismatch" };
  }
  if (!session) return { action: "create", generation: 1 };
  if (["organizationId", "companyId", "conversationId", "userId", "targetId", "workerId"].some((key) =>
    session[key as keyof CommanderWarmSessionSnapshot] !== input[key as keyof CommanderWarmClaimInput]) || session.targetGeneration !== input.targetGeneration) {
    return { action: "deny", reason: "identity_mismatch" };
  }
  if (session.status !== "paused" || session.currentJobId || session.currentAttemptId) return { action: "deny", reason: "resource_busy" };
  if (!Number.isFinite(input.nowMs) || !Number.isFinite(session.expiresAtMs) || session.expiresAtMs <= input.nowMs) return { action: "deny", reason: "resource_expired" };
  if (!session.previousFenceRetired || !session.acceptedCheckpoint) return { action: "deny", reason: "checkpoint_unaccepted" };
  // A signed capability may remain usable until its original expiry even after
  // the database fence retires. Never overlap it with a successor's resource claim.
  if (!Number.isFinite(session.previousCapabilityExpiresAtMs) || session.previousCapabilityExpiresAtMs > input.nowMs) {
    return { action: "deny", reason: "previous_capability_live" };
  }
  const labels = session.resourceLabels;
  if (!session.resourceId || !labels || labels.organizationId !== input.organizationId || labels.targetId !== input.targetId ||
    labels.workerId !== input.workerId || labels.deviceGeneration !== input.targetGeneration || !labels.jobId || !labels.leaseId ||
    !Number.isSafeInteger(labels.attempt) || labels.attempt < 1 || !Number.isSafeInteger(session.generation) || session.generation < 1 ||
    session.generation >= Number.MAX_SAFE_INTEGER) return { action: "deny", reason: "resource_labels_mismatch" };
  return { action: "resume", generation: session.generation + 1, resourceId: session.resourceId, resourceLabels: { ...labels } };
}

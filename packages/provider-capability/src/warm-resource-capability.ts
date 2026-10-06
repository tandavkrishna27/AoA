import { sign, verify, type KeyObject } from "node:crypto";
import type { ResourceLabels } from "@armyofagents/worker-daemon";

/** Separate grant: primary owned-labels v1 remains unchanged. The control plane
 * must load the accepted checkpoint and atomically reserve its durable generation
 * before signing. previousCapabilityExpiresAt is the prior database lease deadline,
 * never a worker-supplied claim. This primitive does not authorize its own issuer. */
export interface WarmResourceCapabilityFields {
  readonly v: 1;
  readonly audience: "adapter-manager-warm-resource";
  readonly sessionId: string;
  readonly generation: number;
  readonly resourceId: string;
  readonly physicalLabels: ResourceLabels;
  readonly ownedLabels: ResourceLabels;
  readonly previousCapabilityExpiresAt: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
}
export interface WarmResourceCapability extends WarmResourceCapabilityFields { readonly sig: string }
function tuple(labels: ResourceLabels): readonly (string | number)[] {
  return [labels.organizationId, labels.targetId, labels.workerId, labels.jobId, labels.attempt, labels.leaseId, labels.deviceGeneration];
}
export function buildWarmResourceCapabilityCanonical(fields: WarmResourceCapabilityFields): Buffer {
  return Buffer.from(JSON.stringify([fields.v, fields.audience, fields.sessionId, fields.generation, fields.resourceId,
    tuple(fields.physicalLabels), tuple(fields.ownedLabels), fields.previousCapabilityExpiresAt, fields.issuedAt, fields.expiresAt]), "utf8");
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function labels(value: unknown): value is ResourceLabels {
  return record(value) && ["organizationId", "targetId", "workerId", "jobId", "leaseId"].every((key) =>
    typeof value[key] === "string" && value[key].length > 0 && value[key].length <= 256) &&
    Number.isSafeInteger(value.attempt) && (value.attempt as number) > 0 &&
    Number.isSafeInteger(value.deviceGeneration) && (value.deviceGeneration as number) > 0;
}
export function isWarmResourceCapabilityFields(value: unknown): value is WarmResourceCapabilityFields {
  if (!record(value) || value.v !== 1 || value.audience !== "adapter-manager-warm-resource" ||
      typeof value.sessionId !== "string" || !value.sessionId || value.sessionId.length > 256 ||
      typeof value.resourceId !== "string" || !value.resourceId || value.resourceId.length > 256 ||
      !Number.isSafeInteger(value.generation) || (value.generation as number) < 1 ||
      !labels(value.physicalLabels) || !labels(value.ownedLabels) ||
      !Number.isSafeInteger(value.previousCapabilityExpiresAt) || !Number.isSafeInteger(value.issuedAt) ||
      !Number.isSafeInteger(value.expiresAt)) return false;
  const fields = value as unknown as WarmResourceCapabilityFields;
  return fields.previousCapabilityExpiresAt <= fields.issuedAt && fields.issuedAt < fields.expiresAt &&
    fields.physicalLabels.organizationId === fields.ownedLabels.organizationId &&
    fields.physicalLabels.targetId === fields.ownedLabels.targetId &&
    fields.physicalLabels.deviceGeneration === fields.ownedLabels.deviceGeneration;
}
export function signWarmResourceCapability(fields: WarmResourceCapabilityFields, privateKey: KeyObject): WarmResourceCapability {
  if (!isWarmResourceCapabilityFields(fields)) throw new Error("unsafe warm resource capability fields");
  // Copy both label tuples so a caller cannot mutate the signed return value through its input.
  const safe = { ...fields, physicalLabels: { ...fields.physicalLabels }, ownedLabels: { ...fields.ownedLabels } };
  return { ...safe, sig: sign(null, buildWarmResourceCapabilityCanonical(safe), privateKey).toString("base64url") };
}
export function verifyWarmResourceCapability(value: unknown, publicKey: KeyObject, context: {
  nowMs: number; resourceId: string; ownedLabels: ResourceLabels; primaryExpiresAt: number;
}): WarmResourceCapability | null {
  if (!isWarmResourceCapabilityFields(value) || !record(value) || typeof value.sig !== "string" ||
      !/^[A-Za-z0-9_-]{86}$/.test(value.sig) || !Number.isFinite(context.nowMs) || !Number.isSafeInteger(context.primaryExpiresAt) ||
      value.issuedAt > context.nowMs || value.expiresAt <= context.nowMs || value.expiresAt > context.primaryExpiresAt ||
      value.resourceId !== context.resourceId || JSON.stringify(tuple(value.ownedLabels)) !== JSON.stringify(tuple(context.ownedLabels))) return null;
  try {
    return verify(null, buildWarmResourceCapabilityCanonical(value), publicKey, Buffer.from(value.sig, "base64url"))
      ? { ...value, sig: value.sig } : null;
  } catch { return null; }
}

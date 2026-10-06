import type { ResourceLabels } from "../supervisor/provider.js";
import type { OwnedLabelsCapabilityLike } from "./owned-labels-capability.js";

/** Protected resolve metadata, not a change to frozen lease or job v1. The
 * worker validates shape and binding; the adapter manager verifies the grant's
 * signature before every resource effect. Historical values are redaction-only. */
export interface WarmResourceCapabilityLike {
  v: 1; audience: "adapter-manager-warm-resource"; sessionId: string; generation: number;
  resourceId: string; physicalLabels: ResourceLabels; ownedLabels: ResourceLabels;
  previousCapabilityExpiresAt: number; issuedAt: number; expiresAt: number; sig: string;
}
export interface CommanderWarmControl {
  version: 1; sessionId: string; generation: number; mode: "create" | "resume";
  resourceId: string | null; idleTtlMs: 1800000; historicalCanaries: string[];
  warmResourceCapability?: WarmResourceCapabilityLike;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const labelKeys = ["organizationId", "targetId", "workerId", "jobId", "attempt", "leaseId", "deviceGeneration"] as const;
function labels(value: unknown): value is ResourceLabels {
  return record(value) && Object.keys(value).length === 7 && labelKeys.every((key) =>
    key === "attempt" || key === "deviceGeneration" ? positive(value[key]) :
      typeof value[key] === "string" && value[key].length > 0 && value[key].length <= 256);
}
const sameLabels = (a: ResourceLabels, b: ResourceLabels) => labelKeys.every((key) => a[key] === b[key]);

export function readCommanderWarmControl(value: unknown, primary: OwnedLabelsCapabilityLike | undefined): CommanderWarmControl | null {
  if (!record(value) || !primary || primary.v !== 1 || primary.audience !== "adapter-manager" ||
      !Number.isSafeInteger(primary.expiresAt) || !labels(primary.ownedLabels) ||
      value.version !== 1 || typeof value.sessionId !== "string" || !uuid.test(value.sessionId) ||
      !positive(value.generation) || value.idleTtlMs !== 1800000 ||
      !Array.isArray(value.historicalCanaries) || value.historicalCanaries.length > 64 ||
      Object.keys(value).some((key) => !["version", "sessionId", "generation", "mode", "resourceId", "idleTtlMs", "historicalCanaries", "warmResourceCapability"].includes(key))) return null;
  const canaries: string[] = [];
  let bytes = 0;
  for (const canary of value.historicalCanaries) {
    if (typeof canary !== "string" || !canary || canaries.includes(canary)) return null;
    bytes += Buffer.byteLength(canary, "utf8");
    if (bytes > 65536) return null;
    canaries.push(canary);
  }
  if (value.mode === "create") {
    if (value.resourceId !== null || value.warmResourceCapability !== undefined || value.generation !== 1) return null;
    return { version: 1, sessionId: value.sessionId, generation: value.generation, mode: "create",
      resourceId: null, idleTtlMs: 1800000, historicalCanaries: canaries };
  }
  const grant = value.warmResourceCapability;
  if (value.mode !== "resume" || value.generation < 2 || typeof value.resourceId !== "string" || !value.resourceId || value.resourceId.length > 256 ||
      !record(grant) || grant.v !== 1 || grant.audience !== "adapter-manager-warm-resource" ||
      grant.sessionId !== value.sessionId || grant.generation !== value.generation || grant.resourceId !== value.resourceId ||
      !labels(grant.physicalLabels) || !labels(grant.ownedLabels) || !sameLabels(grant.ownedLabels, primary.ownedLabels) ||
      grant.physicalLabels.organizationId !== primary.ownedLabels.organizationId ||
      grant.physicalLabels.targetId !== primary.ownedLabels.targetId ||
      grant.physicalLabels.deviceGeneration !== primary.ownedLabels.deviceGeneration ||
      !Number.isSafeInteger(grant.previousCapabilityExpiresAt) || !Number.isSafeInteger(grant.issuedAt) || !Number.isSafeInteger(grant.expiresAt) ||
      (grant.previousCapabilityExpiresAt as number) > (grant.issuedAt as number) ||
      (grant.issuedAt as number) >= (grant.expiresAt as number) || (grant.expiresAt as number) > primary.expiresAt ||
      typeof grant.sig !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(grant.sig)) return null;
  return { version: 1, sessionId: value.sessionId, generation: value.generation, mode: "resume", resourceId: value.resourceId,
    idleTtlMs: 1800000, historicalCanaries: canaries,
    warmResourceCapability: { v: 1, audience: "adapter-manager-warm-resource", sessionId: value.sessionId,
      generation: value.generation, resourceId: value.resourceId, physicalLabels: { ...grant.physicalLabels }, ownedLabels: { ...grant.ownedLabels },
      previousCapabilityExpiresAt: grant.previousCapabilityExpiresAt as number, issuedAt: grant.issuedAt as number,
      expiresAt: grant.expiresAt as number, sig: grant.sig } };
}

/** Expiry/signature may differ across per-handle mints. All resource identity,
 * generation and redaction values must agree before any provider call. */
export function commanderWarmControlIdentity(control: CommanderWarmControl): string {
  const grant = control.warmResourceCapability;
  return JSON.stringify([control.version, control.sessionId, control.generation, control.mode, control.resourceId,
    control.idleTtlMs, control.historicalCanaries, grant ? [labelKeys.map((key) => grant.physicalLabels[key]),
      labelKeys.map((key) => grant.ownedLabels[key]), grant.previousCapabilityExpiresAt] : null]);
}

/** Values only, bounded and non-disclosing. Shared by downstream provider-side
 * export and stdout scanners; absent preserves the existing execution path. */
export function readCommanderWarmRedactionCanaries(env: Readonly<Record<string, unknown>>): string[] {
  const encoded = env.AOA_COMMANDER_REDACTION_CANARIES;
  if (encoded === undefined) return [];
  const refuse = (): never => { throw new Error("Commander warm redaction metadata invalid"); };
  if (typeof encoded !== "string" || Buffer.byteLength(encoded, "utf8") > 262144 ||
      typeof env.AOA_COMMANDER_WARM_TURN !== "string" || !env.AOA_COMMANDER_WARM_TURN) refuse();
  let values: unknown;
  try { values = JSON.parse(encoded as string); } catch { return refuse(); }
  if (!Array.isArray(values) || values.length > 64) return refuse();
  let bytes = 0;
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !value) refuse();
    bytes += Buffer.byteLength(value as string, "utf8");
    if (bytes > 65536) refuse();
    unique.add(value as string);
  }
  return [...unique];
}

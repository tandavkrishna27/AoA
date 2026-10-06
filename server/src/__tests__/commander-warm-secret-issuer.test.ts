import { generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executionTargets, internalAgentRuns, jobs, type Db } from "@armyofagents/db";
import { buildOwnedLabelsCapabilityCanonical, verifyWarmResourceCapability } from "@armyofagents/provider-capability";
import { createCommanderWarmSecretIssuer, isCommanderWarmWorkload } from "../services/commander-warm-secret-issuer.js";
import type { SecretResolveOutcome } from "../services/secret-broker.js";
import type { ResolvedFenceContext } from "../services/worker-fence-context.js";
import type { CommanderWarmState } from "../services/commander-warm-store.js";
const seam = vi.hoisted(() => ({ tenant: vi.fn(), source: vi.fn(), target: vi.fn(), proof: vi.fn() }));
vi.mock("../db/tenant-context.js", () => ({ runInTenant: (...args: unknown[]) => seam.tenant(...args) }));
vi.mock("../services/commander-job-authority.js", () => ({ loadCommanderJobAuthority: (...args: unknown[]) => seam.source(...args) }));
vi.mock("../services/execution-target-resolver.js", () => ({ normalizePlacementRegistryTarget: (...args: unknown[]) => seam.target(...args) }));
vi.mock("../services/commander-warm-store.js", async (original) => ({ ...await original<object>(),
  loadAcceptedCommanderWarmCheckpoint: (...args: unknown[]) => seam.proof(...args) }));
const keys = generateKeyPairSync("ed25519");
const org = randomUUID(), company = randomUUID(), targetId = randomUUID(), worker = randomUUID(), job = randomUUID(),
  attempt = randomUUID(), lease = randomUUID(), turn = randomUUID(), conversation = randomUUID();
const now = 1900000000000;
const workload = { command: "node", args: ["/home/user/aoa-commander-warm-v1.cjs", "codex",
  "/home/user/aoa-commander-input.json", "/home/user/aoa-output/aoa-one-shot-result.json"] };
const context = { companyId: company, authorityNow: new Date(now), leaseDeadline: new Date(now + 60000),
  fenceIdentity: { organizationId: org, companyId: company, targetId, workerId: worker, jobId: job, attemptId: attempt,
    attemptNumber: 1, leaseId: lease, targetGeneration: 1, profileHash: "a".repeat(64), providerConstraintHash: "b".repeat(64),
    targetAuthorityKey: `organization:${org}`, fenceToken: "private-fence" } } as ResolvedFenceContext;
const source = { turnId: turn, userId: "user", conversationId: conversation, status: "running", executionOwner: "distributed",
  distributedJobId: job, distributedAttemptId: attempt };
const material = (value: string): SecretResolveOutcome => ({ outcome: "resolved", seam: "sandbox_local_only",
  material: { value, materialization: "env", materializationTarget: "OPENAI_API_KEY", destination: null } });
let state: CommanderWarmState;
let input: Record<string, unknown>;
let lock: ReturnType<typeof vi.fn>;
let clock: ReturnType<typeof vi.fn>;
let update: ReturnType<typeof vi.fn>;
let issuer: ReturnType<typeof createCommanderWarmSecretIssuer>;
const blobs = new Map<string, string[]>();
const vault = { open: vi.fn(async (_identity: unknown, blob: { ciphertext: string }) => blobs.get(blob.ciphertext) ?? []),
  seal: vi.fn(async (_identity: unknown, values: readonly string[]) => {
    const ciphertext = randomUUID(); blobs.set(ciphertext, [...values]);
    return { scheme: "local_encrypted_v1" as const, iv: "iv", tag: "tag", ciphertext };
  }) };
beforeEach(() => {
  vi.clearAllMocks(); blobs.clear(); input = structuredClone(workload);
  state = { version: 1, id: randomUUID(), generation: 1, organizationId: org, companyId: company,
    userId: "user", conversationId: conversation, targetId, targetGeneration: 1, workerId: null,
    status: "claimed", expiresAtMs: now + 1800000, currentJobId: job, currentAttemptId: attempt,
    currentLeaseId: null, resource: null };
  lock = vi.fn(async () => ({ attempt: { id: attempt, placementProfileHash: "a".repeat(64) }, lease: { expiresAt: new Date(now + 60000) } }));
  clock = vi.fn(async () => new Date(now)); update = vi.fn();
  const tx = { select: () => ({ from: (table: unknown) => {
    const result = () => table === jobs ? [{ input, sourceKind: "commander_turn" }] : table === internalAgentRuns ?
      [{ distributedWarmState: state, distributedWarmConversationId: conversation }] : table === executionTargets ? [{}] : [];
    const query = { where: () => query, limit: async () => result(), for: async () => result() }; return query;
  } }), update: () => ({ set: (value: { distributedWarmState: CommanderWarmState }) => ({ where: async () => {
    update(value); state = value.distributedWarmState;
  } }) }) };
  seam.tenant.mockImplementation(async (_db, actualOrg, callback) => {
    expect(actualOrg).toBe(org); return callback({ jobControl: { lockActiveFence: lock, currentDatabaseTime: clock } }, tx);
  });
  seam.source.mockResolvedValue(source);
  seam.target.mockResolvedValue({ status: "active", targetGeneration: 1, profileHash: "a".repeat(64),
    providerConstraintHash: "b".repeat(64), providerConstraintProfile: { checkpointMode: "snapshot",
      supportedOperations: ["checkpoint", "restore"], maxIdleSeconds: 1800 } });
  seam.proof.mockResolvedValue({ previousCapabilityExpiresAtMs: now - 1000 });
  issuer = createCommanderWarmSecretIssuer({ appDb: {} as Db, controlPlaneSigningKey: keys.privateKey, vault, isWarmEnabled: () => true });
});
describe("Commander warm protected issuer", () => {
  it("binds the real first lease and signs a fresh primary without serializing the fence", async () => {
    const result = await issuer(material("fake-provider"), context);
    expect(result.outcome).toBe("resolved"); if (result.outcome !== "resolved") throw new Error();
    expect(result.warmControl).toMatchObject({ generation: 1, mode: "create", resourceId: null, historicalCanaries: [] });
    expect(result.warmControl).not.toHaveProperty("warmResourceCapability");
    const primary = result.ownedLabelsCapability!;
    expect(verify(null, buildOwnedLabelsCapabilityCanonical(primary), keys.publicKey, Buffer.from(primary.sig, "base64url"))).toBe(true);
    expect(state).toMatchObject({ workerId: worker, currentLeaseId: lease });
    expect(JSON.stringify(state)).not.toContain("fake-provider");
    expect(JSON.stringify(result.warmControl)).not.toContain("private-fence");
    expect(lock).toHaveBeenCalledTimes(2);
  });
  it("returns identical history across provider and JWT handles while encrypting both fresh values", async () => {
    state.redactionBeforeTurn = { scheme: "local_encrypted_v1", iv: "iv", tag: "tag", ciphertext: "old" };
    state.redaction = state.redactionBeforeTurn; blobs.set("old", ["fake-old"]);
    const first = await issuer(material("fake-new-provider"), context), second = await issuer(material("fake-new-jwt"), context);
    if (first.outcome !== "resolved" || second.outcome !== "resolved") throw new Error();
    expect(first.warmControl!.historicalCanaries).toEqual(["fake-old"]);
    expect(second.warmControl!.historicalCanaries).toEqual(["fake-old"]);
    expect(blobs.get(state.redaction!.ciphertext)).toEqual(["fake-old", "fake-new-provider", "fake-new-jwt"]);
  });
  it("signs only the exact accepted physical resource under the fresh turn labels", async () => {
    state.generation = 2; state.workerId = worker;
    state.resource = { id: "fake-vm", labels: { organizationId: org, targetId, workerId: worker, jobId: randomUUID(),
      attempt: 1, leaseId: randomUUID(), deviceGeneration: 1 }, checkpointEventId: randomUUID(), attemptId: randomUUID(),
      previousFenceRetired: true, previousCapabilityExpiresAtMs: now - 1000 };
    const result = await issuer(material("fake-current"), context); if (result.outcome !== "resolved") throw new Error();
    const grant = result.warmControl!.warmResourceCapability!;
    expect(verifyWarmResourceCapability(grant, keys.publicKey, { nowMs: now, resourceId: "fake-vm",
      ownedLabels: result.ownedLabelsCapability!.ownedLabels, primaryExpiresAt: result.ownedLabelsCapability!.expiresAt })).not.toBeNull();
    expect(grant.physicalLabels).toEqual(state.resource.labels);
    expect(grant.ownedLabels.jobId).toBe(job); expect(seam.proof).toHaveBeenCalled();
  });
  it.each(["quarantined", "retired", "paused"] as const)("denies %s ownership before encryption", async (status) => {
    state.status = status; await expect(issuer(material("fake"), context)).rejects.toThrow("unavailable");
    expect(vault.seal).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });
  it("denies a different worker or lease", async () => {
    state.workerId = randomUUID(); await expect(issuer(material("fake"), context)).rejects.toThrow("unavailable");
    state.workerId = worker; state.currentLeaseId = randomUUID(); await expect(issuer(material("fake"), context)).rejects.toThrow("unavailable");
    expect(update).not.toHaveBeenCalled();
  });
  it("denies late expiry after encryption", async () => {
    clock.mockResolvedValueOnce(new Date(now)).mockResolvedValueOnce(new Date(now + 1800001));
    await expect(issuer(material("fake"), context)).rejects.toThrow("unavailable"); expect(update).not.toHaveBeenCalled();
  });
  it("denies revoked membership or source after encryption", async () => {
    seam.source.mockResolvedValueOnce(source).mockResolvedValueOnce(null);
    await expect(issuer(material("fake"), context)).rejects.toThrow("unavailable"); expect(update).not.toHaveBeenCalled();
  });
  it("does not change ordinary execution replies or touch the fence", async () => {
    input = { ...workload, args: ["ordinary"] }; const outcome = material("fake");
    expect(await issuer(outcome, context)).toBe(outcome); expect(lock).not.toHaveBeenCalled(); expect(vault.seal).not.toHaveBeenCalled();
  });
  it("requires a signing key for a warm command", async () => {
    const unsigned = createCommanderWarmSecretIssuer({ appDb: {} as Db, vault, isWarmEnabled: () => true });
    await expect(unsigned(material("fake"), context)).rejects.toThrow("unavailable"); expect(update).not.toHaveBeenCalled();
  });
  it("defaults warm issuance off and refuses before encryption", async () => {
    const dormant = createCommanderWarmSecretIssuer({ appDb: {} as Db, vault, controlPlaneSigningKey: keys.privateKey });
    await expect(dormant(material("fake"), context)).rejects.toThrow("unavailable");
    expect(vault.seal).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });
  it("rechecks rollback after encryption before signing or persisting", async () => {
    const enabled = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const guarded = createCommanderWarmSecretIssuer({ appDb: {} as Db, vault,
      controlPlaneSigningKey: keys.privateKey, isWarmEnabled: enabled });
    await expect(guarded(material("fake"), context)).rejects.toThrow("unavailable");
    expect(vault.seal).toHaveBeenCalledTimes(1); expect(update).not.toHaveBeenCalled();
  });
  it("derives the marker from the exact command and paths", () => {
    expect(isCommanderWarmWorkload(workload)).toBe(true);
    expect(isCommanderWarmWorkload({ ...workload, command: "sh" })).toBe(false);
    expect(isCommanderWarmWorkload({ ...workload, args: [...workload.args, "extra"] })).toBe(false);
  });
});

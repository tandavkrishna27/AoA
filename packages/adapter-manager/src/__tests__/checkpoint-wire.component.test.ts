import type { AddressInfo } from "node:net";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderOpContext, ResourceLabels } from "@armyofagents/worker-daemon";
import { ResourceNotAvailableError, UnsupportedProviderOperation } from "@armyofagents/worker-daemon";
import { NetworkedProviderDriver, signOwnedLabelsCapability, signWarmResourceCapability } from "@armyofagents/provider-wire";
import { E2bSandboxProvider } from "@armyofagents/sandbox-e2b-provider/e2b-provider.js";
import { MockE2bTransport } from "@armyofagents/sandbox-e2b-provider/mock-transport.js";
import { createProviderServer } from "../server.js";
import { gateOwnedOp } from "../owned-op-gate.js";
import { KeyedMutex } from "../keyed-mutex.js";

const NOW = 1_700_000_000_000;
const keys = generateKeyPairSync("ed25519");
const labels: ResourceLabels = { organizationId: "org", targetId: "target", workerId: "worker", jobId: "job", attempt: 1, leaseId: "lease", deviceGeneration: 1 };
const ctx: ProviderOpContext = { deadlineMs: 5_000, idempotencyKey: "op" };
const servers: ReturnType<typeof createProviderServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});
async function setup(gated = true, supported = true, warmEnabled = false) {
  const transport = new MockE2bTransport({ supportsPauseResume: true });
  const pause = vi.spyOn(transport, "pause");
  const resume = vi.spyOn(transport, "resume");
  const provider = new E2bSandboxProvider({ transport, advertisedOptionalOps: supported ? ["checkpoint", "restore"] : [] });
  const server = createProviderServer({ provider, controlPlanePublicKey: gated ? keys.publicKey : undefined, now: () => NOW,
    isWarmEnabled: () => warmEnabled });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const capability = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: labels, expiresAt: NOW + 60_000 }, keys.privateKey);
  const driver = new NetworkedProviderDriver({ baseUrl, capability, enableCheckpointRestore: true });
  const { sandboxId } = await driver.create({ resourceLabels: labels, command: "node", args: [], env: {}, workloadType: "coding" }, ctx);
  return { transport, pause, resume, provider, baseUrl, capability, driver, sandboxId };
}

describe("ownership checked checkpoint and restore wire", () => {
  it("stays unadvertised and performs no RPC unless explicitly enabled", async () => {
    const fetchSpy = vi.fn();
    const driver = new NetworkedProviderDriver({ baseUrl: "http://unused", fetch: fetchSpy });
    expect(driver.checkpointMode).toBe("none");
    expect(driver.advertisedOperations.has("checkpoint")).toBe(false);
    await expect(driver.checkpoint("sandbox", ctx)).rejects.toBeInstanceOf(UnsupportedProviderOperation);
    await expect(driver.restore("sandbox", ctx)).rejects.toBeInstanceOf(UnsupportedProviderOperation);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("pauses and resumes the same owned sandbox over real HTTP", async () => {
    const { driver, sandboxId, transport, pause, resume } = await setup();
    expect(driver.checkpointMode).toBe("snapshot");
    expect(driver.advertisedOperations.has("checkpoint")).toBe(true);
    expect(driver.advertisedOperations.has("restore")).toBe(true);
    expect(await driver.checkpoint(sandboxId, ctx)).toMatchObject({ mode: "snapshot", checkpointRef: `snap-${sandboxId}` });
    expect((await transport.getInfo(sandboxId)).state).toBe("paused");
    expect(await driver.restore(sandboxId, ctx)).toMatchObject({ restored: true });
    expect((await transport.getInfo(sandboxId)).state).toBe("running");
    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });
  it.each(["checkpoint", "restore"] as const)("%s denies foreign, missing, expired and tampered capabilities without dispatch", async (op) => {
    const { baseUrl, capability, sandboxId, pause, resume } = await setup();
    const foreign = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: { ...labels, workerId: "other" }, expiresAt: NOW + 60_000 }, keys.privateKey);
    const expired = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: labels, expiresAt: NOW }, keys.privateKey);
    for (const token of [undefined, foreign, expired, { ...capability, ownedLabels: { ...labels, jobId: "other" } }]) {
      const driver = new NetworkedProviderDriver({ baseUrl, capability: token, enableCheckpointRestore: true });
      await expect(driver[op](sandboxId, ctx)).rejects.toBeInstanceOf(ResourceNotAvailableError);
    }
    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });
  it.each(["checkpoint", "restore"] as const)("%s is gated only and never dispatches on a keyless server", async (op) => {
    const { baseUrl, capability, sandboxId, pause, resume } = await setup(false);
    const response = await fetch(`${baseUrl}/op/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ args: sandboxId, ctx, capability }) });
    expect(response.status).toBe(404);
    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });
  it.each(["checkpoint", "restore"] as const)("%s makes foreign and absent refusals byte-identical", async (op) => {
    const { baseUrl, capability, sandboxId, pause, resume } = await setup();
    const foreign = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: { ...labels, jobId: "other" }, expiresAt: NOW + 60_000 }, keys.privateKey);
    const bodies = [];
    for (const [id, token] of [[sandboxId, foreign], ["absent", capability]] as const) {
      const response = await fetch(`${baseUrl}/op/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ args: id, ctx, capability: token }) });
      bodies.push(await response.text());
    }
    expect(bodies[0]).toBe(bodies[1]);
    expect(JSON.parse(bodies[0])).toEqual({ err: { name: "ResourceNotAvailableError", message: "resource not available" } });
    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });
  it.each([
    ["checkpoint", {}],
    ["checkpoint", { providerOpId: "op", mode: "none", checkpointRef: "ref" }],
    ["checkpoint", { providerOpId: "op", mode: "snapshot", checkpointRef: "" }],
    ["restore", {}],
    ["restore", { providerOpId: "op", restored: "true" }],
  ] as const)("%s refuses malformed receipt %j", async (op, receipt) => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: receipt })));
    const driver = new NetworkedProviderDriver({ baseUrl: "http://fake", fetch: fetchSpy, enableCheckpointRestore: true });
    await expect(driver[op]("sandbox", ctx)).rejects.toThrow("malformed receipt");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it("only a signed exact-resource handoff allows a fresh lease to resume an old labelled VM", async () => {
    const { baseUrl, capability, sandboxId, driver, pause, resume, provider } = await setup(true, true, true);
    await driver.checkpoint(sandboxId, ctx);
    const current = { ...labels, jobId: "next-job", leaseId: "next-lease", attempt: 2 };
    const currentCapability = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: current, expiresAt: NOW + 60_000 }, keys.privateKey);
    const warmResourceCapability = signWarmResourceCapability({ v: 1, audience: "adapter-manager-warm-resource", sessionId: "session", generation: 2, resourceId: sandboxId, physicalLabels: labels, ownedLabels: current, previousCapabilityExpiresAt: NOW, issuedAt: NOW, expiresAt: NOW + 60_000 }, keys.privateKey);
    const coldSuccessor = new NetworkedProviderDriver({ baseUrl, capability: currentCapability, enableCheckpointRestore: true });
    await expect(coldSuccessor.restore(sandboxId, ctx)).rejects.toBeInstanceOf(ResourceNotAvailableError);
    expect(resume).not.toHaveBeenCalled();
    const successor = new NetworkedProviderDriver({ baseUrl, capability: currentCapability, warmResourceCapability, enableCheckpointRestore: true });
    await expect(successor.restore(sandboxId, ctx)).resolves.toMatchObject({ restored: true });
    expect(resume).toHaveBeenCalledTimes(1);
    // Resource labels are never rewritten to manufacture an ownership match.
    expect((await provider.inspect(sandboxId, ctx)).resourceLabels).toEqual(labels);
    const another = await driver.create({ resourceLabels: labels, command: "node", args: [], env: {}, workloadType: "coding" }, { ...ctx, idempotencyKey: "another-create" });
    await expect(successor.restore(another.sandboxId, ctx)).rejects.toBeInstanceOf(ResourceNotAvailableError);
    const tampered = new NetworkedProviderDriver({ baseUrl, capability: currentCapability, warmResourceCapability: { ...warmResourceCapability, generation: 3 }, enableCheckpointRestore: true });
    const inspectSpy = vi.spyOn(provider, "inspect");
    await expect(tampered.restore(sandboxId, ctx)).rejects.toBeInstanceOf(ResourceNotAvailableError);
    expect(inspectSpy).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    // A missing primary fence cannot be replaced by the additional resource grant.
    const noPrimary = new NetworkedProviderDriver({ baseUrl, warmResourceCapability, enableCheckpointRestore: true });
    await expect(noPrimary.restore(sandboxId, ctx)).rejects.toBeInstanceOf(ResourceNotAvailableError);
    expect(inspectSpy).not.toHaveBeenCalled();
    expect(capability.ownedLabels).toEqual(labels);
  });
  it.each(["checkpoint", "restore"] as const)("%s preserves unsupported far provider failure", async (op) => {
    const { driver, sandboxId, pause, resume } = await setup(true, false);
    await expect(driver[op](sandboxId, ctx)).rejects.toBeInstanceOf(UnsupportedProviderOperation);
    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });
});


describe("retained resource capability at-use expiry", () => {
  it.each([
    ["queue", "warm"], ["inspect", "warm"], ["queue", "primary"], ["inspect", "primary"],
  ] as const)("refuses expiry during %s of %s authority before any restore effect", async (phase, authority) => {
    const { provider, sandboxId, resume } = await setup();
    const current = { ...labels, jobId: "new-job", leaseId: "new-lease", attempt: 2 };
    const capability = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: current, expiresAt: NOW + (authority === "primary" ? 1_000 : 60_000) }, keys.privateKey);
    const warmResourceCapability = signWarmResourceCapability({ v: 1, audience: "adapter-manager-warm-resource", sessionId: "session", generation: 2,
      resourceId: sandboxId, physicalLabels: labels, ownedLabels: current, previousCapabilityExpiresAt: NOW,
      issuedAt: NOW, expiresAt: NOW + 1_000 }, keys.privateKey);
    let clock = NOW;
    const lock = new KeyedMutex();
    let release!: () => void;
    const blocker = phase === "queue" ? lock.runExclusive(sandboxId, () => new Promise<void>((resolve) => { release = resolve; })) : null;
    await Promise.resolve();
    const originalInspect = provider.inspect.bind(provider);
    const inspect = vi.spyOn(provider, "inspect").mockImplementation(async (...args) => {
      const detail = await originalInspect(...args);
      if (phase === "inspect") clock = NOW + 1_000;
      return detail;
    });
    const dispatch = vi.fn(() => provider.restore(sandboxId, ctx));
    const work = gateOwnedOp({ provider, controlPlanePublicKey: keys.publicKey, now: () => clock,
      sandboxLock: lock, warmResourceCapability }, sandboxId, ctx, capability, dispatch);
    const denied = expect(work).rejects.toBeInstanceOf(ResourceNotAvailableError);
    if (phase === "queue") { clock = NOW + 1_000; release(); await blocker; }
    await denied;
    expect(dispatch).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    if (phase === "queue") expect(inspect).not.toHaveBeenCalled();
    expect(lock.size).toBe(0);
  });
});

import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { NetworkedProviderDriver, signOwnedLabelsCapability } from "@armyofagents/provider-wire";
import { createFakeSandboxProvider } from "../../../worker-daemon/src/__tests__/support/fake-provider.js";
import { createProviderServer } from "../server.js";
import { gateOwnedOp } from "../owned-op-gate.js";
import { KeyedMutex } from "../keyed-mutex.js";
const labels = { organizationId: "org", targetId: "target", workerId: "worker", jobId: "job", attempt: 1, leaseId: "lease", deviceGeneration: 1 };
describe("signed HTTP interrupts during provider execution", () => {
  it.each(["queue", "inspect"] as const)("refuses an interrupt whose ordinary primary expires during %s", async (phase) => {
    const keys = generateKeyPairSync("ed25519"); let now = Date.now(); const expiry = now + 100;
    const provider = createFakeSandboxProvider({ seededResources: [{ sandboxId: "vm", labels, state: "running", hasLiveLease: true }] });
    const capability = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: labels, expiresAt: expiry }, keys.privateKey);
    const lock = new KeyedMutex(); const dispatch = vi.fn(async () => "effect");
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const held = phase === "queue" ? lock.runExclusive("vm", async () => { await blocked; }) : Promise.resolve();
    if (phase === "inspect") {
      const inspect = provider.inspect.bind(provider);
      vi.spyOn(provider, "inspect").mockImplementation(async (...args) => { now = expiry; return inspect(...args); });
    }
    const pending = gateOwnedOp({ provider, controlPlanePublicKey: keys.publicKey, now: () => now,
      sandboxLock: lock, requirePrimaryAuthorityAtUse: true }, "vm", { deadlineMs: 5000, idempotencyKey: "interrupt" }, capability, dispatch);
    if (phase === "queue") { now = expiry; release(); }
    await expect(pending).rejects.toThrow("resource not available");
    await held; expect(dispatch).not.toHaveBeenCalled();
  });
  it.each(["cancel", "kill"] as const)("dispatches %s before a running command completes", async (operation) => {
    const keys = generateKeyPairSync("ed25519"); const provider = createFakeSandboxProvider();
    let started!: () => void, release!: () => void, interrupted!: () => void;
    const executing = new Promise<void>((resolve) => { started = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const stopped = new Promise<void>((resolve) => { interrupted = resolve; });
    vi.spyOn(provider, "execute").mockImplementation(async () => {
      started(); await blocked;
      return { providerOpId: "execute", exitCode: 1, signal: "SIGTERM", timedOut: false, stdoutRef: "stdout", stderrRef: "stderr" };
    });
    vi.spyOn(provider, operation).mockImplementation(async () => { interrupted(); release(); return { providerOpId: "interrupt", outcome: "stopped" }; });
    const server = createProviderServer({ provider, controlPlanePublicKey: keys.publicKey });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const capability = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: labels, expiresAt: Date.now() + 60000 }, keys.privateKey);
    const driver = new NetworkedProviderDriver({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, capability });
    const ctx = { deadlineMs: 5000, idempotencyKey: "create" };
    let execution: Promise<unknown> | undefined, interrupt: Promise<unknown> | undefined;
    try {
      const created = await driver.create({ resourceLabels: labels, command: "node", args: [], env: {}, workloadType: "batch" }, ctx);
      execution = driver.execute({ sandboxId: created.sandboxId, command: "node", args: [], env: {} }, { ...ctx, idempotencyKey: "execute" });
      await executing;
      interrupt = driver[operation](created.sandboxId, { ...ctx, idempotencyKey: "interrupt" });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const arrived = await Promise.race([stopped.then(() => true), new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 1000); })]);
      if (timer) clearTimeout(timer);
      expect(arrived).toBe(true);
      await expect(interrupt).resolves.toMatchObject({ outcome: "stopped" });
    } finally {
      release(); await Promise.allSettled([execution, interrupt]);
      server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

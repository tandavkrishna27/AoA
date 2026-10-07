import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { signOwnedLabelsCapability } from "@armyofagents/provider-capability";
import { NetworkedProviderDriver } from "@armyofagents/provider-wire";
import { createFakeSandboxProvider } from "../../../worker-daemon/src/__tests__/support/fake-provider.js";
import { handoffLabels } from "../../../worker-daemon/src/__tests__/support/supervisor-fixtures.js";
import { createProviderServer } from "../server.js";

describe("browser decision interrupt delivery", () => {
  it("delivers metadata while the owned guest execute remains pending and refuses foreign authority", async () => {
    const keys = generateKeyPairSync("ed25519"); const labels = handoffLabels();
    let release!: () => void; let executing!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { executing = resolve; });
    const base = createFakeSandboxProvider();
    const delivery = vi.fn(async () => ({ providerOpId: "decision", delivered: true, secret: "provider-extra-canary" }));
    const provider = { ...base, deliverBrowserDecision: delivery, execute: async (...args: Parameters<typeof base.execute>) => {
      executing(); await gate; return base.execute(...args);
    } };
    const server = createProviderServer({ provider, controlPlanePublicKey: keys.publicKey });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const capability = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: labels, expiresAt: Date.now() + 60_000 }, keys.privateKey);
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const driver = new NetworkedProviderDriver({ baseUrl, capability });
    const ctx = { deadlineMs: 1000, idempotencyKey: "create" };
    const created = await driver.create({ resourceLabels: labels, command: "node", args: [], env: {}, workloadType: "browser_session" }, ctx);
    const response = { requestId: "77777777-7777-4777-8777-777777777777", decision: "allow_once" as const, expiresAt: new Date(Date.now() + 30_000).toISOString() };
    let completed = false;
    const run = driver.execute({ sandboxId: created.sandboxId, command: "node", args: [], env: {} }, ctx).finally(() => { completed = true; });
    try {
      await started;
      expect(await driver.deliverBrowserDecision({ sandboxId: created.sandboxId, response }, ctx)).toEqual({ providerOpId: "decision", delivered: true });
      expect(completed).toBe(false); expect(delivery).toHaveBeenCalledTimes(1);
      const foreign = new NetworkedProviderDriver({ baseUrl, capability: signOwnedLabelsCapability({ ...capability,
        ownedLabels: { ...labels, leaseId: "foreign" } }, keys.privateKey) });
      await expect(foreign.deliverBrowserDecision({ sandboxId: created.sandboxId, response }, ctx)).rejects.toThrow();
      const absent = new NetworkedProviderDriver({ baseUrl });
      await expect(absent.deliverBrowserDecision({ sandboxId: created.sandboxId, response }, ctx)).rejects.toThrow();
      await expect(driver.deliverBrowserDecision({ sandboxId: created.sandboxId, response }, { ...ctx, deadlineMs: 0 })).rejects.toThrow();
      const crafted = await fetch(`${baseUrl}/op/browser_decision`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ args: { sandboxId: created.sandboxId, response, command: "arbitrary" }, ctx, capability }) });
      expect(await crafted.json()).toHaveProperty("err");
      expect(delivery).toHaveBeenCalledTimes(1);
    } finally { release(); await run; server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it("rechecks primary authority after inspection before the mailbox write", async () => {
    let clock = Date.now(); const keys = generateKeyPairSync("ed25519"); const labels = handoffLabels();
    const base = createFakeSandboxProvider(); const delivery = vi.fn(async () => ({ providerOpId: "decision", delivered: true as const }));
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inspecting = new Promise<void>((resolve) => { entered = resolve; });
    const provider = { ...base, deliverBrowserDecision: delivery, inspect: async (...args: Parameters<typeof base.inspect>) => {
      entered(); await gate; return base.inspect(...args);
    } };
    const server = createProviderServer({ provider, controlPlanePublicKey: keys.publicKey, now: () => clock });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const capability = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: labels, expiresAt: clock + 1000 }, keys.privateKey);
    const driver = new NetworkedProviderDriver({ baseUrl, capability }); const ctx = { deadlineMs: 5000, idempotencyKey: "create" };
    const created = await driver.create({ resourceLabels: labels, command: "node", args: [], env: {}, workloadType: "browser_session" }, ctx);
    const request = driver.deliverBrowserDecision({ sandboxId: created.sandboxId, response: {
      requestId: "77777777-7777-4777-8777-777777777777", decision: "allow_once", expiresAt: new Date(clock + 30_000).toISOString() } }, ctx);
    const rejected = expect(request).rejects.toThrow();
    try { await inspecting; clock += 1001; release(); await rejected; expect(delivery).not.toHaveBeenCalled(); }
    finally { release(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});

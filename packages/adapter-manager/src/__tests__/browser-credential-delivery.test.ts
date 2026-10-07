import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { signOwnedLabelsCapability } from "@armyofagents/provider-capability";
import { NetworkedProviderDriver } from "@armyofagents/provider-wire";
import { createFakeSandboxProvider } from "../../../worker-daemon/src/__tests__/support/fake-provider.js";
import { handoffLabels } from "../../../worker-daemon/src/__tests__/support/supervisor-fixtures.js";
import { createProviderServer } from "../server.js";

describe("browser credential interrupt delivery", () => {
  it("delivers metadata while the owned guest execute remains pending and refuses foreign authority", async () => {
    const keys = generateKeyPairSync("ed25519"); const labels = handoffLabels();
    let release!: () => void; let executing!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { executing = resolve; });
    const base = createFakeSandboxProvider();
    const delivery = vi.fn(async () => ({ providerOpId: "decision", delivered: true, secret: "provider-extra-canary" }));
    const provider = { ...base, deliverBrowserCredential: delivery, execute: async (...args: Parameters<typeof base.execute>) => {
      executing(); await gate; return base.execute(...args);
    } };
    const server = createProviderServer({ provider, controlPlanePublicKey: keys.publicKey });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const capability = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: labels, expiresAt: Date.now() + 60_000 }, keys.privateKey);
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const driver = new NetworkedProviderDriver({ baseUrl, capability });
    const ctx = { deadlineMs: 1000, idempotencyKey: "create" };
    const created = await driver.create({ resourceLabels: labels, command: "node", args: [], env: {}, workloadType: "browser_session" }, ctx);
    const requestId = "77777777-7777-4777-8777-777777777777";
    const grant = { protocolVersion: 1 as const, operation: "download" as const, artifactId: requestId, method: "GET" as const,
      url: "https://control.example/credential", headers: {}, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30_000).toISOString(),
      maxBytes: 128, expectedSha256: "a".repeat(64), objectKey: `organizations/${labels.organizationId}/jobs/${labels.jobId}/attempts/${labels.attempt}/browser-session/${requestId}`, redaction: "secret" as const };
    let completed = false;
    const run = driver.execute({ sandboxId: created.sandboxId, command: "node", args: [], env: {} }, ctx).finally(() => { completed = true; });
    try {
      await started;
      expect(await driver.deliverBrowserCredential({ sandboxId: created.sandboxId, requestId, grant }, ctx)).toEqual({ providerOpId: "decision", delivered: true });
      expect(completed).toBe(false); expect(delivery).toHaveBeenCalledTimes(1);
      const foreign = new NetworkedProviderDriver({ baseUrl, capability: signOwnedLabelsCapability({ ...capability,
        ownedLabels: { ...labels, leaseId: "foreign" } }, keys.privateKey) });
      await expect(foreign.deliverBrowserCredential({ sandboxId: created.sandboxId, requestId, grant }, ctx)).rejects.toThrow();
      const absent = new NetworkedProviderDriver({ baseUrl });
      await expect(absent.deliverBrowserCredential({ sandboxId: created.sandboxId, requestId, grant }, ctx)).rejects.toThrow();
      await expect(driver.deliverBrowserCredential({ sandboxId: created.sandboxId, requestId, grant }, { ...ctx, deadlineMs: 0 })).rejects.toThrow();
      const crafted = await fetch(`${baseUrl}/op/browser_credential`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ args: { sandboxId: created.sandboxId, requestId, grant, command: "arbitrary" }, ctx, capability }) });
      expect(await crafted.json()).toHaveProperty("err");
      expect(delivery).toHaveBeenCalledTimes(1);
    } finally { release(); await run; server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});

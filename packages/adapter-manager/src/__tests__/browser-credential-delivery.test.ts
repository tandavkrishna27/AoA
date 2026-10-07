import { E2bSandboxProvider } from "../../../sandbox-e2b-provider/src/e2b-provider.js";
import { MockE2bTransport } from "../../../sandbox-e2b-provider/src/mock-transport.js";
import { EffectAuthority } from "../../../worker-daemon/src/supervisor/effect-authority.js";
import { createHash, generateKeyPairSync } from "node:crypto";
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


it.each(["withdraw", "primary-expiry"])("never publishes after %s during native redemption", async (reason) => {
  const keys = generateKeyPairSync("ed25519"), labels = handoffLabels(); let clock = Date.now();
  let fetched!: () => void, release!: (response: Response) => void;
  const started = new Promise<void>(resolve => { fetched = resolve; });
  const held = new Promise<Response>(resolve => { release = resolve; });
  let redemptionSignal: AbortSignal | undefined;
  const transport = new MockE2bTransport();
  const writer = vi.spyOn(transport, "runCommand");
  const provider = new E2bSandboxProvider({ transport, browserCredentialControlPlaneOrigin: "https://control.example",
    browserCredentialFetch: (async (_url, options) => { redemptionSignal = options?.signal as AbortSignal; fetched(); return held; }) as typeof fetch });
  const server = createProviderServer({ provider, controlPlanePublicKey: keys.publicKey, now: () => clock });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const driver = new NetworkedProviderDriver({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    capability: signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: labels, expiresAt: clock + 30000 }, keys.privateKey) });
  const ctx = { deadlineMs: 1000, idempotencyKey: "cancel-credential" };
  const created = await driver.create({ resourceLabels: labels, command: "node", args: [], env: {}, workloadType: "browser_session" }, ctx);
  const requestId = "77777777-7777-4777-8777-777777777777";
  const bytes = Buffer.from(JSON.stringify({ requestId, bindingId: requestId, policyDigest: "a".repeat(64), origin: "https://example.com",
    expiresAt: new Date(Date.now() + 60000).toISOString(), cookie: { name: "__Host-session", value: "secret-session-canary-123" } }));
  const grant = { protocolVersion: 1 as const, operation: "download" as const, artifactId: requestId, method: "GET" as const,
    url: `https://control.example/api/worker-control/browser-session-credentials/${requestId}?grant=opaque`, headers: {},
    issuedAt: new Date(clock).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), maxBytes: bytes.length,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"), objectKey: "organizations/org/browser-session", redaction: "secret" as const };
  const effect = new EffectAuthority(driver, { jobId: labels.jobId, attempt: labels.attempt, leaseId: labels.leaseId,
    fenceToken: "fence", deviceGeneration: labels.deviceGeneration, observedSeq: 0 });
  const delivery = effect.deliverBrowserCredential({ sandboxId: created.sandboxId, requestId, grant }, ctx);
  const refusal = expect(delivery).rejects.toThrow();
  try {
    await started;
    if (reason === "withdraw") {
      effect.withdraw(); await refusal;
      for (let i = 0; i < 100 && !redemptionSignal?.aborted; i++) await new Promise(resolve => setTimeout(resolve, 5));
      expect(redemptionSignal?.aborted).toBe(true);
    } else clock += 30001;
    release(new Response(bytes)); await refusal;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(writer).not.toHaveBeenCalled();
  } finally { release(new Response(bytes)); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

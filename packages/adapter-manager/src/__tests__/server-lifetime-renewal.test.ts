import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { signOwnedLabelsCapability } from "@armyofagents/provider-capability";
import { NetworkedProviderDriver } from "@armyofagents/provider-wire";
import { createFakeSandboxProvider } from "../../../worker-daemon/src/__tests__/support/fake-provider.js";
import { createSupervisor } from "../../../worker-daemon/src/supervisor/supervisor.js";
import { collectingSink, handoffLabels, makeServiceHandoff, SUPERVISOR_IDENTITY } from "../../../worker-daemon/src/__tests__/support/supervisor-fixtures.js";
import { createProviderServer } from "../server.js";

const labels = handoffLabels();
async function setup(clock: () => number = Date.now) {
  const keys = generateKeyPairSync("ed25519");
  const now = clock();
  const lifetime = vi.fn(async (_sandboxId: string, expiresAt: number) => ({ providerOpId: "renew", expiresAt }));
  const base = createFakeSandboxProvider({ processSupervisionMode: "handle", processState: "running", signalStopsProcess: true, signalAccepted: "accepted" });
  const startProcess = vi.fn(base.startProcess);
  const processStatus = vi.fn(base.processStatus);
  const signalProcess = vi.fn(base.signalProcess);
  const provider = { ...base, startProcess, processStatus, signalProcess, sandboxLifetimeMode: "renewable" as const, renewLifetime: lifetime };
  const server = createProviderServer({ provider, controlPlanePublicKey: keys.publicKey, now: clock });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const capability = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: labels, expiresAt: now + 260_000 }, keys.privateKey);
  const driver = new NetworkedProviderDriver({ baseUrl, capability, enableLifetimeRenewal: true, enableProcessSupervision: true });
  const ctx = { deadlineMs: 5000, idempotencyKey: "create" };
  const created = await driver.create({ resourceLabels: labels, command: "node", args: [], env: {}, workloadType: "service" }, ctx);
  return { driver, startProcess, processStatus, signalProcess, baseUrl, created, lifetime, capability, ctx, keys,
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}
describe("owned sandbox lifetime renewal route", () => {
  it("supervises a real wire service past four minutes using a newly signed lease capability and an acknowledged TTL", async () => {
    const epoch = Date.now();
    let clock = epoch;
    const test = await setup(() => clock);
    const sink = collectingSink();
    const supervisor = createSupervisor({ makeRunProvider: () => test.driver,
      identity: SUPERVISOR_IDENTITY, eventSink: sink, redactionCanaries: [], now: () => clock,
      opDeadlineMs: 240_000, serviceHealthTickMs: 1,
      materializeRunSecrets: async () => ({ env: {}, canaries: [], capability: test.capability }) });
    const base = makeServiceHandoff();
    const handoff = { ...base, offer: { ...base.offer, job: { ...base.offer.job, deadline: new Date(epoch + 400_000).toISOString() } } };
    let finished = false;
    const running = supervisor.accept(handoff).finally(() => { finished = true; });
    try {
      for (let n = 0; n < 200 && !sink.events.some((event) => event.eventType === "service_health"); n++) await new Promise((resolve) => setTimeout(resolve, 2));
      expect(sink.events.some((event) => event.eventType === "service_health")).toBe(true);
      clock = epoch + 150_000;
      const renewed = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: labels, expiresAt: epoch + 450_000 }, test.keys.privateKey);
      supervisor.onAuthorityRenewed(handoff.leaseId, renewed);
      for (let n = 0; n < 200 && test.lifetime.mock.calls.length === 0; n++) await new Promise((resolve) => setTimeout(resolve, 2));
      expect(test.lifetime).toHaveBeenCalledWith(expect.any(String), epoch + 400_000, expect.objectContaining({ deadlineMs: expect.any(Number) }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      clock = epoch + 270_000;
      const healthCount = sink.events.filter((event) => event.eventType === "service_health").length;
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(finished).toBe(false);
      expect(sink.events.filter((event) => event.eventType === "service_health").length).toBeGreaterThan(healthCount);
      clock = epoch + 401_000;
      await running;
      expect(test.signalProcess).toHaveBeenCalled();
      expect(sink.events.some((event) => event.eventType === "service_instance_stopped")).toBe(true);
    } finally { if (!finished) await supervisor.onLeaseLost(handoff.leaseId); await running; await test.close(); }
  });
  it("relays witnessed process launch, status and stop through the owned gate", async () => {
    const test = await setup();
    try {
      const started = await test.driver.startProcess({ sandboxId: test.created.sandboxId, command: "node", args: [], env: {} }, { ...test.ctx, idempotencyKey: "launch" });
      expect(started.handle).not.toBe("");
      expect((await test.driver.processStatus(test.created.sandboxId, started.handle, test.ctx)).observation.state).toBe("running");
      const stopped = await test.driver.signalProcess(test.created.sandboxId, started.handle, "cancel", test.ctx);
      expect(stopped.accepted).toBe("accepted");
      expect(stopped.observation.state).toBe("gone");
      expect(test.startProcess).toHaveBeenCalledTimes(1);
    } finally { await test.close(); }
  });
  it("refuses process effects for an unowned resource or missing authority", async () => {
    const test = await setup();
    try {
      await expect(test.driver.startProcess({ sandboxId: "foreign", command: "node", args: [], env: {} }, test.ctx)).rejects.toThrow();
      await expect(test.driver.processStatus("foreign", "handle", test.ctx)).rejects.toThrow();
      await expect(test.driver.signalProcess("foreign", "handle", "kill", test.ctx)).rejects.toThrow();
      const noAuthority = new NetworkedProviderDriver({ baseUrl: test.baseUrl, enableProcessSupervision: true });
      await expect(noAuthority.startProcess({ sandboxId: test.created.sandboxId, command: "node", args: [], env: {} }, test.ctx)).rejects.toThrow();
      expect(test.startProcess).not.toHaveBeenCalled();
      expect(test.processStatus).not.toHaveBeenCalled();
      expect(test.signalProcess).not.toHaveBeenCalled();
    } finally { await test.close(); }
  });
  it("renews only the owned sandbox through the existing capability gate", async () => {
    const test = await setup();
    try {
      const expiresAt = Date.now() + 60_000;
      expect(await test.driver.renewLifetime(test.created.sandboxId, expiresAt, test.ctx)).toEqual({ providerOpId: "renew", expiresAt });
      expect(test.lifetime).toHaveBeenCalledTimes(1);
    } finally { await test.close(); }
  });
  it("refuses lifetime beyond the capability and another sandbox identity", async () => {
    const test = await setup();
    try {
      await expect(test.driver.renewLifetime(test.created.sandboxId, test.capability.expiresAt + 1, test.ctx)).rejects.toThrow();
      await expect(test.driver.renewLifetime("foreign", Date.now() + 60_000, test.ctx)).rejects.toThrow();
      expect(test.lifetime).not.toHaveBeenCalled();
    } finally { await test.close(); }
  });
  it("refuses renewal without an owned capability", async () => {
    const test = await setup();
    try {
      const unauthenticated = new NetworkedProviderDriver({ baseUrl: test.baseUrl, enableLifetimeRenewal: true });
      await expect(unauthenticated.renewLifetime(test.created.sandboxId, Date.now() + 60_000, test.ctx)).rejects.toThrow();
      expect(test.lifetime).not.toHaveBeenCalled();
    } finally { await test.close(); }
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { E2bSandboxProvider } from "../e2b-provider.js";
import { MockE2bTransport } from "../mock-transport.js";

const now = 1_800_000_000_000;
const labels = { organizationId: "org", targetId: "target", workerId: "worker", jobId: "job", attempt: 1, leaseId: "lease", deviceGeneration: 1 };
const ctx = { deadlineMs: 1000, idempotencyKey: "create" };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });
async function setup() {
  const transport = new MockE2bTransport();
  const setLifetime = vi.spyOn(transport, "setTimeout");
  const provider = new E2bSandboxProvider({ transport });
  const created = await provider.create({ resourceLabels: labels, command: "node", args: [], env: { TOKEN: "secret-canary" }, workloadType: "service" }, ctx);
  return { provider, created, setLifetime };
}
describe("sandbox lifetime renewal", () => {
  it("sets a bounded new TTL on the existing sandbox", async () => {
    const test = await setup();
    expect(test.provider.sandboxLifetimeMode).toBe("renewable");
    expect(await test.provider.renewLifetime(test.created.sandboxId, now + 120_000, { ...ctx, idempotencyKey: "renew" })).toMatchObject({ expiresAt: now + 120_000 });
    expect(test.setLifetime).toHaveBeenLastCalledWith(test.created.sandboxId, 120_000);
    await test.provider.destroy(test.created.sandboxId, ctx);
  });
  it("refuses expired, excessive and exhausted lifetime requests", async () => {
    const test = await setup();
    for (const expiresAt of [now, now - 1, now + 300_001, NaN]) {
      await expect(test.provider.renewLifetime(test.created.sandboxId, expiresAt, ctx)).rejects.toThrow();
    }
    await expect(test.provider.renewLifetime(test.created.sandboxId, now + 1000, { ...ctx, deadlineMs: 0 })).rejects.toThrow();
    for (const deadlineMs of [NaN, Infinity, -1]) {
      await expect(test.provider.renewLifetime(test.created.sandboxId, now + 1000, { ...ctx, deadlineMs })).rejects.toThrow();
    }
    expect(test.setLifetime).toHaveBeenCalledTimes(1);
    await test.provider.destroy(test.created.sandboxId, ctx);
  });
  it("retains the same credential scanner registry across acknowledged TTL renewal", async () => {
    const test = await setup();
    await test.provider.renewLifetime(test.created.sandboxId, now + 120_000, ctx);
    await vi.advanceTimersByTimeAsync(2000);
    expect(test.provider.registeredSecretSetCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(118_001);
    expect(test.provider.registeredSecretSetCount()).toBe(0);
    await test.provider.destroy(test.created.sandboxId, ctx);
  });
  it("does not revive an expired run's credential registry", async () => {
    const test = await setup();
    await vi.advanceTimersByTimeAsync(1001);
    await expect(test.provider.renewLifetime(test.created.sandboxId, now + 120_000, ctx)).rejects.toThrow();
    expect(test.setLifetime).toHaveBeenCalledTimes(1);
    await test.provider.destroy(test.created.sandboxId, ctx);
  });
  it("refuses a late provider acknowledgement after credential expiry", async () => {
    const test = await setup();
    let release!: () => void;
    test.setLifetime.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const renewal = test.provider.renewLifetime(test.created.sandboxId, now + 120_000, ctx);
    const rejected = expect(renewal).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1001);
    release(); await rejected;
    expect(test.provider.registeredSecretSetCount()).toBe(0);
    await test.provider.destroy(test.created.sandboxId, ctx);
  });
});

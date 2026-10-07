import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLeaseRenewalDriver } from "../lease/lease-renewal.js";
import { CONTROL_EXTENSION_NAMESPACE } from "../lease/control-commands.js";
import type { FakeControlPlane } from "./support/fake-control-plane.js";
import { enrollFixtureWorker, POLL_FIXTURE_IDS, FENCE_TOKEN } from "./support/poll-fixtures.js";
import { FakeScheduler, RENEWAL_CODE, RENEWAL_IDENTITY, makeRenewalHandoff, recordingSupervisor, staticSessionProvider, startRenewalPlane } from "./support/renewal-fixtures.js";
let scheduler: FakeScheduler; let fake: FakeControlPlane;
beforeEach(async () => { scheduler = new FakeScheduler(); fake = await startRenewalPlane(scheduler); });
afterEach(async () => { await fake.close(); vi.restoreAllMocks(); });
async function setup(windowMs = 300_000) {
  const { session, key, client } = await enrollFixtureWorker(fake, RENEWAL_CODE);
  const supervisor = recordingSupervisor(); const applied = vi.fn();
  const driver = createLeaseRenewalDriver({ client, session: staticSessionProvider(session), key, identity: RENEWAL_IDENTITY,
    supervisor: supervisor.supervisor, schedule: scheduler, controlHandlers: () => ({ drain: applied }) });
  const handoff = makeRenewalHandoff({ windowMs }); void driver.accept(handoff);
  return { driver, supervisor, handoff, client, applied };
}
describe("bounded pending runtime control polling", () => {
  it("delivers control within the unchanged guest 30-second budget on a default 300-second lease", async () => {
    const c = await setup(); const start = scheduler.now(); const guestDeadline = start + 30_000;
    c.driver.requestControlPolling!(c.handoff.leaseId, start + 300_000);
    fake.enqueueRenew({ kind: "renewed", extensions: [{ namespace: CONTROL_EXTENSION_NAMESPACE, schemaVersion: 1, critical: false,
      value: { commands: [{ protocolVersion: 1, audience: "control_channel", commandId: "00000000-0000-4000-8000-000000000001",
        commandSeq: 1, idempotencyKey: "00000000-0000-4000-8000-000000000001", issuedAt: new Date(start).toISOString(), nonce: "nonce-1",
        organizationId: POLL_FIXTURE_IDS.org, companyId: POLL_FIXTURE_IDS.company, workerId: POLL_FIXTURE_IDS.worker,
        jobId: POLL_FIXTURE_IDS.job, attempt: 1, leaseId: c.handoff.leaseId, fenceToken: FENCE_TOKEN, commandKind: "drain", reason: "fixture" }],
        pendingCount: 1, truncated: false } }] });
    expect(scheduler.setTimerLog.at(-1)!.targetMs).toBe(start + 1000);
    await scheduler.advanceTo(start + 1000);
    expect(c.applied).toHaveBeenCalledOnce(); expect(scheduler.now()).toBeLessThan(guestDeadline);
    expect(guestDeadline).toBe(start + 30_000); c.driver.stop();
  });
  it("returns to the normal renewal schedule when cleared or expired", async () => {
    const c = await setup(); const start = scheduler.now();
    c.driver.requestControlPolling!(c.handoff.leaseId, start + 2000);
    await scheduler.advanceTo(start + 1000);
    expect(scheduler.setTimerLog.at(-1)!.targetMs).toBe(start + 2000);
    await scheduler.advanceTo(start + 2000);
    expect(scheduler.setTimerLog.at(-1)!.delayMs).toBeGreaterThan(1000);
    c.driver.requestControlPolling!(c.handoff.leaseId, scheduler.now() + 30_000);
    expect(scheduler.setTimerLog.at(-1)!.delayMs).toBe(1000);
    c.driver.requestControlPolling!(c.handoff.leaseId, null);
    expect(scheduler.setTimerLog.at(-1)!.delayMs).toBeGreaterThan(1000); c.driver.stop();
  });
  it("caps polling at the current lease expiry without extending that cap after renewal", async () => {
    const c = await setup(2000); const start = scheduler.now();
    c.driver.requestControlPolling!(c.handoff.leaseId, start + 600_000);
    await scheduler.advanceTo(start + 1000); await scheduler.advanceTo(start + 2000);
    expect(scheduler.setTimerLog.at(-1)!.delayMs).toBeGreaterThan(1000); c.driver.stop();
  });
  it("caps a long polling request at five minutes even when the lease is longer", async () => {
    const c = await setup(600_000); const start = scheduler.now();
    c.driver.requestControlPolling!(c.handoff.leaseId, start + 600_000);
    await scheduler.advanceTo(start + 299_000);
    expect(scheduler.setTimerLog.at(-1)!.targetMs).toBe(start + 300_000);
    await scheduler.advanceTo(start + 300_000);
    expect(scheduler.setTimerLog.at(-1)!.delayMs).toBeGreaterThan(1000); c.driver.stop();
  });
  it("retains the same renewal idempotency key through transient retries while polling", async () => {
    const c = await setup(); c.driver.requestControlPolling!(c.handoff.leaseId, scheduler.now() + 30_000);
    fake.enqueueRenew({ kind: "error", status: 503, code: "internal_unavailable" });
    await scheduler.advanceTo(scheduler.now() + 1000);
    expect(fake.renewCount()).toBe(2); expect(fake.renewKeys()).toHaveLength(1); c.driver.stop();
  });
  it("refuses malformed, unknown, expired and closed requests", async () => {
    const c = await setup(); const future = scheduler.now() + 1000;
    for (const bad of [NaN, Infinity, "bad", true, scheduler.now(), -1]) expect(() => c.driver.requestControlPolling!(c.handoff.leaseId, bad as number)).toThrow();
    expect(() => c.driver.requestControlPolling!("unknown", future)).toThrow();
    c.driver.proxyFor(c.handoff.leaseId)!.close("lease_lost");
    expect(() => c.driver.requestControlPolling!(c.handoff.leaseId, future)).toThrow(); c.driver.stop();
    expect(() => c.driver.requestControlPolling!(c.handoff.leaseId, null)).toThrow();
  });
  it("stops polling on completion and server cancellation", async () => {
    const c = await setup(); c.driver.requestControlPolling!(c.handoff.leaseId, scheduler.now() + 30_000);
    c.supervisor.completeAccept(c.handoff.leaseId); await new Promise(setImmediate);
    expect(scheduler.timerCount()).toBe(0); expect(() => c.driver.requestControlPolling!(c.handoff.leaseId, null)).toThrow();
    void c.driver.accept(c.handoff); const second = c; second.driver.requestControlPolling!(second.handoff.leaseId, scheduler.now() + 30_000);
    fake.enqueueRenew({ kind: "renewed", cancelRequested: true }); await scheduler.advanceTo(scheduler.now() + 1000);
    expect(scheduler.timerCount()).toBe(0); expect(() => second.driver.requestControlPolling!(second.handoff.leaseId, null)).toThrow();
  });
  it("coalesces polling while a renewal is in flight", async () => {
    const c = await setup(); const original = c.client.leaseRenew.bind(c.client); let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const renew = vi.spyOn(c.client, "leaseRenew").mockImplementation(async (...args) => { await gate; return original(...args); });
    c.driver.requestControlPolling!(c.handoff.leaseId, scheduler.now() + 30_000);
    const first = scheduler.advanceTo(scheduler.now() + 1000); await new Promise(setImmediate);
    expect(renew).toHaveBeenCalledOnce();
    for (let i = 0; i < 3; i++) c.driver.requestControlPolling!(c.handoff.leaseId, scheduler.now() + 30_000);
    await scheduler.advanceTo(scheduler.now() + 1000); expect(renew).toHaveBeenCalledOnce();
    release(); await first; expect(scheduler.timerCount()).toBe(1); c.driver.stop();
  });
});

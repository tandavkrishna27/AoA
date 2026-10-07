import { describe, expect, it, vi } from "vitest";
import { createSupervisor } from "../supervisor/supervisor.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";
import { collectingSink, handoffLabels, makeHandoff, makeServiceHandoff, SUPERVISOR_IDENTITY } from "./support/supervisor-fixtures.js";
import type { OwnedLabelsCapabilityLike } from "../lease/owned-labels-capability.js";

async function setup() {
  let clock = 1000;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const provider = createFakeSandboxProvider({ executeGate: gate });
  const refreshed: unknown[] = [];
  const initial: OwnedLabelsCapabilityLike = { v: 1, audience: "adapter-manager", ownedLabels: handoffLabels(), expiresAt: 5000, sig: "initial" };
  const supervisor = createSupervisor({ makeRunProvider: () => ({ ...provider, refreshAuthority: (cap) => { refreshed.push(cap); } }),
    identity: SUPERVISOR_IDENTITY, eventSink: collectingSink(), redactionCanaries: [], now: () => clock,
    materializeRunSecrets: async () => ({ env: {}, canaries: [], capability: initial }) });
  const handoff = makeHandoff();
  const running = supervisor.accept(handoff);
  for (let n = 0; n < 100 && provider.callCount("execute") === 0; n++) await new Promise((resolve) => setTimeout(resolve, 2));
  expect(provider.callCount("execute")).toBe(1);
  return { supervisor, handoff, running, release, initial, provider, refreshed, advance: (value: number) => { clock = value; } };
}

describe("live supervisor authority renewal", () => {
  it.each(["failed", "pending"])("keeps the old sandbox expiry after a %s renewal and ignores late acknowledgement", async (mode) => {
    let clock = 1000;
    let acknowledge!: () => void;
    const gate = new Promise<void>((resolve) => { acknowledge = resolve; });
    const provider = createFakeSandboxProvider({ processSupervisionMode: "handle", processState: "running", signalStopsProcess: true, signalAccepted: "accepted" });
    const renewLifetime = vi.fn(async (_sandboxId: string, expiresAt: number) => {
      if (mode === "failed") throw new Error("provider unavailable");
      await gate;
      return { providerOpId: "late", expiresAt };
    });
    const initial = { v: 1, audience: "adapter-manager", ownedLabels: handoffLabels(), expiresAt: 260_000, sig: "initial" };
    const sink = collectingSink();
    const supervisor = createSupervisor({ makeRunProvider: () => ({ ...provider, sandboxLifetimeMode: "renewable", renewLifetime, refreshAuthority: () => {} }),
      identity: SUPERVISOR_IDENTITY, eventSink: sink, redactionCanaries: [], now: () => clock,
      opDeadlineMs: 240_000, serviceHealthTickMs: 1,
      materializeRunSecrets: async () => ({ env: {}, canaries: [], capability: initial }) });
    const handoff = makeServiceHandoff();
    let finished = false;
    const running = supervisor.accept(handoff).finally(() => { finished = true; });
    try {
      for (let n = 0; n < 100 && !sink.events.some((event) => event.eventType === "service_health"); n++) await new Promise((resolve) => setTimeout(resolve, 2));
      clock = 150_000;
      supervisor.onAuthorityRenewed(handoff.leaseId, { ...initial, expiresAt: 450_000, sig: "renewed" });
      expect(renewLifetime).toHaveBeenCalledTimes(1);
      clock = 190_000;
      await running;
      expect(provider.callCount("destroy")).toBe(1);
      const eventCount = sink.events.length;
      acknowledge();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(sink.events).toHaveLength(eventCount);
      expect(() => supervisor.onAuthorityRenewed(handoff.leaseId, { ...initial, expiresAt: 500_000 })).toThrow("live fence");
    } finally { acknowledge(); if (!finished) await supervisor.onLeaseLost(handoff.leaseId); await running; }
  });
  it("extends a service past its initial TTL only after provider acknowledgement and stops at the job deadline", async () => {
    let clock = 1000;
    let acknowledge!: () => void;
    const gate = new Promise<void>((resolve) => { acknowledge = resolve; });
    const provider = createFakeSandboxProvider({ processSupervisionMode: "handle", processState: "running", signalStopsProcess: true, signalAccepted: "accepted" });
    const renewLifetime = vi.fn(async (_sandboxId: string, expiresAt: number) => {
      await gate;
      return { providerOpId: "ttl-renewed", expiresAt };
    });
    const initial = { v: 1, audience: "adapter-manager", ownedLabels: handoffLabels(), expiresAt: 260_000, sig: "initial" };
    const sink = collectingSink();
    const supervisor = createSupervisor({ makeRunProvider: () => ({ ...provider, sandboxLifetimeMode: "renewable", renewLifetime, refreshAuthority: () => {} }),
      identity: SUPERVISOR_IDENTITY, eventSink: sink, redactionCanaries: [], now: () => clock,
      opDeadlineMs: 240_000, serviceHealthTickMs: 1,
      materializeRunSecrets: async () => ({ env: {}, canaries: [], capability: initial }) });
    const base = makeServiceHandoff();
    const handoff = { ...base, offer: { ...base.offer, job: { ...base.offer.job, deadline: new Date(400_000).toISOString() } } };
    let finished = false;
    const running = supervisor.accept(handoff).finally(() => { finished = true; });
    try {
      for (let n = 0; n < 100 && !sink.events.some((event) => event.eventType === "service_health"); n++) await new Promise((resolve) => setTimeout(resolve, 2));
      clock = 150_000;
      supervisor.onAuthorityRenewed(handoff.leaseId, { ...initial, expiresAt: 450_000, sig: "renewed" });
      expect(renewLifetime).toHaveBeenCalledWith(expect.any(String), 400_000, expect.objectContaining({ deadlineMs: 5000 }));
      acknowledge();
      await new Promise((resolve) => setTimeout(resolve, 10));
      clock = 270_000;
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(finished).toBe(false);
      clock = 401_000;
      await running;
      expect(provider.callCount("destroy")).toBe(1);
    } finally { acknowledge(); if (!finished) await supervisor.onLeaseLost(handoff.leaseId); await running; }
  });
  it("recomputes the service teardown window from renewed authority on each tick", async () => {
    let clock = 1000;
    const provider = createFakeSandboxProvider({ processSupervisionMode: "handle", processState: "running", signalStopsProcess: true, signalAccepted: "accepted" });
    const sink = collectingSink();
    const initial = { v: 1, audience: "adapter-manager", ownedLabels: handoffLabels(), expiresAt: 100_000, sig: "initial" };
    const supervisor = createSupervisor({ makeRunProvider: () => ({ ...provider, refreshAuthority: () => {} }),
      identity: SUPERVISOR_IDENTITY, eventSink: sink, redactionCanaries: [], now: () => clock,
      opDeadlineMs: 1_000_000, serviceHealthTickMs: 1,
      materializeRunSecrets: async () => ({ env: {}, canaries: [], capability: initial }) });
    const handoff = makeServiceHandoff();
    let finished = false;
    const running = supervisor.accept(handoff).finally(() => { finished = true; });
    try {
      for (let n = 0; n < 100 && !sink.events.some((event) => event.eventType === "service_health"); n++) await new Promise((resolve) => setTimeout(resolve, 2));
      expect(sink.events.some((event) => event.eventType === "service_health")).toBe(true);
      supervisor.onAuthorityRenewed(handoff.leaseId, { ...initial, expiresAt: 200_000, sig: "renewed" });
      const beforeRenewedWindow = sink.events.filter((event) => event.eventType === "service_health").length;
      clock = 50_000;
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(finished).toBe(false);
      expect(sink.events.filter((event) => event.eventType === "service_health").length).toBeGreaterThan(beforeRenewedWindow);
      clock = 150_000;
      await running;
      expect(provider.callCount("destroy")).toBe(1);
    } finally { if (!finished) await supervisor.onLeaseLost(handoff.leaseId); await running; }
  });
  it("extends cleanup authority using the refreshed token without re-resolving secrets", async () => {
    const ctx = await setup();
    try {
      const renewed = { ...ctx.initial, expiresAt: 10_000, sig: "renewed" };
      ctx.supervisor.onAuthorityRenewed(ctx.handoff.leaseId, renewed);
      ctx.advance(6000); ctx.release(); await ctx.running;
      expect(ctx.refreshed).toEqual([renewed]);
      expect(ctx.provider.callCount("destroy")).toBe(1);
    } finally { ctx.release(); await ctx.running; }
  });
  it("refuses another lease binding and renewal after the fence closes", async () => {
    const ctx = await setup();
    try {
      const renewed = { ...ctx.initial, expiresAt: 10_000 };
      expect(() => ctx.supervisor.onAuthorityRenewed(ctx.handoff.leaseId, {
        ...renewed, ownedLabels: { ...renewed.ownedLabels, leaseId: "foreign" },
      })).toThrow("binding mismatch");
      await ctx.supervisor.onLeaseLost(ctx.handoff.leaseId);
      expect(() => ctx.supervisor.onAuthorityRenewed(ctx.handoff.leaseId, renewed)).toThrow("live fence");
      expect(ctx.refreshed).toEqual([]);
    } finally { ctx.release(); await ctx.running; }
  });
});

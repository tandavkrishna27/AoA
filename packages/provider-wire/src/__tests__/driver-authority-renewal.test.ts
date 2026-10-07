import { describe, expect, it } from "vitest";
import { NetworkedProviderDriver } from "../driver.js";
import type { OwnedLabelsCapability } from "../capability.js";

const initial: OwnedLabelsCapability = { v: 1, audience: "adapter-manager", expiresAt: 1_800_000_000_000, sig: "original",
  ownedLabels: { organizationId: "org", targetId: "target", workerId: "worker", jobId: "job", attempt: 1, leaseId: "lease", deviceGeneration: 1 } };
function setup(capability: OwnedLabelsCapability | null = initial) {
  const seen: unknown[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    seen.push(JSON.parse(String(init?.body)).capability);
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: { providerOpId: "destroy", outcome: "destroyed" } }) } as Response;
  }) as typeof fetch;
  return { driver: new NetworkedProviderDriver({ baseUrl: "http://adapter-manager", fetch: fetcher, capability: capability ?? undefined }), seen };
}
describe("networked provider authority renewal", () => {
  it("uses the refreshed token at the next provider operation", async () => {
    const ctx = setup();
    const renewed = { ...initial, expiresAt: initial.expiresAt + 120_000, sig: "renewed" };
    ctx.driver.refreshAuthority(renewed);
    await ctx.driver.destroy("owned", { deadlineMs: 1000, idempotencyKey: "cleanup" });
    expect(ctx.seen).toEqual([renewed]);
  });
  it.each(["organizationId", "targetId", "workerId", "jobId", "attempt", "leaseId", "deviceGeneration"] as const)(
    "refuses a changed %s binding", (field) => {
      const ctx = setup();
      const changed = { ...initial, expiresAt: initial.expiresAt + 120_000,
        ownedLabels: { ...initial.ownedLabels, [field]: typeof initial.ownedLabels[field] === "number" ? 2 : "foreign" } };
      expect(() => ctx.driver.refreshAuthority(changed)).toThrow();
    });
  it("refuses rollback, malformed tokens and refresh of an unbound driver", () => {
    const ctx = setup();
    expect(() => ctx.driver.refreshAuthority({ ...initial, expiresAt: initial.expiresAt - 1 })).toThrow();
    expect(() => ctx.driver.refreshAuthority({})).toThrow();
    expect(() => setup(null).driver.refreshAuthority(initial)).toThrow();
  });
});

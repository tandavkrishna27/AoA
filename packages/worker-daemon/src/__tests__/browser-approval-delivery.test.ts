import { describe, expect, it, vi } from "vitest";
import { deliverBrowserApproval } from "../supervisor/browser-approval-delivery.js";
import { EffectAuthority } from "../supervisor/effect-authority.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";

const now = Date.parse("2026-10-07T00:00:00Z");
const response = { requestId: "77777777-7777-4777-8777-777777777777", decision: "allow_once", expiresAt: new Date(now + 60_000).toISOString() };
function setup() {
  const provider = createFakeSandboxProvider();
  const deliver = vi.fn(async () => ({ providerOpId: "decision-write", delivered: true as const }));
  const execute = vi.spyOn(provider, "execute");
  const owned = { ...provider, deliverBrowserDecision: deliver };
  const effect = new EffectAuthority(owned, { jobId: "job", attempt: 1, leaseId: "lease", fenceToken: "fence", deviceGeneration: 1, observedSeq: 1 });
  return { execute, deliver, effect, input: { effect, sandboxId: "owned-sandbox", response, now: () => now,
    ctx: { deadlineMs: 60_000, idempotencyKey: "decision-write" } } };
}
describe("browser approval sandbox delivery", () => {
  it("writes only bounded decision metadata through effect authority", async () => {
    const ctx = setup(); await deliverBrowserApproval(ctx.input);
    expect(ctx.deliver).toHaveBeenCalledWith({ sandboxId: "owned-sandbox", response }, expect.objectContaining({ deadlineMs: 5000 }));
    expect(ctx.execute).not.toHaveBeenCalled();
  });
  it("refuses a withdrawn fence without a provider call", async () => {
    const ctx = setup(); ctx.effect.withdraw();
    await expect(deliverBrowserApproval(ctx.input)).rejects.toThrow("withdrawn");
    expect(ctx.deliver).not.toHaveBeenCalled();
  });
  it("refuses expired decisions and untrusted file identifiers", async () => {
    const ctx = setup();
    await expect(deliverBrowserApproval({ ...ctx.input, now: () => now + 60_000 })).rejects.toThrow();
    await expect(deliverBrowserApproval({ ...ctx.input, response: { ...response, requestId: "../escape" } })).rejects.toThrow();
    expect(ctx.deliver).not.toHaveBeenCalled();
  });
  it("refuses providers without the dedicated operation", async () => {
    const effect = new EffectAuthority(createFakeSandboxProvider(), { jobId: "job", attempt: 1, leaseId: "lease", fenceToken: "fence", deviceGeneration: 1, observedSeq: 1 });
    await expect(deliverBrowserApproval({ ...setup().input, effect })).rejects.toThrow("unavailable");
  });
  it("does not acknowledge a failed sandbox write", async () => {
    const ctx = setup(); ctx.deliver.mockRejectedValueOnce(new Error("browser approval write failed"));
    await expect(deliverBrowserApproval(ctx.input)).rejects.toThrow("write failed");
  });
});

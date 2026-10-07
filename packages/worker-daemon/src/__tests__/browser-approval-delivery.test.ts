import { describe, expect, it, vi } from "vitest";
import { deliverBrowserApproval } from "../supervisor/browser-approval-delivery.js";
import { EffectAuthority } from "../supervisor/effect-authority.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";

const now = Date.parse("2026-10-07T00:00:00Z");
const response = { requestId: "77777777-7777-4777-8777-777777777777", decision: "allow_once", expiresAt: new Date(now + 60_000).toISOString() };
function setup() {
  const provider = createFakeSandboxProvider();
  const execute = vi.spyOn(provider, "execute").mockResolvedValue({ providerOpId: "decision-write", exitCode: 0,
    signal: null, timedOut: false, stdoutRef: "", stderrRef: "" });
  const effect = new EffectAuthority(provider, { jobId: "job", attempt: 1, leaseId: "lease", fenceToken: "fence", deviceGeneration: 1, observedSeq: 1 });
  return { execute, effect, input: { effect, sandboxId: "owned-sandbox", response, now: () => now,
    ctx: { deadlineMs: 60_000, idempotencyKey: "decision-write" } } };
}
describe("browser approval sandbox delivery", () => {
  it("writes only bounded decision metadata through effect authority", async () => {
    const ctx = setup(); await deliverBrowserApproval(ctx.input);
    expect(ctx.execute).toHaveBeenCalledTimes(1);
    const [command, op] = ctx.execute.mock.calls[0];
    expect(command).toMatchObject({ sandboxId: "owned-sandbox", command: "node", env: {} });
    expect(command.args[2]).toBe(JSON.stringify(response));
    expect(op.deadlineMs).toBe(5000);
  });
  it("refuses a withdrawn fence without a provider call", async () => {
    const ctx = setup(); ctx.effect.withdraw();
    await expect(deliverBrowserApproval(ctx.input)).rejects.toThrow("withdrawn");
    expect(ctx.execute).not.toHaveBeenCalled();
  });
  it("refuses expired decisions and untrusted file identifiers", async () => {
    const ctx = setup();
    await expect(deliverBrowserApproval({ ...ctx.input, now: () => now + 60_000 })).rejects.toThrow();
    await expect(deliverBrowserApproval({ ...ctx.input, response: { ...response, requestId: "../escape" } })).rejects.toThrow();
    expect(ctx.execute).not.toHaveBeenCalled();
  });
  it("does not acknowledge a failed sandbox write", async () => {
    const ctx = setup(); ctx.execute.mockResolvedValueOnce({ providerOpId: "failed", exitCode: 1, signal: null,
      timedOut: false, stdoutRef: "", stderrRef: "" });
    await expect(deliverBrowserApproval(ctx.input)).rejects.toThrow("write failed");
  });
});

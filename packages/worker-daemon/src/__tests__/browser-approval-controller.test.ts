import { describe, expect, it, vi } from "vitest";
import { controlCommandV1Schema, type PermissionRuntimeDecisionRequestV1 } from "@armyofagents/worker-protocol";
import { createBrowserApprovalController } from "../supervisor/browser-approval.js";

const identity = { organizationId: "11111111-1111-4111-8111-111111111111", companyId: "22222222-2222-4222-8222-222222222222",
  workerId: "33333333-3333-4333-8333-333333333333", jobId: "44444444-4444-4444-8444-444444444444", attempt: 1,
  leaseId: "55555555-5555-4555-8555-555555555555", fenceToken: "66666666-6666-4666-8666-666666666666" };
const now = Date.parse("2026-10-07T00:00:00.000Z");
const message = { type: "approval_requested", requestId: "77777777-7777-4777-8777-777777777777", expiresAt: new Date(now + 60_000).toISOString(),
  intent: { action: "navigate", title: "Navigate to https://example.com", summary: null, networkTarget: "https://example.com", riskClass: "network_egress" } };

function setup() {
  const requests: PermissionRuntimeDecisionRequestV1[] = [];
  const deliver = vi.fn(async () => {});
  const controller = createBrowserApprovalController({ identity, now: () => now, deadlineAt: now + 120_000,
    scrubText: (text) => text.replaceAll("credential-canary", "[REDACTED]"),
    emit: async (request) => { requests.push(request); }, deliver });
  const command = (request: PermissionRuntimeDecisionRequestV1) => controlCommandV1Schema.parse({
    ...identity, protocolVersion: 1, audience: "control_channel", commandId: "88888888-8888-4888-8888-888888888888", commandSeq: 1,
    idempotencyKey: "88888888-8888-4888-8888-888888888888", issuedAt: new Date(now).toISOString(), nonce: "control-nonce", commandKind: "runtime_decision_result",
    result: { decisionKind: "permission", requestId: request.requestId, nonce: request.nonce, requestDigest: request.requestDigest,
      schemaVersion: request.schemaVersion, sourceRevision: request.sourceRevision, expiresAt: request.expiresAt, timeoutPolicy: request.timeoutPolicy,
      decidedBy: { principalType: "user", principalId: "founder" }, decidedAt: new Date(now).toISOString(), idempotencyKey: "88888888-8888-4888-8888-888888888888", decision: "allow_once" },
  });
  return { controller, requests, deliver, command };
}

describe("fenced browser approval controller", () => {
  it("emits a scrubbed frozen request once and delivers its matched decision", async () => {
    const ctx = setup();
    await ctx.controller.request({ ...message, intent: { ...message.intent, title: "credential-canary" } });
    await ctx.controller.request({ ...message, intent: { ...message.intent, title: "credential-canary" } });
    expect(ctx.requests).toHaveLength(1);
    expect(JSON.stringify(ctx.requests[0])).not.toContain("credential-canary");
    await ctx.controller.apply(ctx.command(ctx.requests[0]));
    expect(ctx.deliver).toHaveBeenCalledWith({ requestId: message.requestId, decision: "allow_once", expiresAt: message.expiresAt });
  });

  it.each(["companyId", "leaseId", "requestDigest", "sourceRevision"])("refuses a mismatched %s without delivering", async (field) => {
    const ctx = setup(); await ctx.controller.request(message);
    const command = ctx.command(ctx.requests[0]);
    if (field === "companyId" || field === "leaseId") command[field] = "99999999-9999-4999-8999-999999999999";
    else if (command.commandKind === "runtime_decision_result") {
      if (field === "requestDigest") command.result.requestDigest = "a".repeat(64);
      else command.result.sourceRevision++;
    }
    await expect(ctx.controller.apply(command)).rejects.toThrow();
    expect(ctx.deliver).not.toHaveBeenCalled();
  });

  it("withdraws pending actions when the run closes", async () => {
    const ctx = setup(); await ctx.controller.request(message); ctx.controller.close();
    await expect(ctx.controller.apply(ctx.command(ctx.requests[0]))).rejects.toThrow();
    await expect(ctx.controller.request(message)).rejects.toThrow();
    expect(ctx.deliver).not.toHaveBeenCalled();
  });

  it("coalesces concurrent delivery of the same matched decision", async () => {
    const ctx = setup(); await ctx.controller.request(message);
    let release!: () => void;
    ctx.deliver.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = ctx.controller.apply(ctx.command(ctx.requests[0]));
    const second = ctx.controller.apply(ctx.command(ctx.requests[0]));
    expect(ctx.deliver).toHaveBeenCalledTimes(1);
    release(); await Promise.all([first, second]);
    await ctx.controller.apply(ctx.command(ctx.requests[0]));
    expect(ctx.deliver).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from "vitest";
import { createBrowserApprovalController } from "../../../packages/worker-daemon/src/supervisor/browser-approval.js";
import { runtimeDecisionPromptHash } from "../services/agent-runtime-decisions.js";

describe("browser approval prompt binding across server and worker", () => {
  it("hashes the same scrubbed prompt bytes on both sides", async () => {
    const now = Date.parse("2026-10-07T00:00:00Z");
    const controller = createBrowserApprovalController({
      identity: { organizationId: "11111111-1111-4111-8111-111111111111", companyId: "22222222-2222-4222-8222-222222222222",
        workerId: "33333333-3333-4333-8333-333333333333", jobId: "44444444-4444-4444-8444-444444444444", attempt: 1,
        leaseId: "55555555-5555-4555-8555-555555555555", fenceToken: "66666666-6666-4666-8666-666666666666" },
      now: () => now, deadlineAt: now + 120_000, scrubText: (text) => text.replaceAll("secret-canary", "[REDACTED]"),
      emit: async () => {}, deliver: async () => {},
    });
    const request = await controller.request({ type: "approval_requested", requestId: "77777777-7777-4777-8777-777777777777",
      expiresAt: new Date(now + 60_000).toISOString(),
      intent: { action: "navigate", title: "Visit secret-canary", summary: "Requested destination", networkTarget: "https://example.com", riskClass: "network_egress" } });
    expect(request.title).toBe("Visit [REDACTED]");
    expect(request.requestDigest).toBe(runtimeDecisionPromptHash({ kind: "permission", title: request.title,
      summary: request.summary, promptText: null, command: null }));
  });
});

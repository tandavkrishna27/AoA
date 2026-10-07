import { describe, expect, it, vi } from "vitest";
import { type PermissionRuntimeDecisionRequestV1 } from "@armyofagents/worker-protocol";
import { createBrowserSessionGrantConsumer, readBrowserSessionBinding, readBrowserSessionGrants } from "../supervisor/browser-session-grants.js";

const binding = { bindingId: "11111111-1111-4111-8111-111111111111", origin: "https://example.com", policyDigest: "a".repeat(64) };
const extension = { namespace: "com.armyofagents.browser/session-binding", schemaVersion: 1, critical: false, value: binding };
describe("trusted browser session extensions", () => {
  it("reads a unique binding matching the enforced policy", () => {
    expect(readBrowserSessionBinding([extension], binding.policyDigest)).toEqual(binding);
    expect(readBrowserSessionBinding([], binding.policyDigest)).toBeNull();
  });
  it.each([
    [extension, extension], [{ ...extension, critical: true }],
    [{ ...extension, value: { ...binding, origin: "https://example.com/path" } }],
    [{ ...extension, value: { ...binding, token: "forbidden" } }],
  ])("refuses ambiguous or overbroad binding %#", (extensions) => {
    expect(() => readBrowserSessionBinding(extensions, binding.policyDigest)).toThrow();
  });
  it("refuses mismatched policy and malformed credential grants", () => {
    expect(() => readBrowserSessionBinding([extension], "b".repeat(64))).toThrow();
    expect(readBrowserSessionGrants([])).toEqual([]);
    expect(() => readBrowserSessionGrants([{ namespace: "com.armyofagents.browser/session-credential-grants", schemaVersion: 1,
      critical: false, value: { grants: [{ requestId: binding.bindingId, bindingId: binding.bindingId, policyDigest: binding.policyDigest, grant: {} }] } }])).toThrow();
  });
  it("requires an allowed request, coalesces grants, and refuses delivery after fence closure", async () => {
    const now = Date.now(), requestId = binding.bindingId;
    const request = { requestId, nonce: binding.bindingId, summary: binding.policyDigest, networkTarget: binding.origin,
      toolName: "browser.session_credentials", expiresAt: new Date(now + 30000).toISOString() } as PermissionRuntimeDecisionRequestV1;
    let active = true, allowed = false;
    const deliver = vi.fn(async () => {}), consume = vi.fn();
    const consumer = createBrowserSessionGrantConsumer({ binding, objectPrefix: "organizations/org/jobs/job/attempts/1/", now: () => now,
      isActive: () => active, approved: () => allowed ? request : null, consume, deliver });
    const entry = { requestId, bindingId: binding.bindingId, policyDigest: binding.policyDigest, grant: {
      protocolVersion: 1 as const, operation: "download" as const, artifactId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", method: "GET" as const,
      url: "https://cp.example/api/worker-control/browser-session-credentials/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?grant=opaque", headers: {},
      issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 10000).toISOString(), maxBytes: 100,
      expectedSha256: "a".repeat(64), objectKey: "organizations/org/jobs/job/attempts/1/browser-session/artifact", redaction: "secret" as const,
    } };
    await expect(consumer.apply(entry)).rejects.toThrow();
    expect(deliver).not.toHaveBeenCalled();
    allowed = true;
    await expect(consumer.apply({ ...entry, policyDigest: "b".repeat(64) })).rejects.toThrow();
    await Promise.all([consumer.apply(entry), consumer.apply(entry)]);
    await consumer.apply(entry);
    expect(deliver).toHaveBeenCalledTimes(1); expect(consume).toHaveBeenCalledWith(requestId);
    active = false;
    await expect(consumer.apply(entry)).rejects.toThrow();
  });
});

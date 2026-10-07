import { describe, expect, it } from "vitest";
import { parseBrowserPreparation } from "../services/browser-runtime-preparation.js";
import { parseDistributedNetworkPolicies } from "../config/distributed-network-policies.js";
const id = "a6000000-0000-4000-8000-000000000001";
const networkPolicy = parseDistributedNetworkPolicies(JSON.stringify({ [id]: { [id]: { policyId: "commander", version: 1, allow: [{ scheme: "https", host: "example.com", port: 443 }] } } })).get(`${id}:${id}`)!;
const base = { requestDigest: "a".repeat(64), runId: id, parentJobId: id, parentAttemptId: id, parentLeaseId: id,
  targetId: id, targetAuthorityKey: "authority", targetGeneration: 1, profileHash: "b".repeat(64), providerConstraintHash: "c".repeat(64), targetProfileHash: "d".repeat(64), networkPolicy };
describe("Commander browser trusted preparation", () => {
  it("admits an explicit human-owned anonymous variant without inventing agent/task", () => {
    expect(parseBrowserPreparation({ ...base, schemaVersion: 2, principalKind: "commander", userId: "human-not-a-uuid", conversationId: id, agentId: null, issueId: null })).not.toBeNull();
  });
  it("rejects mixed identities, bindings and unknown fields", () => {
    const commander = { ...base, schemaVersion: 2, principalKind: "commander", userId: id, conversationId: id, agentId: null, issueId: null };
    for (const extra of [{ agentId: id }, { issueId: id }, { sessionBinding: {} }, { turnId: id }, { userId: undefined }]) expect(parseBrowserPreparation({ ...commander, ...extra })).toBeNull();
    expect(parseBrowserPreparation({ ...base, schemaVersion: 1, agentId: id, issueId: id })).not.toBeNull();
  });
});

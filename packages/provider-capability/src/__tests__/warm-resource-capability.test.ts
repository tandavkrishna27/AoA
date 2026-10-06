import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signWarmResourceCapability, verifyWarmResourceCapability, type WarmResourceCapabilityFields } from "../warm-resource-capability.js";
const keys = generateKeyPairSync("ed25519");
const physical = { organizationId: "org", targetId: "target", workerId: "worker", jobId: "old-job", attempt: 1, leaseId: "old-lease", deviceGeneration: 1 };
const current = { ...physical, jobId: "new-job", leaseId: "new-lease", attempt: 2 };
const fields: WarmResourceCapabilityFields = { v: 1, audience: "adapter-manager-warm-resource", sessionId: "session", generation: 2, resourceId: "sandbox", physicalLabels: physical, ownedLabels: current, previousCapabilityExpiresAt: 100, issuedAt: 100, expiresAt: 200 };
function verify(value: unknown, overrides = {}) {
  return verifyWarmResourceCapability(value, keys.publicKey, { nowMs: 150, resourceId: "sandbox", ownedLabels: current, primaryExpiresAt: 200, ...overrides });
}
describe("signed retained resource handoff", () => {
  it("binds one physical resource to one fresh lease without mutating primary capability v1", () => {
    const token = signWarmResourceCapability(fields, keys.privateKey);
    expect(verify(token)).toEqual(token);
    expect(verify(token, { nowMs: 200 })).toBeNull();
    expect(verify(token, { nowMs: 99 })).toBeNull();
  });
  it.each(["sessionId", "generation", "resourceId", "previousCapabilityExpiresAt", "issuedAt", "expiresAt", "audience", "v"])("signs %s", (key) => {
    const token = signWarmResourceCapability(fields, keys.privateKey);
    expect(verify({ ...token, [key]: typeof token[key as keyof typeof token] === "number" ? 3 : "changed" })).toBeNull();
  });
  it.each(["organizationId", "targetId", "workerId", "jobId", "attempt", "leaseId", "deviceGeneration"])("signs physical and current %s", (key) => {
    const token = signWarmResourceCapability(fields, keys.privateKey);
    for (const labelField of ["physicalLabels", "ownedLabels"] as const) {
      const labels = token[labelField];
      expect(verify({ ...token, [labelField]: { ...labels, [key]: typeof labels[key as keyof typeof labels] === "number" ? 9 : "changed" } })).toBeNull();
    }
  });
  it("refuses another resource, lease, shortened primary expiry and signer", () => {
    const token = signWarmResourceCapability(fields, keys.privateKey);
    expect(verify(token, { resourceId: "another" })).toBeNull();
    expect(verify(token, { ownedLabels: physical })).toBeNull();
    expect(verify(token, { primaryExpiresAt: 199 })).toBeNull();
    expect(verifyWarmResourceCapability(token, generateKeyPairSync("ed25519").publicKey, { nowMs: 150, resourceId: "sandbox", ownedLabels: current, primaryExpiresAt: 200 })).toBeNull();
  });
  it.each([
    { previousCapabilityExpiresAt: 101 }, { expiresAt: 100 }, { issuedAt: NaN }, { generation: 0 },
    { physicalLabels: { ...physical, organizationId: "other" } },
    { physicalLabels: { ...physical, targetId: "other" } },
    { physicalLabels: { ...physical, deviceGeneration: 2 } },
  ])("refuses unsafe signing inputs %j", (overrides) => {
    expect(() => signWarmResourceCapability({ ...fields, ...overrides }, keys.privateKey)).toThrow();
  });
  it.each([null, {}, [], "token", { ...fields, sig: "junk" }])("fails closed on malformed input %j", (value) => {
    expect(verify(value)).toBeNull();
  });
});

import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signOwnedLabelsCapability } from "../../../provider-capability/src/capability.js";
import { signWarmResourceCapability } from "../../../provider-capability/src/warm-resource-capability.js";
import { readCommanderWarmControl } from "../lease/commander-warm-control.js";
const keys = generateKeyPairSync("ed25519");
const current = { organizationId: "org", targetId: "target", workerId: "worker", jobId: "new-job",
  attempt: 2, leaseId: "new-lease", deviceGeneration: 1 };
const physical = { ...current, jobId: "old-job", attempt: 1, leaseId: "old-lease" };
const primary = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: current, expiresAt: 2000 }, keys.privateKey);
const sessionId = "11111111-1111-4111-8111-111111111111";
const grant = signWarmResourceCapability({ v: 1, audience: "adapter-manager-warm-resource", sessionId, generation: 2,
  resourceId: "retained-vm", physicalLabels: physical, ownedLabels: current,
  previousCapabilityExpiresAt: 1000, issuedAt: 1000, expiresAt: 2000 }, keys.privateKey);
const control = { version: 1, sessionId, generation: 2, mode: "resume", resourceId: "retained-vm",
  idleTtlMs: 1800000, historicalCanaries: ["old-value"], warmResourceCapability: grant };
describe("vendored warm control shape and signed capability binding", () => {
  it("carries a real signed exact-resource grant and copies protected metadata", () => {
    const parsed = readCommanderWarmControl(control, primary);
    expect(parsed).toEqual(control);
    expect(parsed).not.toBe(control);
    expect(parsed?.historicalCanaries).not.toBe(control.historicalCanaries);
    expect(parsed?.warmResourceCapability?.physicalLabels).not.toBe(grant.physicalLabels);
  });
  it.each(["organizationId", "targetId", "workerId", "jobId", "attempt", "leaseId", "deviceGeneration"] as const)("refuses a changed current %s binding", (key) => {
    const changed = { ...grant, ownedLabels: { ...current, [key]: typeof current[key] === "number" ? 99 : "other" } };
    expect(readCommanderWarmControl({ ...control, warmResourceCapability: changed }, primary)).toBeNull();
  });
  it.each([
    { sessionId: "22222222-2222-4222-8222-222222222222" }, { generation: 3 }, { resourceId: "another-vm" },
    { expiresAt: 2001 }, { issuedAt: 999 }, { previousCapabilityExpiresAt: 1001 }, { sig: "junk" },
  ])("refuses inconsistent or unsafe grant fields %j", (fields) => {
    expect(readCommanderWarmControl({ ...control, warmResourceCapability: { ...grant, ...fields } }, primary)).toBeNull();
  });
  it("refuses create metadata carrying a retained-resource grant", () => {
    expect(readCommanderWarmControl({ ...control, mode: "create", generation: 1, resourceId: null }, primary)).toBeNull();
  });
});

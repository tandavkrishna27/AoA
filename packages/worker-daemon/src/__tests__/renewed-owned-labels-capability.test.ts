import { describe, expect, it } from "vitest";
import { readRenewedOwnedLabelsCapability, OWNED_LABELS_CAPABILITY_EXTENSION_NAMESPACE } from "../lease/renewed-owned-labels-capability.js";

const cap = { v: 1, audience: "adapter-manager", expiresAt: 1_800_000_000_000, sig: "signed-token",
  ownedLabels: { organizationId: "org", targetId: "target", workerId: "worker", jobId: "job", attempt: 1, leaseId: "lease", deviceGeneration: 1 } };
const extension = (value: unknown = cap) => ({ namespace: OWNED_LABELS_CAPABILITY_EXTENSION_NAMESPACE, schemaVersion: 1, critical: false, value });
describe("renewed owned-labels capability extension", () => {
  it("preserves absent and unknown optional extensions", () => {
    expect(readRenewedOwnedLabelsCapability(undefined)).toBeNull();
    expect(readRenewedOwnedLabelsCapability([{ namespace: "other.dev/data", value: {} }])).toBeNull();
  });
  it("reads the server's capability without changing its signed fields", () => {
    expect(readRenewedOwnedLabelsCapability([extension()])).toEqual(cap);
  });
  it.each([{ ...cap, expiresAt: NaN }, { ...cap, expiresAt: 1.5 }, { ...cap, v: 2 }, { ...cap, audience: "wrong" }, { ...cap, sig: "" }, {}])(
    "refuses a present malformed capability", (value) => {
      expect(() => readRenewedOwnedLabelsCapability([extension(value)])).toThrow();
    });
  it("refuses ambiguous duplicates and unsupported versions", () => {
    expect(() => readRenewedOwnedLabelsCapability([extension(), extension()])).toThrow();
    expect(() => readRenewedOwnedLabelsCapability([{ ...extension(), schemaVersion: 2 }])).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { decideCommanderWarmClaim } from "../services/commander-warm-authority.js";
const input = { organizationId: "org", companyId: "company", conversationId: "conversation", userId: "user", jobId: "next-job",
  attemptId: "next-attempt", targetId: "target", workerId: "worker", targetGeneration: 4, nowMs: 1000,
  activeMembership: true, supportsCheckpoint: true, supportsRestore: true };
const session = { organizationId: "org", companyId: "company", conversationId: "conversation", userId: "user", status: "paused" as const,
  targetId: "target", workerId: "worker", targetGeneration: 4, generation: 2, expiresAtMs: 2000,
  resourceId: "provider-resource", resourceLabels: { organizationId: "org", targetId: "target", workerId: "worker", jobId: "previous-job",
    attempt: 1, leaseId: "previous-lease", deviceGeneration: 4 }, previousFenceRetired: true, previousCapabilityExpiresAtMs: 500, acceptedCheckpoint: true,
  currentJobId: null, currentAttemptId: null };
describe("Commander warm resource claim authority", () => {
  it("creates a cold first resource only with current owner and pause/restore support", () => {
    expect(decideCommanderWarmClaim(input, null)).toEqual({ action: "create", generation: 1 });
  });
  it("resumes only the actual owned paused resource under a new claim generation", () => {
    expect(decideCommanderWarmClaim(input, session)).toEqual({ action: "resume", generation: 3, resourceId: "provider-resource", resourceLabels: session.resourceLabels });
  });
  it.each(["organizationId", "companyId", "conversationId", "userId", "targetId", "workerId"])("denies mismatched %s", (key) => {
    expect(decideCommanderWarmClaim(input, { ...session, [key]: "foreign" })).toMatchObject({ action: "deny" });
  });
  it.each(["activeMembership", "supportsCheckpoint", "supportsRestore"])("denies missing %s before create or resume", (key) => {
    expect(decideCommanderWarmClaim({ ...input, [key]: false }, null)).toMatchObject({ action: "deny" });
    expect(decideCommanderWarmClaim({ ...input, [key]: false }, session)).toMatchObject({ action: "deny" });
  });
  it.each(["previousFenceRetired", "acceptedCheckpoint"])("denies a snapshot without %s", (key) => {
    expect(decideCommanderWarmClaim(input, { ...session, [key]: false })).toMatchObject({ action: "deny" });
  });
  it("rejects expiry at the boundary, target re-enrollment, and contradictory physical labels", () => {
    expect(decideCommanderWarmClaim({ ...input, nowMs: 2000 }, session)).toMatchObject({ action: "deny" });
    expect(decideCommanderWarmClaim(input, { ...session, targetGeneration: 5 })).toMatchObject({ action: "deny" });
    expect(decideCommanderWarmClaim(input, { ...session, resourceLabels: { ...session.resourceLabels, organizationId: "foreign" } })).toMatchObject({ action: "deny" });
  });
  it("does not overlap a previous signed provider capability with a fresh claim", () => {
    expect(decideCommanderWarmClaim(input, { ...session, previousCapabilityExpiresAtMs: 1001 })).toMatchObject({ action: "deny" });
    expect(decideCommanderWarmClaim(input, { ...session, previousCapabilityExpiresAtMs: 1000 })).toMatchObject({ action: "resume" });
    expect(decideCommanderWarmClaim(input, { ...session, previousCapabilityExpiresAtMs: NaN })).toMatchObject({ action: "deny" });
  });
  it("rejects invalid clocks and target generations before first creation", () => {
    expect(decideCommanderWarmClaim({ ...input, nowMs: NaN }, null)).toMatchObject({ action: "deny" });
    expect(decideCommanderWarmClaim({ ...input, targetGeneration: 0 }, null)).toMatchObject({ action: "deny" });
  });
  it("never assigns an active, quarantined or retired resource to another job", () => {
    for (const status of ["claimed", "quarantined", "retired"] as const) {
      expect(decideCommanderWarmClaim(input, { ...session, status, currentJobId: "other-job", currentAttemptId: "other-attempt" })).toMatchObject({ action: "deny" });
    }
  });
});

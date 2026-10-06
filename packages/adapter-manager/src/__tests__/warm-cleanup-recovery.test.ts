import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { WarmCleanupJournal } from "../warm-cleanup-journal.js";
import { createWarmCleanupRecovery } from "../warm-cleanup-recovery.js";
const labels = { organizationId: "org", targetId: "target", workerId: "worker", jobId: "job", attempt: 1, leaseId: "lease", deviceGeneration: 1 };
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "aoa-warm-recover-")); const journal = new WarmCleanupJournal(dir);
  journal.register("vm", labels); journal.plan("vm", labels);
  const resolveTruth = vi.fn(async () => new Map([["vm", "orphan" as const]]));
  const reconcileCleanup = vi.fn(async () => ({ providerOpId: "op", cleanupStatus: "success" as const }));
  const acknowledge = vi.fn(async () => false);
  const recovery = createWarmCleanupRecovery({ journal, resolveTruth, provider: { reconcileCleanup },
    makeCtx: () => ({ deadlineMs: 5000, idempotencyKey: "cleanup" }), acknowledge });
  return { dir, journal, resolveTruth, reconcileCleanup, acknowledge, recovery };
}
describe("warm cleanup restart recovery", () => {
  it("does not retry physical cleanup on unknown truth or CP outage", async () => {
    const run = setup(); run.resolveTruth.mockResolvedValue(new Map()); await run.recovery.tick();
    expect(run.reconcileCleanup).not.toHaveBeenCalled(); expect(run.acknowledge).not.toHaveBeenCalled();
    run.resolveTruth.mockRejectedValue(new Error("offline")); await run.recovery.tick();
    expect(run.reconcileCleanup).not.toHaveBeenCalled(); expect(run.journal.pending()[0].status).toBe("planned");
  });
  it("persists physical success before acknowledgement and retries only the receipt", async () => {
    const run = setup(); await run.recovery.tick();
    expect(new WarmCleanupJournal(run.dir).pending()[0].status).toBe("confirmed");
    run.acknowledge.mockResolvedValue(true); await run.recovery.tick();
    expect(run.reconcileCleanup).toHaveBeenCalledTimes(1); expect(run.resolveTruth).toHaveBeenCalledTimes(1);
    expect(run.acknowledge).toHaveBeenLastCalledWith({ resourceId: "vm", physicalLabels: labels, status: "confirmed", providerOpId: "op" });
    expect(run.journal.pending()).toEqual([]);
  });
  it("coalesces overlapping sweeps", async () => {
    const run = setup(); const first = run.recovery.tick(); expect(run.recovery.tick()).toBe(first);
    await first; expect(run.reconcileCleanup).toHaveBeenCalledTimes(1);
  });
  it("contains acknowledgement errors and preserves the durable receipt", async () => {
    const run = setup(); run.acknowledge.mockRejectedValue(new Error("offline"));
    await expect(run.recovery.tick()).resolves.toBeUndefined();
    expect(run.journal.pending()[0]).toMatchObject({ status: "confirmed", providerOpId: "op" });
  });
});

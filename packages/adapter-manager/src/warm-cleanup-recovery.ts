import type { ProviderOpContext, ResourceSummary, SandboxProvider } from "@armyofagents/worker-daemon";
import type { ResolveTruth } from "./reconcile-reaper.js";
import type { PendingWarmCleanup, WarmCleanupJournal } from "./warm-cleanup-journal.js";
/** Recover interrupted physical cleanup and retry exact CP acknowledgements on
 * the existing reaper cadence. A planned record is not death authority: a fresh
 * positive orphan verdict is required before every provider retry. */
export function createWarmCleanupRecovery(deps: {
  journal: WarmCleanupJournal; resolveTruth: ResolveTruth;
  provider: Pick<SandboxProvider, "reconcileCleanup">; makeCtx(): ProviderOpContext;
  acknowledge(record: PendingWarmCleanup & { providerOpId: string }): Promise<boolean>;
}) {
  let running: Promise<void> | null = null;
  const sweep = async () => {
    const pending = deps.journal.pending();
    const planned: ResourceSummary[] = pending.filter((record) => record.status === "planned").map((record) => ({
      sandboxId: record.resourceId, resourceLabels: record.physicalLabels, generation: record.physicalLabels.deviceGeneration,
      state: "stopped", hasLiveLease: false }));
    let truth: ReadonlyMap<string, "orphan" | "live" | "unknown"> = new Map();
    try { if (planned.length) truth = await deps.resolveTruth(planned); } catch { /* no positive authority */ }
    for (const record of pending) {
      try {
        let providerOpId = record.providerOpId;
        if (record.status === "planned") {
          if (truth.get(record.resourceId) !== "orphan") continue;
          const result = await deps.provider.reconcileCleanup(record.resourceId, deps.makeCtx());
          if (result.cleanupStatus !== "success") continue;
          deps.journal.confirm(record.resourceId, record.physicalLabels, result.providerOpId);
          providerOpId = result.providerOpId;
        }
        if (!providerOpId) continue;
        if (await deps.acknowledge({ ...record, status: "confirmed", providerOpId })) {
          deps.journal.acknowledge(record.resourceId, record.physicalLabels);
        }
      } catch { /* durable record remains pending; retry on the next sweep */ }
    }
  };
  return { tick(): Promise<void> {
    if (running) return running;
    running = sweep().finally(() => { running = null; }); return running;
  } };
}

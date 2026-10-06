import { labelsEqual, type ResourceLabels } from "@armyofagents/worker-daemon";
import type { ResolveTruth } from "./reconcile-reaper.js";
import { TRUTH_SHARED_SECRET_HEADER } from "./reaper-truth-client.js";
import type { PendingWarmCleanup } from "./warm-cleanup-journal.js";
export const RESOURCE_TRUTH_PATH = "/api/adapter-manager-control/resource-truth";
export const RESOURCE_RECLAIMED_PATH = "/api/adapter-manager-control/resource-reclaimed";
interface ResourceRecord { resourceId: string; physicalLabels: ResourceLabels; verdict: unknown }
async function post(baseUrl: string, path: string, payload: unknown, bearer: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(baseUrl.replace(/\/+$/, "") + path, { method: "POST",
    headers: { "content-type": "application/json", [TRUTH_SHARED_SECRET_HEADER]: bearer },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("warm resource truth unavailable");
  const bytes = await response.text();
  if (Buffer.byteLength(bytes, "utf8") > 262144) throw new Error("warm resource truth unavailable");
  return JSON.parse(bytes);
}
/** Only the frozen oracle's positive orphans need resource-level confirmation.
 * A failed/older peer cannot turn a retained VM into an orphan. Default lease
 * client bytes and classifications are unchanged unless this wrapper is selected. */
export function makeWarmResourceResolveTruth(options: { baseUrl: string; bearer: string; leaseTruth: ResolveTruth; fetch?: typeof fetch }): ResolveTruth {
  const fetchImpl = options.fetch ?? fetch;
  return async (summaries) => {
    const result = new Map(await options.leaseTruth(summaries));
    const candidates = summaries.filter((resource) => result.get(resource.sandboxId) === "orphan");
    for (let offset = 0; offset < candidates.length; offset += 128) {
      const batch = candidates.slice(offset, offset + 128);
      for (const resource of batch) result.set(resource.sandboxId, "unknown");
      try {
        const body = await post(options.baseUrl, RESOURCE_TRUTH_PATH, { resources: batch.map((resource) => ({
          resourceId: resource.sandboxId, physicalLabels: resource.resourceLabels })) }, options.bearer, fetchImpl) as { verdicts?: unknown };
        if (!body || !Array.isArray(body.verdicts) || body.verdicts.length > 128) continue;
        for (const resource of batch) {
          const matches = body.verdicts.filter((value): value is ResourceRecord => {
            if (!value || typeof value !== "object") return false;
            const row = value as ResourceRecord;
            return row.resourceId === resource.sandboxId && row.physicalLabels && typeof row.physicalLabels === "object" &&
              labelsEqual(row.physicalLabels, resource.resourceLabels);
          });
          if (matches.length !== 1) continue;
          if (matches[0].verdict === "retained") result.set(resource.sandboxId, "live");
          if (matches[0].verdict === "orphan") result.set(resource.sandboxId, "orphan");
        }
      } catch { /* all affected resources stay unknown */ }
    }
    return result;
  };
}
export function makeWarmResourceAcknowledger(options: { baseUrl: string; bearer: string; fetch?: typeof fetch }) {
  return async (record: PendingWarmCleanup & { providerOpId: string }): Promise<boolean> => {
    try {
      const body = await post(options.baseUrl, RESOURCE_RECLAIMED_PATH, { resourceId: record.resourceId,
        physicalLabels: record.physicalLabels, providerOpId: record.providerOpId }, options.bearer, options.fetch ?? fetch) as { acknowledged?: unknown };
      return body?.acknowledged === true;
    } catch { return false; }
  };
}

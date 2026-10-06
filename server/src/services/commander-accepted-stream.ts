import { and, asc, desc, eq, gt } from "drizzle-orm";
import { jobAttempts, jobEvents, leases, type Db } from "@armyofagents/db";
import { logPayloadV1Schema } from "@armyofagents/worker-protocol";
import { runInTenant } from "../db/tenant-context.js";
import { loadCommanderJobAuthority } from "./commander-job-authority.js";
import type { OneShotResultScope } from "./one-shot-distributed-result.js";
export const COMMANDER_STREAM_LOG_PREFIX = "aoa-commander-stream-v1:";
/** Read only the immutable accepted-event ledger. No worker socket or raw provider stream. */
export function createCommanderAcceptedStreamReader(appDb: Db) {
  return async (scope: OneShotResultScope, afterSequence: number, signal?: AbortSignal): Promise<{ sequence: number; text: string }[]> => {
    if (signal?.aborted) throw new Error("Commander stream read aborted");
    const lines = await runInTenant(appDb, scope.organizationId, async (_repos, tx) => {
      const authority = await loadCommanderJobAuthority(tx, scope);
      if (!authority || authority.turnId !== scope.operationId || authority.executionOwner !== "distributed" ||
        authority.distributedJobId !== scope.jobId || authority.distributedAttemptId !== scope.attemptId) {
        throw new Error("Commander stream authority mismatch");
      }
      const [latest] = await tx.select({ id: jobAttempts.id }).from(jobAttempts).where(and(
        eq(jobAttempts.organizationId, scope.organizationId), eq(jobAttempts.companyId, scope.companyId),
        eq(jobAttempts.jobId, scope.jobId))).orderBy(desc(jobAttempts.attemptNumber)).limit(1);
      if (latest?.id !== scope.attemptId) throw new Error("Commander stream attempt authority mismatch");
      const rows = await tx.select({ sequence: jobEvents.sequence, event: jobEvents.event }).from(jobEvents)
        .innerJoin(leases, and(eq(leases.id, jobEvents.leaseId), eq(leases.organizationId, jobEvents.organizationId),
          eq(leases.companyId, jobEvents.companyId), eq(leases.jobId, jobEvents.jobId), eq(leases.attemptId, jobEvents.attemptId),
          eq(leases.attemptNumber, jobEvents.attemptNumber), eq(leases.fence, jobEvents.fenceToken)))
        .where(and(eq(jobEvents.organizationId, scope.organizationId), eq(jobEvents.companyId, scope.companyId),
          eq(jobEvents.jobId, scope.jobId), eq(jobEvents.attemptId, scope.attemptId), eq(jobEvents.eventType, "log"),
          gt(jobEvents.sequence, afterSequence))).orderBy(asc(jobEvents.sequence)).limit(512);
      return rows.flatMap((row) => {
        const parsed = logPayloadV1Schema.safeParse(row.event.payload);
        if (!parsed.success || parsed.data.stream !== "stdout" || !parsed.data.message.startsWith(COMMANDER_STREAM_LOG_PREFIX)) return [];
        return [{ sequence: row.sequence, text: parsed.data.message.slice(COMMANDER_STREAM_LOG_PREFIX.length) }];
      });
    });
    if (signal?.aborted) throw new Error("Commander stream read aborted");
    return lines;
  };
}

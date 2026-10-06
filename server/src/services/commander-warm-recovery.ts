import { and, asc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { companies, internalAgentRuns, type Db } from "@armyofagents/db";
import type { JobEventIngestTerminalHook } from "./job-events.js";
import type { CommanderWarmProjectionScope } from "./commander-warm-projection.js";
export type CommanderWarmRecoveryCandidate = CommanderWarmProjectionScope & { operationId: string };
export function createCommanderWarmRecoveryReader(ownerDb: Db) {
  return async (cursor: string | null): Promise<CommanderWarmRecoveryCandidate[]> => ownerDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('statement_timeout', '5000ms', true)`);
    const rows = await tx.select({ operationId: internalAgentRuns.id, companyId: internalAgentRuns.companyId,
      jobId: internalAgentRuns.distributedJobId, attemptId: internalAgentRuns.distributedAttemptId,
      organizationId: companies.organizationId }).from(internalAgentRuns)
      .innerJoin(companies, eq(companies.id, internalAgentRuns.companyId))
      .where(and(eq(internalAgentRuns.executionOwner, "distributed"), eq(internalAgentRuns.triggerType, "conversation"),
        isNotNull(internalAgentRuns.distributedWarmState),
        sql`${internalAgentRuns.distributedWarmState} ->> 'status' = 'claimed'`,
        cursor ? gt(internalAgentRuns.id, cursor) : undefined)).orderBy(asc(internalAgentRuns.id)).limit(32);
    return rows.flatMap((row) => row.organizationId && row.jobId && row.attemptId ? [{ ...row,
      organizationId: row.organizationId, jobId: row.jobId, attemptId: row.attemptId }] : []);
  });
}
/** After-commit projection errors cannot suppress another terminal consumer. */
export function createCommanderWarmTerminalHook(deps: {
  project(scope: CommanderWarmProjectionScope): Promise<unknown>; downstream?: JobEventIngestTerminalHook;
  onError(error: unknown, scope: CommanderWarmProjectionScope): void;
}): JobEventIngestTerminalHook {
  return async (scope) => {
    try { await deps.project(scope); } catch (error) { try { deps.onError(error, scope); } catch { /* best-effort diagnostics */ } }
    await deps.downstream?.(scope);
  };
}
/** Shares the existing convergence timer; includes completed turns whose warm
 * checkpoint projection was interrupted. No spend, redispatch or new timer. */
export function createCommanderWarmRecovery(deps: {
  list(cursor: string | null): Promise<CommanderWarmRecoveryCandidate[]>;
  project(scope: CommanderWarmProjectionScope): Promise<unknown>;
  onError(error: unknown, scope: CommanderWarmProjectionScope): void;
}) {
  let cursor: string | null = null; let running: Promise<void> | null = null;
  const sweep = async () => {
    const rows = await deps.list(cursor); let processed = 0; const started = Date.now();
    for (const row of rows) {
      if (Date.now() - started >= 30000) break;
      processed++;
      try { await deps.project(row); } catch (error) { try { deps.onError(error, row); } catch { /* best-effort diagnostics */ } }
    }
    cursor = processed < rows.length || rows.length === 32 ? rows[Math.max(0, processed - 1)]?.operationId ?? cursor : null;
  };
  return { tick(): Promise<void> {
    if (running) return running;
    running = sweep().finally(() => { running = null; }); return running;
  } };
}

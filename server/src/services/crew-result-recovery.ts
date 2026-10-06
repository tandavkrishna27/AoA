import type { Db } from "@armyofagents/db";
import { companies, internalAgentRuns } from "@armyofagents/db";
import { and, asc, eq, gt } from "drizzle-orm";
import { runInTenant } from "../db/tenant-context.js";
import { deliverCrewRunResult } from "./crew-result-relay.js";
import { loadAcceptedOutputTarget } from "./job-accepted-output-projection.js";
import { logger } from "../middleware/logger.js";

/** Recover from durable completed runs, including outputs committed after terminal.
 * No serving-role grants: job authority is read through the tenant application
 * pool; the existing owner pool handles company-scoped Discussion delivery. */
export function createCrewResultRecovery(input: { ownerDb: Db; appDb: Db }) {
  let afterRunId: string | null = null;
  let running: Promise<void> | null = null;
  async function sweep(): Promise<void> {
    const rows = await input.ownerDb.select({
      runId: internalAgentRuns.id, companyId: internalAgentRuns.companyId,
      organizationId: companies.organizationId, jobId: internalAgentRuns.distributedJobId,
      issueId: internalAgentRuns.relatedEntityId, agentId: internalAgentRuns.agentId,
    }).from(internalAgentRuns)
      .innerJoin(companies, eq(companies.id, internalAgentRuns.companyId))
      .where(and(eq(internalAgentRuns.executionOwner, "distributed"),
        eq(internalAgentRuns.status, "completed"), eq(internalAgentRuns.relatedEntityType, "task"),
        afterRunId ? gt(internalAgentRuns.id, afterRunId) : undefined))
      .orderBy(asc(internalAgentRuns.id)).limit(32);
    for (const row of rows) {
      if (!row.organizationId || !row.jobId || !row.issueId || !row.agentId) continue;
      try {
        const target = await runInTenant(input.appDb, row.organizationId, (_repos, tx) =>
          loadAcceptedOutputTarget(tx as unknown as Db, { organizationId: row.organizationId!,
            companyId: row.companyId, jobId: row.jobId! }));
        if (target?.crewRunId !== row.runId || target.issueId !== row.issueId || target.assigneeAgentId !== row.agentId) continue;
        await deliverCrewRunResult({ db: input.ownerDb, companyId: row.companyId,
          issueId: row.issueId, runId: row.runId, agentId: row.agentId, refreshExisting: true });
      } catch (err) {
        logger.warn({ err, companyId: row.companyId, crewRunId: row.runId }, "crew result recovery will retry");
      }
    }
    // Rotate through all pages; reset after the last page. Failed deliveries are
    // revisited, and UUIDs inserted before the cursor are included on the next pass.
    afterRunId = rows.length === 32 ? rows[rows.length - 1]!.runId : null;
  }
  return {
    tick(): Promise<void> {
      if (running) return running;
      running = sweep().finally(() => { running = null; });
      return running;
    },
  };
}

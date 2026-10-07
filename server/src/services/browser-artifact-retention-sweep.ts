import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { activityLog, jobArtifacts, jobs, type Db } from "@armyofagents/db";
import { expectedAttemptObjectPrefix } from "@armyofagents/worker-protocol";
import { runInTenant } from "../db/tenant-context.js";
import type { StorageProvider } from "../storage/types.js";
import { BROWSER_ARTIFACT_KINDS } from "./browser-artifact-retention.js";
import { browserArtifactLifetimeSeconds } from "./browser-artifact-expiry.js";
import { deleteArtifactThenRecord } from "./artifact-orphan-sweeper.js";

export interface BrowserRetentionReport {
  examined: number; examinedNothing: boolean; expired: number; failed: number; refused: number; scheduled: number;
}

async function boundedDelete(storage: StorageProvider, objectKey: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([storage.deleteObject({ objectKey }), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("artifact cleanup timed out")), 5000);
      timer.unref();
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Owner reads bounded cleanup metadata across all tenant statuses. Mutations
 * rederive the company under the tenant transaction; no worker authority or
 * membership grant is required to remove expired session credentials. */
export function createBrowserArtifactRetention(input: {
  ownerDb: Db; appDb: Db; storage: StorageProvider;
  onError?(error: unknown): void;
}) {
  let cursor: string | null = null;
  let running: Promise<BrowserRetentionReport> | null = null;
  const sweep = async (): Promise<BrowserRetentionReport> => {
    const rows = await input.ownerDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('statement_timeout', '5000ms', true)`);
      return tx.select({ id: jobArtifacts.id, organizationId: jobArtifacts.organizationId })
        .from(jobArtifacts).where(and(eq(jobArtifacts.status, "committed"),
          inArray(jobArtifacts.kind, [...BROWSER_ARTIFACT_KINDS]),
          sql`(${jobArtifacts.expiresAt} < clock_timestamp() OR (${jobArtifacts.expiresAt} IS NULL AND ${jobArtifacts.committedAt} IS NOT NULL))`,
          cursor ? gt(jobArtifacts.id, cursor) : undefined))
        .orderBy(asc(jobArtifacts.id)).limit(32);
    });
    const report: BrowserRetentionReport = { examined: rows.length, examinedNothing: rows.length === 0,
      expired: 0, failed: 0, refused: 0, scheduled: 0 };
    const started = Date.now(); let processed = 0;
    for (const candidate of rows) {
      if (Date.now() - started >= 20_000) break;
      processed++;
      try {
        const outcome = await runInTenant(input.appDb, candidate.organizationId, async (_repos, tx) => {
          await tx.execute(sql`select set_config('statement_timeout', '10000ms', true)`);
          await tx.execute(sql`select set_config('lock_timeout', '5000ms', true)`);
          const [row] = await tx.select({ artifact: jobArtifacts, companyId: jobs.companyId })
            .from(jobArtifacts).innerJoin(jobs, and(eq(jobs.id, jobArtifacts.jobId),
              eq(jobs.organizationId, jobArtifacts.organizationId)))
            .where(and(eq(jobArtifacts.id, candidate.id), eq(jobArtifacts.organizationId, candidate.organizationId),
              eq(jobArtifacts.status, "committed"), inArray(jobArtifacts.kind, [...BROWSER_ARTIFACT_KINDS])))
            .limit(1).for("update", { of: jobArtifacts, skipLocked: true });
          if (!row) return "skipped";
          const artifact = row.artifact;
          if (!row.companyId || artifact.attempt == null || !artifact.kind || !artifact.objectKey ||
              !artifact.objectKey.startsWith(expectedAttemptObjectPrefix({ organizationId: candidate.organizationId,
                jobId: artifact.jobId, attempt: artifact.attempt }))) return "refused";
          const attempt = artifact.attempt;
          const audit = async (action: string) => { await tx.insert(activityLog).values({
            organizationId: candidate.organizationId, companyId: row.companyId,
            actorType: "system", actorId: "browser-artifact-retention", action,
            entityType: "job_artifact", entityId: artifact.id,
            details: { jobId: artifact.jobId, kind: artifact.kind, retention: artifact.retention },
          }); };
          if (artifact.expiresAt == null) {
            const seconds = browserArtifactLifetimeSeconds(artifact.kind);
            if (seconds == null || !artifact.committedAt) return "refused";
            await tx.update(jobArtifacts).set({
              expiresAt: sql`${jobArtifacts.committedAt} + ${seconds} * interval '1 second'`,
              updatedAt: sql`clock_timestamp()`,
            }).where(and(eq(jobArtifacts.id, artifact.id), isNull(jobArtifacts.expiresAt)));
            await audit("artifact.retention.scheduled");
            return "scheduled";
          }
          const [due] = await tx.select({ id: jobArtifacts.id }).from(jobArtifacts).where(and(
            eq(jobArtifacts.id, artifact.id), sql`${jobArtifacts.expiresAt} < clock_timestamp()`));
          if (!due) return "skipped";
          await deleteArtifactThenRecord({ objectKey: artifact.objectKey,
            deleteObject: (key) => boundedDelete(input.storage, key), recordDeletion: async () => {
              await tx.update(jobArtifacts).set({ status: "expired", objectKey: null, updatedAt: sql`clock_timestamp()` })
                .where(and(eq(jobArtifacts.id, artifact.id), eq(jobArtifacts.status, "committed")));
              await tx.update(jobArtifacts).set({ status: "swept", updatedAt: sql`clock_timestamp()` }).where(and(
                eq(jobArtifacts.organizationId, candidate.organizationId), eq(jobArtifacts.jobId, artifact.jobId),
                eq(jobArtifacts.attempt, attempt), eq(jobArtifacts.identifier, artifact.identifier),
                eq(jobArtifacts.status, "granted")));
              await audit("artifact.retention.expired");
            } });
          return "expired";
        });
        if (outcome === "expired") report.expired++;
        else if (outcome === "scheduled") report.scheduled++;
        else if (outcome === "refused") report.refused++;
      } catch (error) {
        report.failed++;
        try { input.onError?.(error); } catch { /* diagnostics cannot stop another cleanup */ }
      }
    }
    cursor = processed < rows.length || rows.length === 32 ? rows[Math.max(0, processed - 1)]?.id ?? cursor : null;
    return report;
  };
  return { tick(): Promise<BrowserRetentionReport> {
    if (!running) running = sweep().finally(() => { running = null; });
    return running;
  } };
}

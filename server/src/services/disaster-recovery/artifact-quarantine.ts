import { companies, type Db } from "@armyofagents/db";
import { and, eq } from "drizzle-orm";
import { runInTenant } from "../../db/tenant-context.js";
import { insertActivityLog } from "../activity-log.js";
import type { StorageProvider } from "../../storage/types.js";
import { runStoredManifestReconciliation } from "./manifest-reconciliation.js";

/** Operator recovery with workers, writers and serving stopped. This is NOT a
 * worker action or an online scanner. Fresh grants must not resume until the
 * entire recovered manifest passes. Existing signed capabilities must expire or
 * be isolated at the store boundary before recovery starts. */
export async function reconcileRecoveredArtifacts(input: {
  appDb: Db; organizationId: string; companyId: string; actorId: string;
  storage: Pick<StorageProvider, "headObject" | "getObject">;
}) {
  const rows = await runInTenant(input.appDb, input.organizationId, async (repos, tx) => {
    const [company] = await tx.select({ id: companies.id }).from(companies)
      .where(and(eq(companies.id, input.companyId), eq(companies.organizationId, input.organizationId))).limit(1);
    if (!company) throw new Error("Recovery company is absent from the requested organization");
    return repos.jobArtifacts.listCommittedForRecovery({ companyId: input.companyId });
  });
  const objects: Array<{ id: string; objectKey: string | null; disposition: string }> = [];
  const blockedArtifactIds: string[] = [];
  const promoted: string[] = [];
  for (const row of rows) {
    if (row.recoveryQuarantinedAt != null) {
      blockedArtifactIds.push(row.id);
      objects.push({ id: row.id, objectKey: row.objectKey, disposition: "already_quarantined" });
      continue;
    }
    let disposition: string = "invalid_manifest";
    if (row.objectKey != null && row.sha256 != null && /^[0-9a-f]{64}$/.test(row.sha256) &&
        row.attempt != null && Number.isSafeInteger(row.attempt) && row.attempt > 0 &&
        row.sizeBytes != null && Number.isSafeInteger(row.sizeBytes) && row.sizeBytes >= 0) {
      const result = await runStoredManifestReconciliation({ storage: input.storage, rows: [{
        organizationId: row.organizationId, jobId: row.jobId, attempt: row.attempt,
        artifactId: row.identifier, objectKey: row.objectKey, sha256: row.sha256, sizeBytes: row.sizeBytes,
      }] });
      disposition = result.objects[0]!.disposition;
    }
    objects.push({ id: row.id, objectKey: row.objectKey, disposition });
    if (disposition === "verified") { promoted.push(row.objectKey!); continue; }
    // Quarantine + company activity log commit together. A changed manifest or
    // audit failure aborts, never returning a successful recovery report.
    await runInTenant(input.appDb, input.organizationId, async (repos, tx) => {
      const persisted = await repos.jobArtifacts.quarantineRecovered({ id: row.id, companyId: input.companyId,
        objectKey: row.objectKey, sha256: row.sha256, sizeBytes: row.sizeBytes, reason: disposition });
      if (!persisted) throw new Error("Recovery manifest changed while inspecting an artifact");
      if (persisted.changed) await insertActivityLog(tx, { companyId: input.companyId, actorType: "system",
        actorId: input.actorId, action: "artifact.recovery_quarantined", entityType: "job_artifact", entityId: row.id,
        details: { organizationId: input.organizationId, jobId: row.jobId, attempt: row.attempt, reason: disposition } });
    });
    blockedArtifactIds.push(row.id);
  }
  return { verdict: blockedArtifactIds.length === 0 ? "recovered" as const : "failed" as const,
    objects, promoted, blockedArtifactIds };
}

import { and, desc, eq, sql } from "drizzle-orm";
import { budgetPolicies, costEvents, jobArtifacts, jobAttempts, jobs, serviceInstances, type Db } from "@armyofagents/db";
import type { ServiceRecoveryMetadata } from "@armyofagents/shared";
import { readServiceCrashRecovery } from "./service-crash-recovery.js";

export const SERVICE_HISTORY_LIMIT = 20;

/** Called only after service ownership is established, in its tenant read-only transaction. */
export async function readServiceRecoveryView(tx: Db, input: {
  organizationId: string; companyId: string; serviceId: string; generation: number; restoreArtifactId: string | null;
}): Promise<ServiceRecoveryMetadata<Date>> {
  const clock = await tx.execute(sql`select clock_timestamp() as now`);
  const now = new Date((clock[0] as { now: string }).now);
  const scope = and(eq(serviceInstances.organizationId, input.organizationId),
    eq(serviceInstances.companyId, input.companyId), eq(serviceInstances.serviceId, input.serviceId));
  const instanceHistory = await tx.select({ serviceInstanceId: serviceInstances.id,
    generation: serviceInstances.generation, status: serviceInstances.status, terminalizedBy: serviceInstances.terminalizedBy,
    lastObservedAt: serviceInstances.lastObservedAt, createdAt: serviceInstances.createdAt, updatedAt: serviceInstances.updatedAt })
    .from(serviceInstances).where(scope).orderBy(desc(serviceInstances.createdAt), desc(serviceInstances.id)).limit(SERVICE_HISTORY_LIMIT);
  const recovery = await readServiceCrashRecovery(tx, input, now);
  const [checkpoint] = await tx.select({ artifactId: jobArtifacts.identifier, generation: serviceInstances.generation,
    createdAt: jobArtifacts.createdAt, expiresAt: jobArtifacts.expiresAt })
    .from(serviceInstances)
    .innerJoin(jobs, and(eq(jobs.id, serviceInstances.jobId), eq(jobs.organizationId, input.organizationId),
      eq(jobs.companyId, input.companyId), eq(jobs.sourceKind, "service_reconcile")))
    .innerJoin(jobAttempts, and(eq(jobAttempts.id, serviceInstances.attemptId), eq(jobAttempts.jobId, jobs.id),
      eq(jobAttempts.organizationId, input.organizationId), eq(jobAttempts.companyId, input.companyId)))
    .innerJoin(jobArtifacts, and(eq(jobArtifacts.jobId, jobs.id), eq(jobArtifacts.organizationId, input.organizationId),
      eq(jobArtifacts.attempt, jobAttempts.attemptNumber), eq(jobArtifacts.kind, "service_checkpoint"),
      eq(jobArtifacts.status, "committed"), eq(jobArtifacts.sensitivity, "restricted"), eq(jobArtifacts.contentType, "application/json"),
      sql`${jobArtifacts.objectKey} IS NOT NULL`, sql`${jobArtifacts.sha256} ~ '^[a-f0-9]{64}$'`, sql`${jobArtifacts.sizeBytes} > 0`,
      sql`${jobArtifacts.leaseId} IS NULL`, sql`${jobArtifacts.fenceToken} IS NULL`))
    .where(and(scope, eq(serviceInstances.status, "stopped"), eq(serviceInstances.terminalizedBy, "worker_stopped")))
    .orderBy(desc(jobArtifacts.createdAt), desc(jobArtifacts.id)).limit(1);
  const [policy] = await tx.select({ amountCents: budgetPolicies.amountCents, hardStopEnabled: budgetPolicies.hardStopEnabled,
    warnPercent: budgetPolicies.warnPercent }).from(budgetPolicies).where(and(eq(budgetPolicies.companyId, input.companyId),
      eq(budgetPolicies.scopeType, "company"), eq(budgetPolicies.scopeId, input.companyId), eq(budgetPolicies.isActive, true),
      eq(budgetPolicies.metric, "cost_cents"), eq(budgetPolicies.windowKind, "calendar_month_utc"))).limit(1);
  let companyBudget: ServiceRecoveryMetadata<Date>["companyBudget"] = null;
  if (policy) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const [usage] = await tx.select({ cents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)` }).from(costEvents)
      .where(and(eq(costEvents.companyId, input.companyId), sql`${costEvents.occurredAt} >= ${start.toISOString()}`,
        sql`${costEvents.occurredAt} < ${end.toISOString()}`));
    const observedCents = Number(usage.cents);
    companyBudget = { amountCents: policy.amountCents, observedCents, hardStopEnabled: policy.hardStopEnabled,
      status: policy.hardStopEnabled && observedCents >= policy.amountCents ? "hard_stop" :
        observedCents >= policy.amountCents * policy.warnPercent / 100 ? "warning" : "ok" };
  }
  return { recovery, checkpoint: { restoreArtifactId: input.restoreArtifactId,
    latest: checkpoint ? { ...checkpoint, available: checkpoint.expiresAt === null || checkpoint.expiresAt > now } : null },
    companyBudget, instanceHistory, historyLimit: SERVICE_HISTORY_LIMIT };
}

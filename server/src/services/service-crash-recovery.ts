import { and, desc, eq, gte, lte, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { jobEvents, serviceInstances, type Db } from "@armyofagents/db";

// SVC-004: server policy, independent of the frozen worker workload. History is
// already durable; a process-local retry counter would reset on every server restart.
export const SERVICE_CRASH_POLICY = Object.freeze({
  initialDelayMs: 1_000,
  maximumDelayMs: 60_000,
  windowMs: 10 * 60_000,
  pauseAtCrashes: 5,
});

export type ServiceCrashRecoveryVerdict =
  | { action: "restart" }
  | { action: "wait"; until: Date }
  | { action: "pause" };

/** Only witnessed process exits count here. Silence is not a crash witness. */
export function classifyServiceCrashRecovery(
  witnessedExits: readonly Date[],
  now: Date,
): ServiceCrashRecoveryVerdict {
  const recent = witnessedExits.filter((at) => at.getTime() >= now.getTime() - SERVICE_CRASH_POLICY.windowMs);
  if (recent.length === 0) return { action: "restart" };
  if (recent.length >= SERVICE_CRASH_POLICY.pauseAtCrashes) return { action: "pause" };
  const latest = Math.max(...recent.map((at) => at.getTime()));
  const delay = Math.min(SERVICE_CRASH_POLICY.maximumDelayMs,
    SERVICE_CRASH_POLICY.initialDelayMs * 2 ** (recent.length - 1));
  const until = new Date(latest + delay);
  return now.getTime() < until.getTime() ? { action: "wait", until } : { action: "restart" };
}

/** Call inside the tenant transaction while holding the service row lock. */
export async function readServiceCrashRecovery(
  tx: Db,
  input: { organizationId: string; companyId: string; serviceId: string; generation: number },
  now: Date,
): Promise<ServiceCrashRecoveryVerdict> {
  // The first accepted stop event is immutable; updated_at can move when a
  // later terminal/no-op event arrives. A graceful ladder first records its
  // request, while a spontaneous observed gone/exited process has no such event.
  // Real providers can witness absence without reporting a numeric exit code.
  const endedAt = sql<Date>`min(${jobEvents.createdAt})`;
  const graceful = alias(jobEvents, "service_recovery_graceful");
  const terminal = alias(jobEvents, "service_recovery_terminal");
  const rows = await tx.select({ endedAt })
    .from(serviceInstances)
    .innerJoin(jobEvents, and(
      eq(jobEvents.organizationId, serviceInstances.organizationId),
      eq(jobEvents.companyId, serviceInstances.companyId),
      eq(jobEvents.jobId, serviceInstances.jobId),
      eq(jobEvents.attemptId, serviceInstances.attemptId),
      eq(jobEvents.eventType, "service_instance_stopped"),
      sql`${jobEvents.event}->'payload'->>'serviceInstanceId' = ${serviceInstances.id}::text`,
      sql`${jobEvents.event}->'payload'->>'serviceId' = ${serviceInstances.serviceId}::text`,
      sql`${jobEvents.event}->'payload'->>'generation' = ${serviceInstances.generation}::text`,
    ))
    .where(and(
      eq(serviceInstances.organizationId, input.organizationId),
      eq(serviceInstances.companyId, input.companyId),
      eq(serviceInstances.serviceId, input.serviceId),
      eq(serviceInstances.generation, input.generation),
      eq(serviceInstances.status, "stopped"),
      eq(serviceInstances.terminalizedBy, "worker_stopped"),
      notExists(tx.select({ one: sql`1` }).from(graceful).where(and(
        eq(graceful.organizationId, jobEvents.organizationId),
        eq(graceful.companyId, jobEvents.companyId),
        eq(graceful.jobId, jobEvents.jobId),
        eq(graceful.attemptId, jobEvents.attemptId),
        eq(graceful.eventType, "service_graceful_stop_observed"),
        lte(graceful.sequence, jobEvents.sequence),
        sql`${graceful.event}->'payload'->>'serviceInstanceId' = ${serviceInstances.id}::text`,
        sql`${graceful.event}->'payload'->>'serviceId' = ${serviceInstances.serviceId}::text`,
        sql`${graceful.event}->'payload'->>'generation' = ${serviceInstances.generation}::text`,
      ))),
      notExists(tx.select({ one: sql`1` }).from(terminal).where(and(
        eq(terminal.organizationId, jobEvents.organizationId),
        eq(terminal.companyId, jobEvents.companyId),
        eq(terminal.jobId, jobEvents.jobId),
        eq(terminal.attemptId, jobEvents.attemptId),
        eq(terminal.eventType, "terminal"),
        sql`${terminal.event}->'payload'->>'status' IN ('cancelled', 'expired')`,
      ))),
    ))
    .groupBy(serviceInstances.id)
    .having(gte(endedAt, new Date(now.getTime() - SERVICE_CRASH_POLICY.windowMs).toISOString()))
    .orderBy(desc(endedAt))
    .limit(SERVICE_CRASH_POLICY.pauseAtCrashes);
  return classifyServiceCrashRecovery(rows.map((row) => new Date(row.endedAt)), now);
}

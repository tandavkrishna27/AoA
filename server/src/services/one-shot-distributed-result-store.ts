import { and, desc, eq, inArray } from "drizzle-orm";
import { jobs, jobAttempts, jobArtifacts, jobEvents, type Db } from "@armyofagents/db";
import { expectedAttemptObjectPrefix, terminalEventPayloadV1Schema, artifactPreparedPayloadV1Schema, batchWorkloadV1Schema } from "@armyofagents/worker-protocol";
import { submitJobSourceSchema } from "@armyofagents/shared";
import { runInTenant } from "../db/tenant-context.js";
import type { StorageProvider } from "../storage/types.js";
import { oneShotResultArtifactId, readOneShotResultObject, type OneShotResultObservation, type OneShotResultScope } from "./one-shot-distributed-result.js";

export function createOneShotExistingOperationReader(appDb: Db) {
  return async (input: { companyId: string; organizationId: string; operationId: string;
    operationKind: "extraction" | "compaction" | "readiness_probe"; workload: Record<string, unknown> }) => runInTenant(appDb, input.organizationId, async (_repos, tx) => {
    const [row] = await tx.select({ job: jobs, attempt: jobAttempts }).from(jobs)
      .innerJoin(jobAttempts, and(eq(jobAttempts.organizationId, jobs.organizationId), eq(jobAttempts.jobId, jobs.id)))
      .where(and(eq(jobs.organizationId, input.organizationId), eq(jobs.companyId, input.companyId),
        eq(jobs.sourceKind, "one_shot"), eq(jobs.sourceIdentity, input.operationId)))
      .orderBy(desc(jobAttempts.attemptNumber)).limit(1);
    if (!row) return null;
    const source = submitJobSourceSchema.safeParse(row.job.sourceIntent);
    const workload = batchWorkloadV1Schema.safeParse(row.job.input);
    const expected = batchWorkloadV1Schema.safeParse(input.workload);
    if (!source.success || source.data.kind !== "one_shot" || source.data.operationId !== input.operationId ||
      source.data.operationKind !== input.operationKind || row.job.executorPrincipalKind !== "worker" ||
      row.job.executorPrincipalId !== input.operationId || row.job.authenticatedPrincipalKind !== "system" ||
      row.job.authenticatedPrincipalId !== input.companyId || !workload.success || !expected.success ||
      JSON.stringify(workload.data) !== JSON.stringify(expected.data)) throw new Error("Existing one-shot operation authority mismatch");
    return row.attempt.placementLeaseEligible === true ? { jobId: row.job.id, attemptId: row.attempt.id } : null;
  });
}

/** The immutable accepted ledger, not an untrusted file or worker terminal alone, releases the caller. */
export function createOneShotDistributedResultReader(appDb: Db, storage: StorageProvider) {
  return async (scope: OneShotResultScope, signal?: AbortSignal): Promise<OneShotResultObservation> => {
    const snapshot = await runInTenant(appDb, scope.organizationId, async (_repos, tx) => {
      const [row] = await tx.select({ job: jobs, attempt: jobAttempts }).from(jobs)
        .innerJoin(jobAttempts, and(eq(jobAttempts.jobId, jobs.id), eq(jobAttempts.organizationId, jobs.organizationId)))
        .where(and(eq(jobs.organizationId, scope.organizationId), eq(jobs.companyId, scope.companyId), eq(jobs.id, scope.jobId),
          eq(jobAttempts.companyId, scope.companyId), eq(jobAttempts.id, scope.attemptId))).limit(1);
      if (!row) throw new Error("One-shot result source not found");
      const source = submitJobSourceSchema.safeParse(row.job.sourceIntent);
      if (!source.success || source.data.kind !== "one_shot" || source.data.operationId !== scope.operationId ||
        row.job.sourceKind !== "one_shot" || row.job.sourceIdentity !== scope.operationId ||
        row.job.executorPrincipalKind !== "worker" || row.job.executorPrincipalId !== scope.operationId) {
        throw new Error("One-shot result source mismatch");
      }
      const [latest] = await tx.select({ id: jobAttempts.id }).from(jobAttempts)
        .where(and(eq(jobAttempts.organizationId, scope.organizationId), eq(jobAttempts.jobId, scope.jobId)))
        .orderBy(desc(jobAttempts.attemptNumber)).limit(1);
      if (latest?.id !== scope.attemptId) return { state: "failed" } as const;
      const events = await tx.select().from(jobEvents).where(and(
        eq(jobEvents.organizationId, scope.organizationId), eq(jobEvents.companyId, scope.companyId),
        eq(jobEvents.jobId, scope.jobId), eq(jobEvents.attemptId, scope.attemptId),
        eq(jobEvents.attemptNumber, row.attempt.attemptNumber), inArray(jobEvents.eventType, ["terminal", "artifact_prepared", "usage"]),
      )).limit(1024);
      const terminal = events.find((event) => event.eventType === "terminal");
      if (!terminal) {
        return { state: ["failed", "cancelled", "canceled", "expired", "succeeded"].includes(row.attempt.status) ? "failed" : "pending" } as const;
      }
      const terminalPayload = terminalEventPayloadV1Schema.safeParse(terminal.event.payload);
      if (!terminalPayload.success || !["succeeded", "failed"].includes(terminalPayload.data.status)) return { state: "failed" } as const;
      const identifier = oneShotResultArtifactId(scope.jobId, row.attempt.attemptNumber);
      const prepared = events.find((event) => {
        const parsed = artifactPreparedPayloadV1Schema.safeParse(event.event.payload);
        return event.eventType === "artifact_prepared" && parsed.success && parsed.data.artifactId === identifier &&
          parsed.data.kind === "other" && event.sequence < terminal.sequence &&
          event.leaseId === terminal.leaseId && event.fenceToken === terminal.fenceToken;
      });
      if (!prepared) return { state: "failed" } as const;
      const [artifact] = await tx.select().from(jobArtifacts).where(and(
        eq(jobArtifacts.organizationId, scope.organizationId), eq(jobArtifacts.jobId, scope.jobId),
        eq(jobArtifacts.attempt, row.attempt.attemptNumber), eq(jobArtifacts.identifier, identifier),
        eq(jobArtifacts.status, "committed"), eq(jobArtifacts.leaseId, prepared.leaseId), eq(jobArtifacts.fenceToken, prepared.fenceToken),
      )).limit(1);
      const prefix = expectedAttemptObjectPrefix({ organizationId: scope.organizationId, jobId: scope.jobId, attempt: row.attempt.attemptNumber });
      if (!artifact || artifact.objectKey !== `${prefix}${identifier}` || artifact.kind !== "other" ||
        artifact.contentType !== "application/json" || artifact.sizeBytes === null || !artifact.sha256 ||
        (artifact.expiresAt && artifact.expiresAt.getTime() <= Date.now())) throw new Error("One-shot result provenance mismatch");
      const usageAccepted = events.some((event) => event.eventType === "usage" && event.sequence < terminal.sequence &&
        event.leaseId === terminal.leaseId && event.fenceToken === terminal.fenceToken);
      return { state: "artifact", artifact: { objectKey: artifact.objectKey, sizeBytes: artifact.sizeBytes, sha256: artifact.sha256 }, terminal: terminalPayload.data, usageAccepted } as const;
    });
    if (snapshot.state !== "artifact") return snapshot;
    const result = await readOneShotResultObject({ artifact: snapshot.artifact, operationId: scope.operationId, getObject: storage.getObject.bind(storage), signal });
    if (snapshot.terminal.exitCode !== result.exitCode ||
      (snapshot.terminal.status === "succeeded" && (result.exitCode !== 0 || result.timedOut))) throw new Error("One-shot result terminal mismatch");
    return { state: "result", result: { ...result, usageAccepted: snapshot.usageAccepted } };
  };
}

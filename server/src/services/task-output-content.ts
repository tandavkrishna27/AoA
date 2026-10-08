import { isNull, and, eq, sql } from "drizzle-orm";
import { companies, issues, jobArtifacts, jobAttempts, jobEvents, jobProjectionReceipts, jobs, taskOutputs, type Db } from "@armyofagents/db";
import { artifactPreparedPayloadV1Schema, expectedAttemptObjectPrefix } from "@armyofagents/worker-protocol";
import { loadAcceptedOutputTarget } from "./job-accepted-output-projection.js";
import type { Readable } from "node:stream";
import type { StorageProvider } from "../storage/types.js";
import { runInTenant } from "../db/tenant-context.js";
import { HttpError, notFound } from "../errors.js";
import { DEFAULT_MAX_ARTIFACT_BYTES } from "./artifact-size-ceiling.js";
import { EMPTY_ARTIFACT_SHA256 } from "../storage/artifact-content-stream.js";

async function readStorage<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch { throw new HttpError(502, "Artifact storage unavailable"); }
}

export interface TaskOutputContent {
  stream: Readable;
  sizeBytes: number;
  sha256: string;
  contentType: string;
  filename: string;
  artifactId: string;
  jobId: string;
  attempt: number;
}

/** Shared provenance check for content reads and operator evidence links. */
export async function loadTaskOutputContentArtifact(tx: Db, input: { organizationId: string; companyId: string; outputId: string; now?: Date }) {
  const { organizationId, companyId, outputId } = input;
  const now = input.now ?? new Date();
  const missing = () => notFound("Task output content not found");
  const [bound] = await tx.select({ receipt: jobProjectionReceipts, job: jobs, attempt: jobAttempts, output: taskOutputs })
    .from(jobProjectionReceipts)
    .innerJoin(taskOutputs, eq(taskOutputs.id, jobProjectionReceipts.targetAggregateId))
    .innerJoin(companies, and(eq(companies.id, taskOutputs.companyId), eq(companies.organizationId, organizationId)))
    .innerJoin(issues, and(eq(issues.id, taskOutputs.issueId), eq(issues.companyId, companyId)))
    .innerJoin(jobs, and(eq(jobs.id, jobProjectionReceipts.jobId), eq(jobs.organizationId, organizationId), eq(jobs.companyId, companyId)))
    .innerJoin(jobAttempts, and(eq(jobAttempts.id, jobProjectionReceipts.attemptId), eq(jobAttempts.jobId, jobs.id),
      eq(jobAttempts.organizationId, organizationId), eq(jobAttempts.companyId, companyId)))
    .where(and(eq(jobProjectionReceipts.organizationId, organizationId), eq(jobProjectionReceipts.companyId, companyId),
      eq(jobProjectionReceipts.projectionKind, "output_projection"), eq(jobProjectionReceipts.aggregateKind, "task_outputs"),
      eq(jobProjectionReceipts.status, "applied"), eq(taskOutputs.id, outputId), eq(taskOutputs.companyId, companyId),
      eq(taskOutputs.provider, "aoa_distributed_job"), eq(taskOutputs.type, "artifact"))).limit(1);
  if (!bound) throw missing();
  const target = await loadAcceptedOutputTarget(tx, { organizationId, companyId, jobId: bound.job.id })
    .catch(() => null);
  if (!target || target.issueId !== bound.output.issueId || !bound.output.externalId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bound.output.externalId)) throw missing();
  const [event] = await tx.select().from(jobEvents).where(and(
    eq(jobEvents.organizationId, organizationId), eq(jobEvents.companyId, companyId),
    eq(jobEvents.jobId, bound.job.id), eq(jobEvents.attemptId, bound.attempt.id),
    eq(jobEvents.attemptNumber, bound.attempt.attemptNumber), eq(jobEvents.fenceToken, bound.receipt.sourceFence),
    eq(jobEvents.eventType, "artifact_prepared"), eq(jobEvents.eventDigest, bound.receipt.sourceDigest),
    sql`${bound.receipt.sourceIdentity} = ${"output:" + companyId + ":"} || ${jobEvents.eventId}::text`,
  )).limit(1);
  if (!event) throw missing();
  const accepted = event;
  const payload = artifactPreparedPayloadV1Schema.safeParse(accepted.event.payload);
  if (!payload.success) throw missing();
  const [row] = await tx.select().from(jobArtifacts).where(and(
    eq(jobArtifacts.organizationId, organizationId), eq(jobArtifacts.jobId, bound.job.id),
    eq(jobArtifacts.attempt, bound.attempt.attemptNumber), eq(jobArtifacts.identifier, payload.data.artifactId),
    eq(jobArtifacts.status, "committed"), isNull(jobArtifacts.recoveryQuarantinedAt), eq(jobArtifacts.id, bound.output.externalId ?? "00000000-0000-0000-0000-000000000000"),
  )).limit(1);
  if (!row || row.kind !== payload.data.kind || ["browser_cookie_state", "browser_storage_state"].includes(row.kind ?? "") || !row.objectKey || !row.contentType || !row.sha256 ||
      !/^[0-9a-f]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes! < 0 ||
      row.sizeBytes! > DEFAULT_MAX_ARTIFACT_BYTES || row.leaseId !== accepted.leaseId || row.fenceToken !== accepted.fenceToken ||
      (row.sizeBytes === 0 && row.sha256 !== EMPTY_ARTIFACT_SHA256) ||
      row.applyStatus === "conflict_quarantined" || row.orphanDisposition === "quarantined" ||
      (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) ||
      !row.objectKey.startsWith(expectedAttemptObjectPrefix({ organizationId, jobId: row.jobId, attempt: row.attempt! }))) throw missing();
  return row;
}

export function createTaskOutputContentService(input: { appDb: Db; storage: StorageProvider; now?: () => Date }) {
  return {
    async openContent(outputId: string, companyId: string): Promise<TaskOutputContent> {
      const missing = () => notFound("Task output content not found");
      const [company] = await input.appDb.select({ organizationId: companies.organizationId })
        .from(companies).where(eq(companies.id, companyId)).limit(1);
      if (!company?.organizationId) throw missing();
      const organizationId = company.organizationId;
      const artifact = await runInTenant(input.appDb, organizationId, async (_repos, tx) => {
        return loadTaskOutputContentArtifact(tx, { organizationId, companyId, outputId, now: input.now?.() });
      });
      // No worker/fence admission here: committed output remains readable after terminal or rollout-off.
      const head = await readStorage(() => input.storage.headObject({ objectKey: artifact.objectKey! }));
      if (!head.exists) throw missing();
      const invalid = () => new HttpError(502, "Artifact integrity check failed");
      if (head.contentLength !== artifact.sizeBytes || head.checksumSha256 !== artifact.sha256) throw invalid();
      const object = await readStorage(() => input.storage.getObject({ objectKey: artifact.objectKey! }));
      if (object.contentLength !== artifact.sizeBytes || (head.etag && object.etag !== head.etag)) {
        object.stream.destroy();
        throw invalid();
      }
      return { stream: object.stream, sizeBytes: artifact.sizeBytes!, sha256: artifact.sha256!,
        contentType: artifact.contentType!, filename: artifact.identifier,
        artifactId: artifact.id, jobId: artifact.jobId, attempt: artifact.attempt! };
    },
  };
}

import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { jobArtifacts, jobAttempts, serviceInstances, type Db, type TenantRepositories } from "@armyofagents/db";
import { expectedAttemptObjectPrefix } from "@armyofagents/worker-protocol";
import type { StorageProvider } from "../storage/types.js";
import { sanitizeRecord } from "../redaction.js";
import { pointerFitsExtension, stagedPathMarker, type StagedInputFile } from "./job-input-staging.js";
import { insertActivity } from "./activity-log.js";
import { loadConfig } from "../config.js";
import { createStorageProviderFromConfig } from "../storage/provider-registry.js";
import { HttpError } from "../errors.js";
export const serviceCheckpointStorage = () => createStorageProviderFromConfig(loadConfig());

export const SERVICE_CHECKPOINT_MAX_FILES = 16;
export const SERVICE_CHECKPOINT_MAX_BYTES = 8 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const fileSchema = z.object({
  artifactId: z.string().uuid(), path: z.string().min(1).max(200),
  sha256: hash, sizeBytes: z.number().int().min(1).max(1024 * 1024),
  type: z.literal("file"), encoding: z.literal("json"),
}).strict();
export const serviceCheckpointManifestSchema = z.object({
  version: z.literal(1), serviceId: z.string().uuid(), generation: z.number().int().positive(),
  files: z.array(fileSchema).min(1).max(SERVICE_CHECKPOINT_MAX_FILES),
}).strict().superRefine((manifest, ctx) => {
  const paths = new Set<string>();
  let bytes = 0;
  for (const file of manifest.files) {
    // Relative regular JSON files only: no archive extraction, links, device files,
    // hidden paths, Windows separators or parent-directory traversal.
    if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.json$/.test(file.path) || paths.has(file.path)) {
      ctx.addIssue({ code: "custom", message: "checkpoint path rejected" });
    }
    paths.add(file.path); bytes += file.sizeBytes;
  }
  if (bytes > SERVICE_CHECKPOINT_MAX_BYTES) ctx.addIssue({ code: "custom", message: "checkpoint too large" });
});

export class ServiceCheckpointRefused extends HttpError {
  constructor(readonly reason: string) { super(422, `Service checkpoint refused: ${reason}`); }
}

async function readVerifiedBytes(storage: StorageProvider, objectKey: string, sha256: string, size: number): Promise<Buffer> {
  const object = await storage.getObject({ objectKey });
  const parts: Buffer[] = []; let count = 0;
  const timeout = setTimeout(() => object.stream.destroy(new ServiceCheckpointRefused("object_read_timeout")), 30_000);
  try {
    for await (const chunk of object.stream) {
      const part = Buffer.from(chunk); count += part.length;
      if (count > size) throw new ServiceCheckpointRefused("size_mismatch");
      parts.push(part);
    }
  } finally { clearTimeout(timeout); object.stream.destroy(); }
  const bytes = Buffer.concat(parts);
  if (count !== size || createHash("sha256").update(bytes).digest("hex") !== sha256) {
    throw new ServiceCheckpointRefused("hash_mismatch");
  }
  return bytes;
}

type Scope = { organizationId: string; companyId: string; serviceId: string; generation: number };
export const serviceCheckpointRestoreSchema = z.object({
  sourceJobId: z.string().uuid(), sourceAttempt: z.number().int().positive(), sourceGeneration: z.number().int().positive(),
  manifestArtifactId: z.string().uuid(), manifestSha256: hash, manifestSizeBytes: z.number().int().min(1).max(65536),
}).strict();
export type ServiceCheckpointRestore = z.infer<typeof serviceCheckpointRestoreSchema>;
type Source = ServiceCheckpointRestore;

async function loadArtifact(tx: Db, scope: Scope, source: Source, artifactId: string, sha256: string, size: number, now: Date) {
  const [row] = await tx.select().from(jobArtifacts).where(and(
    eq(jobArtifacts.organizationId, scope.organizationId), eq(jobArtifacts.jobId, source.sourceJobId),
    eq(jobArtifacts.attempt, source.sourceAttempt), eq(jobArtifacts.identifier, artifactId), eq(jobArtifacts.status, "committed"),
  )).limit(1);
  if (!row || row.kind !== "service_checkpoint" || row.sensitivity !== "restricted" || !row.objectKey ||
      row.sha256 !== sha256 || row.sizeBytes !== size || (row.expiresAt && row.expiresAt <= now) ||
      !row.objectKey.startsWith(expectedAttemptObjectPrefix({ organizationId: scope.organizationId, jobId: source.sourceJobId, attempt: source.sourceAttempt }))) {
    throw new ServiceCheckpointRefused("artifact_unavailable");
  }
  // Artifact ownership lacks company_id; attribute it through the producing
  // service instance, whose composite FK proves the company boundary.
  const [owner] = await tx.select({ id: serviceInstances.id }).from(serviceInstances)
    .innerJoin(jobAttempts, eq(jobAttempts.id, serviceInstances.attemptId)).where(and(
    eq(serviceInstances.organizationId, scope.organizationId), eq(serviceInstances.companyId, scope.companyId),
    eq(serviceInstances.serviceId, scope.serviceId), eq(serviceInstances.generation, scope.generation),
    eq(serviceInstances.jobId, source.sourceJobId),
    eq(jobAttempts.organizationId, scope.organizationId), eq(jobAttempts.companyId, scope.companyId),
    eq(jobAttempts.attemptNumber, source.sourceAttempt),
  )).limit(1);
  if (!owner) throw new ServiceCheckpointRefused("source_generation_mismatch");
  return row.objectKey;
}

export async function materializeServiceCheckpoint(tx: Db, storage: StorageProvider, scope: Scope, source: Source, now: Date) {
  if (source.sourceGeneration !== scope.generation) throw new ServiceCheckpointRefused("source_generation_mismatch");
  if (storage.id === "local_disk" || !storage.presignGet) throw new ServiceCheckpointRefused("portable_store_required");
  if (source.manifestSizeBytes < 1 || source.manifestSizeBytes > 65536) throw new ServiceCheckpointRefused("manifest_size_rejected");
  const key = await loadArtifact(tx, scope, source, source.manifestArtifactId, source.manifestSha256, source.manifestSizeBytes, now);
  let manifest: z.infer<typeof serviceCheckpointManifestSchema>;
  try {
    manifest = serviceCheckpointManifestSchema.parse(JSON.parse((await readVerifiedBytes(storage, key, source.manifestSha256, source.manifestSizeBytes)).toString("utf8")));
  } catch (error) {
    if (error instanceof ServiceCheckpointRefused) throw error;
    throw new ServiceCheckpointRefused("manifest_invalid");
  }
  if (manifest.serviceId !== scope.serviceId || manifest.generation !== scope.generation) {
    throw new ServiceCheckpointRefused("generation_mismatch");
  }
  const files: StagedInputFile[] = [];
  for (const entry of manifest.files) {
    const fileKey = await loadArtifact(tx, scope, source, entry.artifactId, entry.sha256, entry.sizeBytes, now);
    const bytes = await readVerifiedBytes(storage, fileKey, entry.sha256, entry.sizeBytes);
    let state: unknown;
    try { state = JSON.parse(bytes.toString("utf8")); } catch { throw new ServiceCheckpointRefused("state_invalid"); }
    if (!state || typeof state !== "object" || Array.isArray(state) ||
        JSON.stringify(sanitizeRecord(state as Record<string, unknown>)) !== JSON.stringify(state)) {
      throw new ServiceCheckpointRefused("secret_bearing_state");
    }
    files.push({ path: `/tmp/aoa-service-state/${scope.serviceId}/${entry.path}`, bytes, contentType: "application/json" });
  }
  return files;
}

/** Objects first, committed pointers in the SAME transaction as job submission.
 * The lease cannot observe this job until every required state file is committed.
 * The enclosing transaction owner compensates uploaded keys on rollback. */
export async function stageServiceCheckpointFilesWithinTenant(
  repos: TenantRepositories, tx: Db, storage: StorageProvider,
  scope: { organizationId: string; companyId: string; jobId: string; attemptId: string },
  files: readonly StagedInputFile[], uploadedKeys: string[],
) {
  const attempt = await repos.attempts.getById(scope.attemptId);
  if (!attempt || attempt.jobId !== scope.jobId) throw new ServiceCheckpointRefused("attempt_unavailable");
  const prefix = expectedAttemptObjectPrefix({ organizationId: scope.organizationId, jobId: scope.jobId, attempt: attempt.attemptNumber });
  if (!pointerFitsExtension([], files, prefix)) throw new ServiceCheckpointRefused("pointer_too_large");
  for (const file of files) {
    const artifactId = randomUUID(); const key = `${prefix}${artifactId}`;
    const sha256 = createHash("sha256").update(file.bytes).digest("hex");
    // Register before upload: a PUT that succeeds remotely but rejects locally
    // still needs compensation if this transaction rolls back.
    uploadedKeys.push(key);
    await storage.putObject({ objectKey: key, body: Buffer.from(file.bytes), contentType: "application/json", contentLength: file.bytes.length });
    await repos.jobArtifacts.insert({ organizationId: scope.organizationId, jobId: scope.jobId,
      identifier: artifactId, attempt: attempt.attemptNumber, objectKey: key, sha256, sizeBytes: file.bytes.length,
      contentType: stagedPathMarker(file.path), kind: "staged_input", status: "committed", committedAt: new Date(), leaseId: null, fenceToken: null });
  }
  await insertActivity(tx, { companyId: scope.companyId, actorType: "system", actorId: "service-reconciler",
    action: "service.checkpoint_staged", entityType: "job", entityId: scope.jobId,
    details: { fileCount: files.length, attempt: attempt.attemptNumber } });
}


/** The application writes JSON files to /home/user/aoa-output before exiting.
 * Board approval names their committed artifacts; the server authors the manifest. */
export const serviceCheckpointFilesSchema = z.object({
  sourceJobId: z.string().uuid(), sourceAttempt: z.number().int().positive(), sourceGeneration: z.number().int().positive(),
  files: z.array(z.object({ artifactId: z.string().uuid(), path: z.string().min(1).max(200) }).strict()).min(1).max(SERVICE_CHECKPOINT_MAX_FILES),
}).strict();
export type ServiceCheckpointFiles = z.infer<typeof serviceCheckpointFilesSchema>;
export async function commitServiceCheckpointManifest(
  repos: TenantRepositories, tx: Db, storage: StorageProvider, scope: Scope,
  input: ServiceCheckpointFiles, uploadedKeys: string[], now: Date,
): Promise<ServiceCheckpointRestore> {
  if (input.sourceGeneration !== scope.generation) throw new ServiceCheckpointRefused("source_generation_mismatch");
  if (storage.id === "local_disk" || !storage.presignGet) throw new ServiceCheckpointRefused("portable_store_required");
  const [witness] = await tx.select({ id: serviceInstances.id }).from(serviceInstances)
    .innerJoin(jobAttempts, eq(jobAttempts.id, serviceInstances.attemptId)).where(and(
      eq(serviceInstances.organizationId, scope.organizationId), eq(serviceInstances.companyId, scope.companyId),
      eq(serviceInstances.serviceId, scope.serviceId), eq(serviceInstances.generation, scope.generation),
      eq(serviceInstances.jobId, input.sourceJobId), eq(serviceInstances.status, "stopped"),
      eq(serviceInstances.terminalizedBy, "worker_stopped"), eq(jobAttempts.attemptNumber, input.sourceAttempt),
    )).limit(1);
  if (!witness) throw new ServiceCheckpointRefused("source_stop_unwitnessed");
  const entries = [];
  for (const file of input.files) {
    const [artifact] = await tx.select().from(jobArtifacts).where(and(
      eq(jobArtifacts.organizationId, scope.organizationId), eq(jobArtifacts.jobId, input.sourceJobId),
      eq(jobArtifacts.attempt, input.sourceAttempt), eq(jobArtifacts.identifier, file.artifactId),
    )).limit(1);
    if (!artifact?.sha256 || !artifact.sizeBytes) throw new ServiceCheckpointRefused("artifact_unavailable");
    entries.push({ ...file, sha256: artifact.sha256, sizeBytes: artifact.sizeBytes, type: "file" as const, encoding: "json" as const });
  }
  const manifest = serviceCheckpointManifestSchema.parse({ version: 1, serviceId: scope.serviceId, generation: scope.generation, files: entries });
  const manifestArtifactId = randomUUID();
  const bytes = Buffer.from(JSON.stringify(manifest));
  const source = { sourceJobId: input.sourceJobId, sourceAttempt: input.sourceAttempt, sourceGeneration: input.sourceGeneration,
    manifestArtifactId, manifestSha256: createHash("sha256").update(bytes).digest("hex"), manifestSizeBytes: bytes.length };
  // Verify source state BEFORE creating any object or generation binding.
  for (const entry of manifest.files) {
    const key = await loadArtifact(tx, scope, source, entry.artifactId, entry.sha256, entry.sizeBytes, now);
    const stateBytes = await readVerifiedBytes(storage, key, entry.sha256, entry.sizeBytes);
    let state: unknown;
    try { state = JSON.parse(stateBytes.toString("utf8")); } catch { throw new ServiceCheckpointRefused("state_invalid"); }
    if (!state || typeof state !== "object" || Array.isArray(state) ||
      JSON.stringify(sanitizeRecord(state as Record<string, unknown>)) !== JSON.stringify(state)) throw new ServiceCheckpointRefused("secret_bearing_state");
  }
  const key = `${expectedAttemptObjectPrefix({ organizationId: scope.organizationId, jobId: source.sourceJobId, attempt: source.sourceAttempt })}${manifestArtifactId}`;
  uploadedKeys.push(key);
  await storage.putObject({ objectKey: key, body: bytes, contentType: "application/json", contentLength: bytes.length });
  await repos.jobArtifacts.insert({ organizationId: scope.organizationId, jobId: source.sourceJobId, identifier: manifestArtifactId,
    attempt: source.sourceAttempt, objectKey: key, sha256: source.manifestSha256, sizeBytes: bytes.length,
    contentType: "application/json", kind: "service_checkpoint", sensitivity: "restricted", status: "committed",
    committedAt: now, leaseId: null, fenceToken: null });
  return source;
}

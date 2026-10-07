import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupJobControlFixture, ORG, COMPANY, type JobControlFixture } from "./helpers/job-control-fixture.js";
import { runInTenant } from "../db/tenant-context.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import type { StorageProvider } from "../storage/types.js";
import { materializeServiceCheckpoint, type ServiceCheckpointRestore } from "../services/service-checkpoint.js";
import { expectedAttemptObjectPrefix } from "@armyofagents/worker-protocol";
import { rollServiceGeneration } from "../services/service-generation-rollout.js";
import { reconcileService } from "../services/service-reconciler.js";

const SERVICE = "b6000000-0000-4000-8000-000000000001";
let fixture: JobControlFixture;
let objectDir: string;
let disk: StorageProvider;
let storage: StorageProvider;
let source: ServiceCheckpointRestore;
let stateId: string;
let stateKey: string;
let manifestKey: string;
const state = Buffer.from('{"counter":42}');
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const scope = { organizationId: ORG, companyId: COMPANY, serviceId: SERVICE, generation: 1 };
const definition = { command: "node", args: ["service.js"], gracefulStopSeconds: 5 };

beforeAll(async () => {
  fixture = await setupJobControlFixture("service-portable-checkpoint");
  objectDir = await mkdtemp(join(tmpdir(), "service-checkpoint-objects-"));
  disk = createLocalDiskStorageProvider(objectDir);
  // Real filesystem bytes behind the portable object-store port. This adapter
  // proves byte movement without claiming a live S3/E2B deployment certificate.
  storage = { ...disk, id: "s3", presignGet: async () => ({ method: "GET", url: "https://objects.invalid/checkpoint", headers: {} }) };
}, 180_000);
afterAll(async () => { await fixture?.teardown(); if (objectDir) await rm(objectDir, { recursive: true, force: true }); }, 60_000);

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")("portable application-file service checkpoints", () => {
  beforeEach(async () => {
    await fixture.admin`DELETE FROM service_instances`;
    await fixture.admin`DELETE FROM service_generations`;
    await fixture.admin`DELETE FROM services`;
    const { seeded } = await fixture.activateLease(990);
    await fixture.admin`INSERT INTO services(id,organization_id,company_id,generation,desired_state) VALUES(${SERVICE},${ORG},${COMPANY},1,'running')`;
    await fixture.admin`INSERT INTO service_generations(organization_id,company_id,service_id,generation,definition) VALUES(${ORG},${COMPANY},${SERVICE},1,${definition})`;
    await fixture.admin`INSERT INTO service_instances(organization_id,company_id,service_id,generation,status,job_id,attempt_id)
      VALUES(${ORG},${COMPANY},${SERVICE},1,'healthy',${seeded.jobId},${seeded.attemptId})`;
    stateId = randomUUID(); const manifestId = randomUUID();
    const prefix = expectedAttemptObjectPrefix({ organizationId: ORG, jobId: seeded.jobId, attempt: 1 });
    stateKey = `${prefix}${stateId}`; manifestKey = `${prefix}${manifestId}`;
    const manifest = Buffer.from(JSON.stringify({ version: 1, serviceId: SERVICE, generation: 1,
      files: [{ artifactId: stateId, path: "state.json", type: "file", encoding: "json", sha256: digest(state), sizeBytes: state.length }] }));
    source = { sourceJobId: seeded.jobId, sourceAttempt: 1, sourceGeneration: 1, manifestArtifactId: manifestId,
      manifestSha256: digest(manifest), manifestSizeBytes: manifest.length };
    for (const [id, key, bytes] of [[stateId, stateKey, state], [manifestId, manifestKey, manifest]] as const) {
      await disk.putObject({ objectKey: key, body: bytes, contentType: "application/json", contentLength: bytes.length });
      await fixture.admin`INSERT INTO job_artifacts(organization_id,job_id,identifier,attempt,object_key,sha256,size_bytes,kind,sensitivity,status,committed_at)
        VALUES(${ORG},${seeded.jobId},${id},1,${key},${digest(bytes)},${bytes.length},'service_checkpoint','restricted','committed',clock_timestamp())`;
    }
  });

  const read = (override: Partial<ServiceCheckpointRestore> = {}, companyId = COMPANY, store = storage) =>
    runInTenant(fixture.app.db, ORG, (_, tx) => materializeServiceCheckpoint(tx, store, { ...scope, companyId }, { ...source, ...override }, new Date()));

  it("reads and verifies actual object bytes into regular application state files", async () => {
    const files = await read();
    expect(files).toHaveLength(1); expect(Buffer.from(files[0]!.bytes)).toEqual(state);
    expect(files[0]!.path).toBe(`/tmp/aoa-service-state/${SERVICE}/state.json`);
  });
  it("rejects corruption, missing bytes and old source generations", async () => {
    await disk.putObject({ objectKey: stateKey, body: Buffer.from('{"counter":43}'), contentType: "application/json", contentLength: state.length });
    await expect(read()).rejects.toMatchObject({ reason: "hash_mismatch" });
    await disk.deleteObject({ objectKey: stateKey });
    await expect(read()).rejects.toThrow();
    await expect(read({ sourceGeneration: 2 })).rejects.toMatchObject({ reason: "source_generation_mismatch" });
  });
  it("rejects company mismatch, expiry and local disk as portable authority", async () => {
    await expect(read({}, randomUUID())).rejects.toMatchObject({ reason: "source_generation_mismatch" });
    await expect(read({}, COMPANY, disk)).rejects.toMatchObject({ reason: "portable_store_required" });
    await fixture.admin`UPDATE job_artifacts SET expires_at = clock_timestamp() - interval '1 second' WHERE identifier = ${stateId}`;
    await expect(read()).rejects.toMatchObject({ reason: "artifact_unavailable" });
  });
  it("rejects secret-bearing state even when both committed hashes match", async () => {
    const secret = Buffer.from('{"password":"private-state"}');
    const manifest = Buffer.from(JSON.stringify({ version: 1, serviceId: SERVICE, generation: 1,
      files: [{ artifactId: stateId, path: "state.json", type: "file", encoding: "json", sha256: digest(secret), sizeBytes: secret.length }] }));
    for (const [id, key, bytes] of [[stateId, stateKey, secret], [source.manifestArtifactId, manifestKey, manifest]] as const) {
      await disk.putObject({ objectKey: key, body: bytes, contentType: "application/json", contentLength: bytes.length });
      await fixture.admin`UPDATE job_artifacts SET sha256=${digest(bytes)},size_bytes=${bytes.length} WHERE identifier=${id}`;
    }
    await expect(read({ manifestSha256: digest(manifest), manifestSizeBytes: manifest.length })).rejects.toMatchObject({ reason: "secret_bearing_state" });
  });
  it("board roll binds source generation and stages verified files atomically with replacement", async () => {
    const rolled = await rollServiceGeneration({ appDb: fixture.app.db }, { ...scope, definition,
      reason: "Restore approved application state", createdBy: "operator", actor: { actorType: "user", actorId: "operator" },
      checkpointRestore: source, checkpointStorage: storage });
    expect(rolled.verdict.outcome).toBe("rolled");
    await fixture.admin`UPDATE service_instances SET status='stopped', terminalized_by='worker_stopped' WHERE service_id=${SERVICE}`;
    const outcome = await reconcileService(fixture.app.db, { ...scope, checkpointStorage: storage });
    expect(outcome.action).toBe("created");
    if (outcome.action !== "created") throw new Error("replacement missing");
    const rows = await fixture.admin`SELECT object_key,sha256,size_bytes,content_type FROM job_artifacts
      WHERE job_id=${outcome.jobId} AND kind='staged_input'`;
    expect(rows).toHaveLength(2);
    const restored = rows.find((row) => row.content_type.endsWith("/state.json"))!;
    const object = await storage.getObject({ objectKey: restored.object_key });
    const chunks: Buffer[] = []; for await (const chunk of object.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(state);
    const [generation] = await fixture.admin`SELECT definition FROM service_generations WHERE service_id=${SERVICE} AND generation=2`;
    expect(generation.definition.checkpointRestore).toMatchObject({ approvedGeneration: 2, sourceGeneration: 1, manifestSha256: source.manifestSha256 });
  });
  it("creates a committed manifest from witnessed exported files in the authorized roll", async () => {
    await fixture.admin`UPDATE service_instances SET status='stopped', terminalized_by='worker_stopped' WHERE service_id=${SERVICE}`;
    const rolled = await rollServiceGeneration({ appDb: fixture.app.db }, { ...scope, definition,
      reason: "Approve exported application state", createdBy: "operator", actor: { actorType: "user", actorId: "operator" },
      checkpointFiles: { sourceJobId: source.sourceJobId, sourceAttempt: 1, sourceGeneration: 1,
        files: [{ artifactId: stateId, path: "state.json" }] }, checkpointStorage: storage });
    expect(rolled.verdict.outcome).toBe("rolled");
    const [generation] = await fixture.admin`SELECT definition FROM service_generations WHERE service_id=${SERVICE} AND generation=2`;
    const binding = generation.definition.checkpointRestore;
    expect(binding.manifestArtifactId).not.toBe(source.manifestArtifactId);
    const files = await runInTenant(fixture.app.db, ORG, (_, tx) => materializeServiceCheckpoint(tx, storage, scope,
      { sourceJobId: binding.sourceJobId, sourceAttempt: binding.sourceAttempt, sourceGeneration: binding.sourceGeneration,
        manifestArtifactId: binding.manifestArtifactId, manifestSha256: binding.manifestSha256, manifestSizeBytes: binding.manifestSizeBytes }, new Date()));
    expect(Buffer.from(files[0]!.bytes)).toEqual(state);
  });
  it("refuses manifest creation without a witnessed stop and rolls back corrupted sources", async () => {
    const input = { ...scope, definition, reason: "Approve state", createdBy: "operator", actor: { actorType: "user" as const, actorId: "operator" },
      checkpointFiles: { sourceJobId: source.sourceJobId, sourceAttempt: 1, sourceGeneration: 1, files: [{ artifactId: stateId, path: "state.json" }] }, checkpointStorage: storage };
    await expect(rollServiceGeneration({ appDb: fixture.app.db }, input)).rejects.toMatchObject({ reason: "source_stop_unwitnessed" });
    await fixture.admin`UPDATE service_instances SET status='stopped', terminalized_by='worker_stopped' WHERE service_id=${SERVICE}`;
    await disk.putObject({ objectKey: stateKey, body: Buffer.from('{"counter":99}'), contentType: "application/json", contentLength: state.length });
    await expect(rollServiceGeneration({ appDb: fixture.app.db }, input)).rejects.toMatchObject({ reason: "hash_mismatch" });
    const generations = await fixture.admin`SELECT generation FROM service_generations WHERE service_id=${SERVICE}`;
    expect(generations).toHaveLength(1);
  });

});

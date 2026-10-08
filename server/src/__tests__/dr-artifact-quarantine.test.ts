import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { Db, JobArtifact } from "@armyofagents/db";
import { expectedAttemptObjectPrefix } from "@armyofagents/worker-protocol";
import { reconcileRecoveredArtifacts } from "../services/disaster-recovery/artifact-quarantine.js";
import { parseRecoveryArguments } from "../cli/reconcile-recovered-artifacts.js";

const state = vi.hoisted(() => ({ company: vi.fn(), list: vi.fn(), quarantine: vi.fn(), audit: vi.fn() }));
vi.mock("../db/tenant-context.js", () => ({ runInTenant: async (_db: unknown, _org: string, fn: Function) =>
  fn({ jobArtifacts: { listCommittedForRecovery: state.list, quarantineRecovered: state.quarantine } },
    { select: () => ({ from: () => ({ where: () => ({ limit: state.company }) }) }) }) }));
vi.mock("../services/activity-log.js", () => ({ insertActivityLog: (...args: unknown[]) => state.audit(...args) }));

const organizationId = "a5000000-0000-4000-8000-000000000001";
const companyId = "a5000000-0000-4000-8000-000000000002";
const jobId = "a5000000-0000-4000-8000-000000000003";
const bytes = Buffer.from("recovered artifact");
function artifact(id = "one", extra: Partial<JobArtifact> = {}): JobArtifact {
  return { id, organizationId, jobId, identifier: id, attempt: 1, status: "committed",
    objectKey: `${expectedAttemptObjectPrefix({ organizationId, jobId, attempt: 1 })}${id}`,
    sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length,
    recoveryQuarantinedAt: null, recoveryQuarantineReason: null, ...extra } as JobArtifact;
}
const storage = {
  headObject: vi.fn(async () => ({ exists: true, contentLength: bytes.length })),
  getObject: vi.fn(async () => ({ stream: Readable.from([bytes]), contentLength: bytes.length })),
};
const input = { appDb: {} as Db, organizationId, companyId, storage, actorId: "recovery-operator" };

beforeEach(() => {
  vi.clearAllMocks();
  state.company.mockResolvedValue([{ id: companyId }]);
  state.quarantine.mockImplementation(async (request) => ({ changed: true, artifact: artifact(request.id) }));
  storage.headObject.mockResolvedValue({ exists: true, contentLength: bytes.length });
});

describe("durable recovered artifact quarantine", () => {
  it("requires explicit offline organization/company scope at the operator entry point", () => {
    expect(parseRecoveryArguments(["--offline", "--organization", organizationId, "--company", companyId]))
      .toEqual({ organizationId, companyId });
    for (const args of [[], ["--organization", organizationId, "--company", companyId],
      ["--offline", "--organization", "wrong", "--company", companyId],
      ["--offline", "--organization", organizationId, "--company", companyId, "--unknown"]]) {
      expect(() => parseRecoveryArguments(args)).toThrow();
    }
  });
  it("refuses missing or foreign company scope before reading the manifest or store", async () => {
    state.company.mockResolvedValue([]);
    await expect(reconcileRecoveredArtifacts(input)).rejects.toThrow(/company is absent/);
    expect(state.list).not.toHaveBeenCalled();
    expect(storage.headObject).not.toHaveBeenCalled();
  });
  it("accepts an existing company with an empty authoritative manifest", async () => {
    state.list.mockResolvedValue([]);
    expect((await reconcileRecoveredArtifacts(input)).verdict).toBe("recovered");
  });
  it("reads the company-scoped authoritative manifest and promotes verified bytes only", async () => {
    state.list.mockResolvedValue([artifact()]);
    const result = await reconcileRecoveredArtifacts(input);
    expect(state.list).toHaveBeenCalledWith({ companyId });
    expect(result.verdict).toBe("recovered");
    expect(result.promoted).toEqual([artifact().objectKey]);
    expect(state.quarantine).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("persists corruption with its immutable fingerprint and mandatory company audit", async () => {
    const row = artifact("corrupt", { sha256: "f".repeat(64) });
    state.list.mockResolvedValue([row]);
    const result = await reconcileRecoveredArtifacts(input);
    expect(result.verdict).toBe("failed");
    expect(result.promoted).toEqual([]);
    expect(state.quarantine).toHaveBeenCalledWith(expect.objectContaining({ id: row.id, companyId,
      objectKey: row.objectKey, sha256: row.sha256, sizeBytes: row.sizeBytes, reason: "hash_mismatch" }));
    expect(state.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ companyId,
      actorId: input.actorId, action: "artifact.recovery_quarantined", entityId: row.id }));
  });

  it("also persists a missing-object tombstone", async () => {
    state.list.mockResolvedValue([artifact()]);
    storage.headObject.mockResolvedValue({ exists: false, contentLength: 0 });
    expect((await reconcileRecoveredArtifacts(input)).verdict).toBe("failed");
    expect(state.quarantine).toHaveBeenCalledWith(expect.objectContaining({ reason: "missing" }));
  });

  it("does not clear quarantine or promote an identity even when bytes are later repaired", async () => {
    state.list.mockResolvedValue([artifact("blocked", { recoveryQuarantinedAt: new Date(), recoveryQuarantineReason: "missing" })]);
    const result = await reconcileRecoveredArtifacts(input);
    expect(result.verdict).toBe("failed");
    expect(result.promoted).toEqual([]);
    expect(result.blockedArtifactIds).toEqual(["blocked"]);
    expect(state.quarantine).not.toHaveBeenCalled();
  });

  it("does not return a recovery report if durable quarantine fails", async () => {
    state.list.mockResolvedValue([artifact("bad", { sha256: "f".repeat(64) })]);
    state.quarantine.mockResolvedValue(null);
    await expect(reconcileRecoveredArtifacts(input)).rejects.toThrow(/manifest changed/);
  });

  it("refuses foreign scope without reading bytes", async () => {
    state.list.mockResolvedValue([artifact("foreign", { objectKey: "organizations/another/secret" })]);
    const result = await reconcileRecoveredArtifacts(input);
    expect(result.verdict).toBe("failed");
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(storage.getObject).not.toHaveBeenCalled();
    expect(state.quarantine).toHaveBeenCalledWith(expect.objectContaining({ reason: "wrong_prefix" }));
  });
  it("does not duplicate activity when another recovery pass already quarantined the identity", async () => {
    state.list.mockResolvedValue([artifact("bad", { sha256: "f".repeat(64) })]);
    state.quarantine.mockResolvedValue({ changed: false, artifact: artifact("bad", { recoveryQuarantinedAt: new Date() }) });
    expect((await reconcileRecoveredArtifacts(input)).verdict).toBe("failed");
    expect(state.audit).not.toHaveBeenCalled();
  });
  it("aborts if the mandatory audit cannot be persisted", async () => {
    state.list.mockResolvedValue([artifact("bad", { sha256: "f".repeat(64) })]);
    state.audit.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(reconcileRecoveredArtifacts(input)).rejects.toThrow("audit unavailable");
  });
  it("quarantines an incomplete authoritative manifest without touching storage", async () => {
    state.list.mockResolvedValue([artifact("bad", { sha256: null })]);
    expect((await reconcileRecoveredArtifacts(input)).verdict).toBe("failed");
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(state.quarantine).toHaveBeenCalledWith(expect.objectContaining({ reason: "invalid_manifest" }));
  });
});

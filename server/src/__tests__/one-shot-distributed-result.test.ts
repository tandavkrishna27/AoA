import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { exportArtifactId } from "../../../packages/worker-daemon/src/lease/artifact-export.js";
import { oneShotResultArtifactId, readOneShotResultObject, waitForOneShotResult } from "../services/one-shot-distributed-result.js";

const scope = { organizationId: "org", companyId: "company", jobId: "job", attemptId: "attempt", operationId: "operation" };
const payload = { version: 1, operationId: scope.operationId, stdout: "answer", stderr: "", exitCode: 0, timedOut: false, durationMs: 12, captureError: null };
function object(value = payload) {
  const bytes = Buffer.from(JSON.stringify(value));
  return { bytes, artifact: { objectKey: "object", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } };
}
describe("one-shot accepted result", () => {
  it("addresses exactly the worker's deterministic result artifact", () => {
    expect(oneShotResultArtifactId("job", 2)).toBe(exportArtifactId({ jobId: "job", attempt: 2, path: "/home/user/aoa-output/aoa-one-shot-result.json" }));
  });
  it("reads the integrity-checked operation result", async () => {
    const { bytes, artifact } = object();
    await expect(readOneShotResultObject({ artifact, operationId: scope.operationId, getObject: async () => ({ stream: Readable.from([bytes]) }) })).resolves.toEqual(payload);
  });
  it.each(["hash", "size", "operation", "capture"])("rejects %s corruption", async (kind) => {
    const { bytes, artifact } = object(kind === "operation" ? { ...payload, operationId: "other" } : kind === "capture" ? { ...payload, captureError: "ENOBUFS" } : payload);
    if (kind === "hash") artifact.sha256 = "0".repeat(64);
    if (kind === "size") artifact.sizeBytes++;
    await expect(readOneShotResultObject({ artifact, operationId: scope.operationId, getObject: async () => ({ stream: Readable.from([bytes]) }) })).rejects.toThrow();
  });
  it("bounds the actual streamed bytes independently of metadata", async () => {
    const { artifact } = object();
    const stream = Readable.from([Buffer.alloc(3_000_000)]);
    await expect(readOneShotResultObject({ artifact, operationId: scope.operationId, getObject: async () => ({ stream }) })).rejects.toThrow();
    expect(stream.destroyed).toBe(true);
  });
  it("waits for an accepted terminal before returning output", async () => {
    const read = vi.fn().mockResolvedValueOnce({ state: "pending" }).mockResolvedValue({ state: "result", result: payload });
    const cancel = vi.fn();
    await expect(waitForOneShotResult({ scope, timeoutMs: 100, read, cancel, sleep: async () => {}, now: () => 0 })).resolves.toEqual(payload);
    expect(read).toHaveBeenCalledTimes(2);
    expect(cancel).not.toHaveBeenCalled();
  });
  it("revokes through the existing cancel path on the wait deadline", async () => {
    let time = 0;
    const cancel = vi.fn();
    await expect(waitForOneShotResult({ scope, timeoutMs: 10, read: async () => ({ state: "pending" }), cancel, sleep: async () => { time = 11; }, now: () => time })).rejects.toThrow("deadline");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("surfaces a terminal with no accepted result without re-executing", async () => {
    await expect(waitForOneShotResult({ scope, timeoutMs: 100, read: async () => ({ state: "failed" }), cancel: vi.fn() })).rejects.toThrow();
  });
  it("bounds a stuck result read and requests cancellation", async () => {
    const cancel = vi.fn();
    await expect(waitForOneShotResult({ scope, timeoutMs: 20, read: () => new Promise(() => {}), cancel })).rejects.toThrow("deadline");
    expect(cancel).toHaveBeenCalledOnce();
  });
});

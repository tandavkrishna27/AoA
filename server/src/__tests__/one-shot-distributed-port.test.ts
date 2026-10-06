import { describe, expect, it, vi } from "vitest";
import { createOneShotDistributedPort } from "../services/one-shot-distributed-port.js";
const input = { operationId: "a1000000-0000-4000-8000-000000000001", companyId: "company", cliTool: "codex", command: "codex", args: ["exec"], timeoutMs: 100, source: "extraction" as const, stdinContent: "private prompt" };
function fixture() {
  const rollout = { resolveRunRolloutState: vi.fn().mockResolvedValue({ state: "canary", organizationId: "org" }),
    resolveExecutionOwner: vi.fn().mockResolvedValue({ owner: "distributed", jobId: "job", attemptId: "attempt" }) };
  const result = { version: 1, operationId: input.operationId, stdout: "answer", stderr: "", exitCode: 0, timedOut: false, durationMs: 3, captureError: null };
  const read = vi.fn().mockResolvedValue({ state: "result", result }); const cancel = vi.fn();
  return { rollout, read, cancel, result, port: createOneShotDistributedPort({ rollout: rollout as never, read, cancel }) };
}
describe("one-shot distributed handoff", () => {
  it("stages the actual prompt before placement and awaits the accepted result", async () => {
    const f = fixture(); await expect(f.port.execute(input)).resolves.toEqual(f.result);
    const handed = f.rollout.resolveExecutionOwner.mock.calls[0]![0];
    expect(handed.source).toEqual({ kind: "one_shot", operationId: input.operationId, operationKind: "extraction" });
    expect(handed.actor).toEqual({ kind: "system", companyId: input.companyId, id: input.companyId });
    expect(JSON.stringify(handed.input)).not.toContain(input.stdinContent);
    expect(handed.stagedFiles.length).toBe(2);
    expect(f.read).toHaveBeenCalledWith({ companyId: input.companyId, organizationId: "org", jobId: "job", attemptId: "attempt", operationId: input.operationId }, expect.any(AbortSignal));
  });
  it.each(["off", "shadow", "active"])("leaves %s execution legacy", async (state) => {
    const f = fixture(); f.rollout.resolveRunRolloutState.mockResolvedValue({ state, organizationId: "org" });
    await expect(f.port.execute(input)).resolves.toBeNull(); expect(f.rollout.resolveExecutionOwner).not.toHaveBeenCalled();
  });
  it("does not hand a caller-owned legacy batch lease to a second executor", async () => {
    const f = fixture(); await expect(f.port.execute({ ...input, sandboxHandle: {} as never })).resolves.toBeNull();
    expect(f.rollout.resolveRunRolloutState).not.toHaveBeenCalled();
  });
  it("can fall back only before a leasable ownership transfer", async () => {
    const f = fixture(); f.rollout.resolveExecutionOwner.mockResolvedValue({ owner: "legacy", reason: "placement_not_leasable" } as never);
    await expect(f.port.execute(input)).resolves.toBeNull(); expect(f.read).not.toHaveBeenCalled();
  });
  it("throws on a post-transfer storage failure instead of selecting legacy", async () => {
    const f = fixture(); f.read.mockRejectedValue(new Error("storage offline"));
    await expect(f.port.execute(input)).rejects.toThrow("storage offline");
    expect(f.rollout.resolveExecutionOwner).toHaveBeenCalledOnce();
  });
  it("rejoins a durable placed operation after restart without staging or placing again", async () => {
    const f = fixture(); const existing = vi.fn(async () => ({ jobId: "durable-job", attemptId: "durable-attempt" }));
    const port = createOneShotDistributedPort({ rollout: f.rollout as never, read: f.read, cancel: f.cancel, existing });
    await expect(port.execute(input)).resolves.toEqual(f.result);
    expect(f.rollout.resolveExecutionOwner).not.toHaveBeenCalled();
    expect(f.read.mock.calls[0]![0]).toMatchObject({ jobId: "durable-job", attemptId: "durable-attempt" });
  });
});

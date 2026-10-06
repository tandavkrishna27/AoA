import { describe, expect, it, vi } from "vitest";
import { createCommanderDistributedPort } from "../services/commander-distributed-port.js";
const turnId = "c2000000-0000-4000-8000-000000000001";
const input = { companyId: "c1000000-0000-4000-8000-000000000001", turnId, userId: "actual-user", userRole: "team_member", conversationId: "c3000000-0000-4000-8000-000000000001", messageId: "c4000000-0000-4000-8000-000000000001", cliTool: "claude_cli", content: "prompt", model: "claude-sonnet-4-6", apiBaseUrl: "https://aoa.example/api", timeoutMs: 1000 };
const captured = { version: 1 as const, operationId: turnId, stdout: "answer", stderr: "", exitCode: 0, timedOut: false, durationMs: 20, captureError: null };
function deps(state = "canary") {
  return { rollout: { resolveRunRolloutState: vi.fn(async () => ({ state, organizationId: "org" })),
      resolveExecutionOwner: vi.fn(async () => ({ owner: "distributed", jobId: "job", attemptId: "attempt" })) },
    toolsAuthorized: vi.fn(() => true), existing: vi.fn(async () => null), prepare: vi.fn(async () => true),
    preflight: vi.fn(async () => ({ allowed: true })), read: vi.fn(async () => ({ state: "result", result: captured })), cancel: vi.fn(async () => undefined) };
}
describe("Commander actual distributed dispatch", () => {
  it("binds the actual user/turn/conversation and consumes accepted output after transfer", async () => {
    const d = deps(); expect(await createCommanderDistributedPort(d as never).execute(input)).toEqual(captured);
    expect(d.rollout.resolveExecutionOwner).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: "commander_turn", internalAgentRunId: turnId, conversationId: input.conversationId }, actor: { kind: "user", id: input.userId, role: input.userRole, companyId: input.companyId }, toolSurfaceAuthorized: true }));
    expect(d.prepare).toHaveBeenCalledOnce(); expect(d.read).toHaveBeenCalledOnce();
  });
  it.each(["off", "shadow", "active"])("declines %s before source writes, spend or placement", async (state) => {
    const d = deps(state); expect(await createCommanderDistributedPort(d as never).execute(input)).toBeNull();
    expect(d.prepare).not.toHaveBeenCalled(); expect(d.preflight).not.toHaveBeenCalled(); expect(d.rollout.resolveExecutionOwner).not.toHaveBeenCalled();
  });
  it("rejoins a durable owner before budget checks or a new dispatch", async () => {
    const d = deps(); d.existing.mockResolvedValue({ organizationId: "org", jobId: "existing", attemptId: "old-attempt" } as never);
    expect(await createCommanderDistributedPort(d as never).execute(input)).toEqual(captured);
    expect(d.preflight).not.toHaveBeenCalled(); expect(d.prepare).not.toHaveBeenCalled(); expect(d.rollout.resolveExecutionOwner).not.toHaveBeenCalled();
    expect(d.read).toHaveBeenCalledWith(expect.objectContaining({ jobId: "existing", attemptId: "old-attempt" }), expect.anything());
  });
  it.each(["tools", "budget", "source", "placement"])("declines before transfer when %s denies", async (reason) => {
    const d = deps();
    if (reason === "tools") d.toolsAuthorized.mockReturnValue(false);
    if (reason === "budget") d.preflight.mockResolvedValue({ allowed: false } as never);
    if (reason === "source") d.prepare.mockResolvedValue(false);
    if (reason === "placement") d.rollout.resolveExecutionOwner.mockResolvedValue({ owner: "legacy" } as never);
    if (reason === "budget" || reason === "source") await expect(createCommanderDistributedPort(d as never).execute(input)).rejects.toThrow();
    else expect(await createCommanderDistributedPort(d as never).execute(input)).toBeNull();
    expect(d.read).not.toHaveBeenCalled();
  });
  it("rejoins the original paid operation and uses its fallback cost key", async () => {
    const d = deps("off");
    const original = "c2000000-0000-4000-8000-000000000002";
    d.existing.mockResolvedValue({ organizationId: "org", jobId: "existing", attemptId: "old-attempt", operationId: original } as never);
    d.read.mockResolvedValue({ state: "result", result: { ...captured, operationId: original } } as never);
    const recordFallback = vi.fn(async () => undefined);
    expect(await createCommanderDistributedPort({ ...d, recordFallback } as never).execute(input)).toMatchObject({ operationId: original });
    expect(recordFallback).toHaveBeenCalledWith(expect.objectContaining({ turnId: original }), expect.objectContaining({ operationId: original }));
    expect(d.rollout.resolveExecutionOwner).not.toHaveBeenCalled();
    expect(d.preflight).not.toHaveBeenCalled();
  });
  it("does not write a fallback estimate when the accepted usage ledger already owns cost", async () => {
    const d = deps();
    d.read.mockResolvedValue({ state: "result", result: { ...captured, usageAccepted: true } } as never);
    const recordFallback = vi.fn(async () => undefined);
    await createCommanderDistributedPort({ ...d, recordFallback } as never).execute(input);
    expect(recordFallback).not.toHaveBeenCalled();
  });
  it("bounds an unavailable fallback cost write without dispatching again", async () => {
    vi.useFakeTimers();
    try {
      const d = deps();
      const recordFallback = vi.fn(() => new Promise<void>(() => {}));
      const pending = createCommanderDistributedPort({ ...d, recordFallback } as never).execute(input);
      const rejected = expect(pending).rejects.toThrow("Commander fallback cost write timed out");
      await vi.advanceTimersByTimeAsync(5001);
      await rejected;
      expect(d.rollout.resolveExecutionOwner).toHaveBeenCalledOnce();
      expect(recordFallback).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it("persists an accepted reply before returning it to the HTTP consumer", async () => {
    const d = deps(); const persistReply = vi.fn(async () => undefined);
    expect(await createCommanderDistributedPort({ ...d, persistReply } as never).execute(input)).toMatchObject({ replyPersisted: true });
    expect(persistReply).toHaveBeenCalledWith(input, expect.objectContaining({ operationId: turnId, jobId: "job" }), captured);
  });
  it("preserves warm conversation ownership before any new spend or placement", async () => {
    const d = deps();
    expect(await createCommanderDistributedPort(d as never).execute({ ...input, warmConversation: true })).toBeNull();
    expect(d.preflight).not.toHaveBeenCalled(); expect(d.prepare).not.toHaveBeenCalled();
    expect(d.rollout.resolveExecutionOwner).not.toHaveBeenCalled();
  });
  it("delivers accepted live Claude deltas once and withholds terminal until the accepted result", async () => {
    const d = deps(); const onChunk = vi.fn();
    const readLive = vi.fn(async () => [{ sequence: 1, text: '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"early"}}}\n' },
      { sequence: 2, text: '{"type":"result","usage":{"input_tokens":1,"output_tokens":1},"duration_ms":1}\n' }]);
    await createCommanderDistributedPort({ ...d, readLive } as never).execute(input, onChunk);
    expect(readLive).toHaveBeenCalledWith(expect.objectContaining({ operationId: turnId }), 0, expect.anything());
    expect(onChunk).toHaveBeenCalledWith({ type: "text", delta: "early" });
    expect(onChunk.mock.calls.some((call) => call[0].type === "done")).toBe(false);
  });
  it("cancels owned work when the accepted live log reader loses source authority", async () => {
    const d = deps(); const readLive = vi.fn(async () => { throw new Error("Commander stream authority mismatch"); });
    await expect(createCommanderDistributedPort({ ...d, readLive } as never).execute(input, vi.fn())).rejects.toThrow("authority mismatch");
    expect(d.cancel).toHaveBeenCalledOnce(); expect(d.read).not.toHaveBeenCalled();
    expect(d.rollout.resolveExecutionOwner).toHaveBeenCalledOnce();
  });
  it("never returns a legacy decline after an accepted-output read fails", async () => {
    const d = deps(); d.read.mockRejectedValue(new Error("storage unavailable"));
    await expect(createCommanderDistributedPort(d as never).execute(input)).rejects.toThrow("storage unavailable");
    expect(d.cancel).toHaveBeenCalledOnce(); expect(d.rollout.resolveExecutionOwner).toHaveBeenCalledOnce();
  });
});

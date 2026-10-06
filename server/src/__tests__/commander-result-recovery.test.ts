import { describe, expect, it, vi } from "vitest";
import { createCommanderResultRecovery } from "../services/commander-result-recovery.js";
const candidate = { organizationId: "org", companyId: "company", operationId: "paid-turn", jobId: "job", attemptId: "attempt",
  userId: "user", conversationId: "conversation", messageId: "message", model: "gpt-4.1", cliTool: "codex" };
const result = { version: 1 as const, operationId: candidate.operationId, stdout: "answer", stderr: "", exitCode: 0,
  timedOut: false, durationMs: 1, captureError: null };
function dependencies() { return { list: vi.fn(async () => [candidate]), read: vi.fn(async () => ({ state: "result", result })),
  project: vi.fn(async () => undefined), onError: vi.fn() }; }
describe("Commander durable result recovery", () => {
  it("projects the original paid turn without any placement or provider call", async () => {
    const d = dependencies(); await createCommanderResultRecovery(d as never).tick();
    expect(d.project).toHaveBeenCalledWith(candidate, result); expect(d.onError).not.toHaveBeenCalled();
  });
  it.each(["pending", "failed"])("does not invent a reply for %s work", async (state) => {
    const d = dependencies(); d.read.mockResolvedValue({ state } as never);
    await createCommanderResultRecovery(d as never).tick(); expect(d.project).not.toHaveBeenCalled();
  });
  it("retries a failed projection on the next sweep", async () => {
    const d = dependencies(); d.project.mockRejectedValueOnce(new Error("storage unavailable"));
    const recovery = createCommanderResultRecovery(d as never); await recovery.tick(); await recovery.tick();
    expect(d.project).toHaveBeenCalledTimes(2); expect(d.onError).toHaveBeenCalledOnce();
  });
  it("retires stopped owned work after an authority read fails", async () => {
    const d = dependencies(); d.read.mockRejectedValue(new Error("membership revoked"));
    const retire = vi.fn(async () => undefined);
    await createCommanderResultRecovery({ ...d, retire } as never).tick();
    expect(retire).toHaveBeenCalledWith(candidate); expect(d.project).not.toHaveBeenCalled();
    expect(d.onError).toHaveBeenCalledOnce();
  });
  it("bounds retirement failures so the convergence sweep cannot get stuck", async () => {
    vi.useFakeTimers();
    try {
      const d = dependencies(); d.read.mockRejectedValue(new Error("membership revoked"));
      const retire = vi.fn(() => new Promise<void>(() => {})); let finished = false;
      const tick = createCommanderResultRecovery({ ...d, retire } as never).tick().then(() => { finished = true; });
      await vi.advanceTimersByTimeAsync(5001);
      expect(finished).toBe(true); await tick;
      expect(d.onError).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it("releases the sweep lock when listing owned work stalls", async () => {
    vi.useFakeTimers();
    try {
      const d = dependencies(); d.list.mockImplementationOnce(() => new Promise(() => {}));
      const recovery = createCommanderResultRecovery(d as never);
      const failed = recovery.tick().then(() => "unexpected success", (error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(5001);
      expect(await Promise.race([failed, Promise.resolve("still blocked")])).toBe("Commander recovery listing deadline");
      await recovery.tick(); expect(d.project).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it("joins concurrent ticks to one sweep", async () => {
    const d = dependencies(); const recovery = createCommanderResultRecovery(d as never);
    await Promise.all([recovery.tick(), recovery.tick()]); expect(d.list).toHaveBeenCalledOnce(); expect(d.project).toHaveBeenCalledOnce();
  });
});

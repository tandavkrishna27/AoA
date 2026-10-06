import { describe, expect, it, vi } from "vitest";
import { createCommanderWarmRecovery, createCommanderWarmTerminalHook, type CommanderWarmRecoveryCandidate } from "../services/commander-warm-recovery.js";
const row = (id: string): CommanderWarmRecoveryCandidate => ({ organizationId: "org", companyId: "company",
  jobId: "job-" + id, attemptId: "attempt-" + id, operationId: id });
describe("warm checkpoint convergence", () => {
  it("projects first and preserves the downstream after-commit hook", async () => {
    const order: string[] = [];
    const hook = createCommanderWarmTerminalHook({ project: async () => { order.push("warm"); },
      downstream: async () => { order.push("downstream"); }, onError: vi.fn() });
    await hook({ ...row("1"), terminalStatus: "succeeded" }); expect(order).toEqual(["warm", "downstream"]);
  });
  it("contains projector and logging errors without suppressing the downstream consumer", async () => {
    const downstream = vi.fn();
    await createCommanderWarmTerminalHook({ project: async () => { throw new Error("db unavailable"); },
      downstream, onError: () => { throw new Error("logger unavailable"); } })({ ...row("1"), terminalStatus: "succeeded" });
    expect(downstream).toHaveBeenCalledTimes(1);
  });
  it("shares an in-flight sweep rather than starting a duplicate", async () => {
    let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; });
    const list = vi.fn(async () => { await blocked; return [row("completed-turn")]; }); const project = vi.fn();
    const recovery = createCommanderWarmRecovery({ list, project, onError: vi.fn() });
    const first = recovery.tick(), second = recovery.tick(); expect(second).toBe(first);
    release(); await first; expect(list).toHaveBeenCalledTimes(1); expect(project).toHaveBeenCalledWith(row("completed-turn"));
  });
  it("advances full pages fairly through a failed candidate and wraps after the final page", async () => {
    const page = Array.from({ length: 32 }, (_, i) => row(String(i).padStart(2, "0")));
    const list = vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce([row("last")]).mockResolvedValueOnce([]);
    const error = vi.fn(); const project = vi.fn(async (scope) => { if (scope.operationId === "04") throw new Error("retry"); });
    const recovery = createCommanderWarmRecovery({ list, project, onError: error });
    await recovery.tick(); await recovery.tick(); await recovery.tick();
    expect(list.mock.calls.map((call) => call[0])).toEqual([null, "31", null]);
    expect(project).toHaveBeenCalledTimes(33); expect(error).toHaveBeenCalledTimes(1);
  });
});

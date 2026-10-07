import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ navigate: vi.fn(async () => {}), close: vi.fn(async () => {}) }));
vi.mock("../playwright-driver.js", () => ({ createPlaywrightDriver: () => ({
  launch: async () => ({ navigate: calls.navigate, close: calls.close, collectDownloads: async () => [] }),
}) }));
vi.mock("../listening-ports.js", () => ({ readListeningPorts: async () => [], listeningPortDelta: () => [] }));
import { runFromConfig, type RunnerConfig } from "../runner.js";
import { fixtureNetwork } from "./network-fixture.js";

describe("guest runner approval composition", () => {
  it("refuses absent network authority before a browser operation", async () => {
    calls.navigate.mockClear(); calls.close.mockClear();
    await expect(runFromConfig({ launch: { chromiumSandbox: true }, steps: [] } as unknown as RunnerConfig)).rejects.toThrow();
    expect(calls.navigate).not.toHaveBeenCalled(); expect(calls.close).not.toHaveBeenCalled();
  });
  it.each(["allow_once", "deny"] as const)("waits for %s before navigation", async (decision) => {
    calls.navigate.mockClear(); calls.close.mockClear();
    const directory = await mkdtemp(join(tmpdir(), "aoa-runner-approval-"));
    const listenersBefore = [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")];
    let listenersDuring: number[] = [];
    let emitted = false; let beforeDecision = -1;
    const output = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      const message = JSON.parse(String(chunk)) as { type: string; requestId: string };
      if (message.type === "approval_requested") {
        listenersDuring = [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")];
        emitted = true; beforeDecision = calls.navigate.mock.calls.length;
        void writeFile(join(directory, `${message.requestId}.json`), JSON.stringify({ requestId: message.requestId,
          decision, expiresAt: new Date(Date.now() + 1000).toISOString() }));
      }
      return true;
    });
    try {
      const config: RunnerConfig & { approvalDirectory: string } = {
        ...fixtureNetwork(),
        userDataDir: join(directory, "profile"), downloadsStagingPath: join(directory, "staging"),
        downloadRoot: join(directory, "downloads"), steps: [{ action: "navigate", url: "https://example.com" }],
        launch: { chromiumSandbox: true }, requireApproval: true, approvalTimeoutMs: 1000, approvalDirectory: directory,
      };
      const result = await runFromConfig(config);
      expect(emitted).toBe(true); expect(beforeDecision).toBe(0);
      expect(listenersDuring).toEqual(listenersBefore);
      expect(result.ok).toBe(decision === "allow_once");
      expect(calls.navigate).toHaveBeenCalledTimes(decision === "allow_once" ? 1 : 0);
      expect(calls.close).toHaveBeenCalledTimes(1);
    } finally { output.mockRestore(); await rm(directory, { recursive: true, force: true }); }
  });
  it("preserves normal termination while navigation runs without approval", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aoa-runner-signal-"));
    const listenersBefore = [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")];
    let listenersDuring: number[] = [];
    calls.navigate.mockImplementationOnce(async () => {
      listenersDuring = [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")];
    });
    try {
      const result = await runFromConfig({ ...fixtureNetwork(), userDataDir: join(directory, "profile"), downloadsStagingPath: join(directory, "staging"),
        downloadRoot: join(directory, "downloads"), steps: [{ action: "navigate", url: "https://example.com" }],
        launch: { chromiumSandbox: true }, requireApproval: false });
      expect(result.ok).toBe(true);
      expect(listenersDuring).toEqual(listenersBefore);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

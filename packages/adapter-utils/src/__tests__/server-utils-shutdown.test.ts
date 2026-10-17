import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let processes: typeof import("../server-utils.js");

beforeEach(async () => {
  vi.resetModules();
  processes = await import("../server-utils.js");
});

afterEach(async () => {
  vi.useRealTimers();
  for (const runId of processes.runningProcesses.keys()) processes.requestTrackedProcessTermination(runId);
  await Promise.all([...processes.runningProcesses.keys()].map((runId) => processes.waitForTrackedProcessExit(runId)));
});

describe("tracked process shutdown", () => {
  it("closes admission synchronously and waits for the actual running child to close", async () => {
    const runId = randomUUID();
    const handle = processes.spawnTrackedChild(runId, process.execPath, ["-e", "process.stdout.write('ready');setTimeout(() => {}, 60000)"], {
      cwd: tmpdir(), env: {}, graceSec: 1, shell: false,
    });
    await new Promise<void>((resolve, reject) => {
      handle.child.stdout!.once("data", () => resolve());
      handle.child.once("error", reject);
    });
    let closed = false;
    handle.child.once("close", () => { closed = true; });
    processes.closeTrackedProcessAdmission();
    expect(() => processes.spawnTrackedChild(randomUUID(), process.execPath, ["-e", "process.exit(0)"], {
      cwd: tmpdir(), env: {}, graceSec: 1, shell: false,
    })).toThrow("shutting down");
    await processes.drainTrackedProcesses();
    expect(closed).toBe(true);
    expect(processes.runningProcesses.has(runId)).toBe(false);
  });

  it("does not treat registry removal as observed child close and reports the bounded failure", async () => {
    vi.useFakeTimers();
    const runId = randomUUID();
    const child = Object.assign(new EventEmitter(), { pid: undefined, killed: false, kill: vi.fn(() => true) });
    processes.runningProcesses.set(runId, { child: child as never, processGroupId: null, graceSec: 1 });
    processes.closeTrackedProcessAdmission();
    const draining = processes.drainTrackedProcesses();
    const rejected = expect(draining).rejects.toThrow("did not close");
    processes.runningProcesses.delete(runId);
    await vi.advanceTimersByTimeAsync(3001);
    await rejected;
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(child.listenerCount("close")).toBe(0);
  });

  it.skipIf(process.platform === "win32")("escalates an uncooperative POSIX child before returning", async () => {
    const runId = randomUUID();
    const handle = processes.spawnTrackedChild(runId, process.execPath, ["-e", "process.on('SIGTERM', () => {});process.stdout.write('ready');setInterval(() => {}, 1000)"], {
      cwd: tmpdir(), env: {}, graceSec: 1, shell: false,
    });
    await new Promise<void>((resolve, reject) => {
      handle.child.stdout!.once("data", () => resolve());
      handle.child.once("error", reject);
    });
    const terminal = new Promise<NodeJS.Signals | null>((resolve) => handle.child.once("close", (_code, signal) => resolve(signal)));
    processes.closeTrackedProcessAdmission();
    await processes.drainTrackedProcesses();
    expect(await terminal).toBe("SIGKILL");
  });
});

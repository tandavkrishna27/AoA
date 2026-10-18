import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { startMigratedDatabase } from "./helpers/migrated-database.js";

const enabled = process.platform !== "win32" || process.env.AOA_RUN_WIN_INTEGRATION === "1";
const logs: string[] = [];
let restoreLogger: (() => void) | undefined;
beforeAll(() => {
  const logger = vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => { logs.push(values.map(String).join(" ")); });
  restoreLogger = () => logger.mockRestore();
});
beforeEach(() => { logs.length = 0; });
afterAll(() => { restoreLogger?.(); });

function windowsSnapshot(pid: number, port: number) {
  if (process.platform !== "win32") return null;
  const command = `$processes=@(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid} OR ParentProcessId = ${pid}' | Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine); $listeners=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess); [ordered]@{processes=$processes;listeners=$listeners}|ConvertTo-Json -Depth 5 -Compress`;
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8", windowsHide: true, timeout: 15_000,
  })) as { processes: unknown[]; listeners: unknown[] };
}

async function rebind(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close((error) => error ? reject(error) : resolve()));
  });
}

it.skipIf(!enabled).each([1, 2, 3])("migrated fixture gracefully releases its processes, directory and port (cycle %i)", async (cycle) => {
  let database: Awaited<ReturnType<typeof startMigratedDatabase>> | undefined;
  let teardownAttempted = false;
  try {
    database = await startMigratedDatabase({ label: "aoa-fixture-teardown-" });
    const location = await database.admin<{ data_directory: string }[]>`SHOW data_directory`;
    const dataDirectory = location[0].data_directory;
    const identity = readFileSync(join(dataDirectory, "postmaster.pid"), "utf8").split(/\r?\n/);
    const pid = Number(identity[0]);
    const port = Number(new URL(database.adminUrl).port);
    expect(pid).toBeGreaterThan(0);
    const before = windowsSnapshot(pid, port);
    await database.admin`CREATE TABLE fixture_shutdown_io AS SELECT generate_series(1, 10000) AS value`;
    const count = await database.admin<{ count: number }[]>`SELECT count(*)::int AS count FROM fixture_shutdown_io`;
    expect(count[0].count).toBe(10_000);
    teardownAttempted = true;
    await database.teardown();
    await vi.waitFor(() => {
      expect(logs.some((line) => line.includes("received fast shutdown request"))).toBe(true);
      expect(logs.some((line) => line.includes("database system is shut down"))).toBe(true);
    }, { timeout: 5000, interval: 10 });
    const after = windowsSnapshot(pid, port);
    const shutdownRequested = logs.some((line) => line.includes("received fast shutdown request"));
    const shutdownCompleted = logs.some((line) => line.includes("database system is shut down"));
    const receipt = { cycle, platform: process.platform, pid, port, identity: identity.slice(0, 4), before, after, shutdownRequested, shutdownCompleted, directoryAbsent: !existsSync(dirname(dataDirectory)), logs };
    if (process.env.AOA_FIXTURE_RECEIPTS_DIR) {
      mkdirSync(process.env.AOA_FIXTURE_RECEIPTS_DIR, { recursive: true });
      writeFileSync(join(process.env.AOA_FIXTURE_RECEIPTS_DIR, `cycle-${cycle}.json`), JSON.stringify(receipt, null, 2) + "\n");
    }
    expect(shutdownRequested, "must request PostgreSQL fast shutdown, not force-kill the postmaster").toBe(true);
    expect(shutdownCompleted, "must await a normal PostgreSQL shutdown").toBe(true);
    expect(existsSync(dirname(dataDirectory))).toBe(false);
    if (after) {
      expect(after.processes, "owned postmaster/children must be gone").toEqual([]);
      expect(after.listeners, "both address-family listeners must be gone").toEqual([]);
    }
    await rebind(port);
    await database.teardown();
  } finally {
    if (database && !teardownAttempted) await database.teardown();
  }
}, 180_000);

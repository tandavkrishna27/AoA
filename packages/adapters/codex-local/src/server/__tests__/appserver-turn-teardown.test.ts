import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runningProcesses } from "@armyofagents/adapter-utils/server-utils";
import { spawnAppServerClient, type SpawnedAppServerClient } from "../app-server/jsonrpc-client.js";
import { defaultRunAppServerTurnDeps, runAppServerTurn } from "../execute-app-server.js";

describe("runAppServerTurn owned child teardown", () => {
  it.each([false, true])("closes its tracked child after a turn (handshake failure: %s)", async (failHandshake) => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-appserver-teardown-"));
    const runId = `appserver-turn-teardown-${path.basename(workspace)}`;
    let spawned: SpawnedAppServerClient | undefined;
    let closed = false;
    let childClosed: Promise<void> | undefined;
    await fs.writeFile(path.join(workspace, "app-server"), `
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const frame = JSON.parse(line);
  if (frame.id === undefined) return;
  if (frame.method === "initialize" && ${failHandshake}) {
    process.stdout.write(JSON.stringify({ id: frame.id, error: { code: -1, message: "fixture handshake refused" } }) + "\\n");
    return;
  }
  const result = frame.method === "thread/start" ? { thread: { id: "fixture-thread" } } : {};
  process.stdout.write(JSON.stringify({ id: frame.id, result }) + "\\n");
  if (frame.method === "turn/start") {
    process.stdout.write(JSON.stringify({ method: "turn/completed", params: { turn: { id: "fixture-turn", status: "completed", error: null } } }) + "\\n");
  }
});
`, "utf8");
    try {
      const turn = runAppServerTurn({
        runId,
        command: process.execPath,
        cwd: workspace,
        env: {},
        prompt: "fixture turn",
        timeoutSec: 2,
        graceSec: 0.1,
        deps: {
          ...defaultRunAppServerTurnDeps,
          spawnAppServerClient: (options) => {
            spawned = spawnAppServerClient({ ...options, shell: false });
            childClosed = new Promise<void>((resolve) => {
              spawned!.child.once("close", () => { closed = true; resolve(); });
            });
            return spawned;
          },
        },
      });
      if (failHandshake) await expect(turn).rejects.toThrow("fixture handshake refused");
      else expect((await turn).timedOut).toBe(false);

      await Promise.race([childClosed, new Promise((resolve) => setTimeout(resolve, 750))]);

      expect(closed).toBe(true);
      expect(runningProcesses.has(runId)).toBe(false);
    } finally {
      if (!closed) spawned?.terminate();
      await childClosed;
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

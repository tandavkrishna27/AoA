import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runningProcesses } from "@armyofagents/adapter-utils/server-utils";
import { execute } from "./execute.js";
import { resetOpenCodeModelsCacheForTests } from "./models.js";

const cleanupPaths = new Set<string>();

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetOpenCodeModelsCacheForTests();
  for (const cleanupPath of cleanupPaths) {
    await fs.rm(cleanupPath, { recursive: true, force: true });
  }
  cleanupPaths.clear();
});

async function runFixture(mode: "timeout" | "stdio" | "http" | "none") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-opencode-w02-"));
  cleanupPaths.add(root);
  vi.spyOn(os, "homedir").mockReturnValue(root);
  vi.stubEnv("AOA_HOME", path.join(root, "aoa-home"));
  vi.stubEnv("SECONDARY_CONTEXT", "fixture-run-bearer");
  const capturePath = path.join(root, "bearers.json");
  const scriptPath = path.join(root, "fixture.cjs");
  const script = `const fs = require("node:fs");
if (process.argv[2] === "models") {
  console.log("fixture/model");
  process.exit(0);
}
fs.readFileSync(0, "utf8");
fs.writeFileSync(process.env.AOA_TEST_CAPTURE_PATH, JSON.stringify({
  bearer: process.env.AOA_API_KEY,
  alias: process.env.CUSTOM_CONTEXT,
  ambientAlias: process.env.SECONDARY_CONTEXT,
}));
console.log(JSON.stringify({ type: "text", sessionID: "fixture-session", part: { text: "partial work" } }));
console.log(JSON.stringify({ type: "step_finish", sessionID: "fixture-session", part: {
  reason: "tool-calls", cost: 0.004,
  tokens: { input: 120, output: 30, reasoning: 5, cache: { read: 20, write: 0 } },
} }));
if (process.env.AOA_TEST_HANG === "yes") setInterval(() => {}, 1000);
`;
  await fs.writeFile(scriptPath, script);
  const commandPath = path.join(root, process.platform === "win32" ? "opencode-fixture.cmd" : "opencode-fixture");
  await fs.writeFile(commandPath, process.platform === "win32"
    ? `@"${process.execPath}" "${scriptPath}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`);
  if (process.platform !== "win32") await fs.chmod(commandPath, 0o755);
  const result = await execute({
    runId: `opencode-w02-${mode}`,
    agent: { id: "fixture-agent", companyId: "fixture-company", name: "Fixture", adapterType: "opencode_local", adapterConfig: {} },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: {
      cwd: root,
      command: commandPath,
      model: "fixture/model",
      timeoutSec: 1.5,
      graceSec: 0.1,
      env: {
        XDG_CONFIG_HOME: path.join(root, "config"),
        AOA_TEST_CAPTURE_PATH: capturePath,
        AOA_TEST_HANG: mode === "timeout" ? "yes" : "no",
        CUSTOM_CONTEXT: "fixture-run-bearer",
      },
    },
    context: {},
    authToken: "fixture-run-bearer",
    ...(mode === "stdio" ? { mcpServers: { fixture: { kind: "stdio" as const, command: "unused-fixture-connector", args: [], env: {} } } } : {}),
    ...(mode === "http" ? { mcpServers: { fixture: { kind: "http" as const, url: "https://fixture.invalid/mcp", headers: {} } } } : {}),
    onLog: async () => {},
  });
  return { result, captured: JSON.parse(await fs.readFile(capturePath, "utf8")) };
}

describe("OpenCode W02 subprocess regressions", () => {
  it("retains observed usage and provider identity when the tracked child times out", async () => {
    const { result } = await runFixture("timeout");
    expect(result.timedOut).toBe(true);
    expect(result.errorMessage).toContain("Timed out");
    expect(runningProcesses.has("opencode-w02-timeout")).toBe(false);
    expect(result).toMatchObject({
      provider: "fixture",
      model: "fixture/model",
      billingType: "unknown",
      usage: { inputTokens: 120, outputTokens: 35, cachedInputTokens: 20 },
      costUsd: 0.004,
    });
  });

  it("removes run bearer aliases from the prepared environment of stdio connector runs", async () => {
    const { result, captured } = await runFixture("stdio");
    expect(result.exitCode).toBe(0);
    expect(captured.bearer).toBeUndefined();
    expect(captured.alias).toBeUndefined();
    expect(captured.ambientAlias).toBeUndefined();
  });

  it.each(["none", "http"] as const)("preserves run bearer aliases for %s connector runs", async (mode) => {
    const { result, captured } = await runFixture(mode);
    expect(result.exitCode).toBe(0);
    expect(captured).toEqual({
      bearer: "fixture-run-bearer",
      alias: "fixture-run-bearer",
      ambientAlias: "fixture-run-bearer",
    });
  });
});

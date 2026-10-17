import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { execute } from "../server/execute.js";

async function executeProtocol(resultEvent: Record<string, unknown>, hang = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-claude-native-outcome-"));
  const events = [
    { type: "system", subtype: "init", session_id: "fixture-session", model: "claude-observed" },
    { type: "result", usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 20 }, total_cost_usd: 0.012, ...resultEvent },
  ];
  const script = `#!/usr/bin/env node\nrequire("node:fs").readFileSync(0, "utf8");\n${events.map((event) => `console.log(${JSON.stringify(JSON.stringify(event))});`).join("\n")}\n${hang ? "setInterval(() => {}, 1000);" : ""}\n`;
  const command = path.join(root, process.platform === "win32" ? "agent.cmd" : "agent");
  await fs.writeFile(path.join(root, "agent.cjs"), script, "utf8");
  await fs.writeFile(command, process.platform === "win32" ? '@node "%~dp0agent.cjs" %*\r\n' : script, "utf8");
  await fs.chmod(command, 0o755);
  try {
    return await execute({
      runId: "claude-native-outcome",
      agent: { id: "agent-fixture", companyId: "company-fixture", name: "Claude Fixture", adapterType: "claude_local", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command, cwd: root, model: "claude-configured", timeoutSec: hang ? 1.5 : 10, graceSec: 0.1 },
      context: {},
      onLog: async () => {},
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("Claude native protocol outcome", () => {
  it("retains observed model and usage for a successful terminal result", async () => {
    const result = await executeProtocol({ subtype: "success", result: "Fixture complete", is_error: false });
    expect(result.model).toBe("claude-observed");
    expect(result.provider).toBe("anthropic");
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 40, cachedInputTokens: 20 });
    expect(result.costUsd).toBe(0.012);
    expect(result.errorMessage).toBeNull();
  });

  it("fails closed for an explicit error result even when the child exits zero", async () => {
    const result = await executeProtocol({ subtype: "success", is_error: true, result: "Fixture request denied" });
    expect(result.exitCode).toBe(0);
    expect(result.errorMessage).toContain("Fixture request denied");
  });

  it("retains reported model and usage when the child times out", async () => {
    const result = await executeProtocol({ subtype: "success", result: "Fixture complete", is_error: false }, true);
    expect(result.timedOut).toBe(true);
    expect(result.errorMessage).toContain("Timed out");
    expect(result).toMatchObject({ model: "claude-observed", provider: "anthropic", usage: { inputTokens: 100, outputTokens: 40, cachedInputTokens: 20 }, costUsd: 0.012 });
  });
});

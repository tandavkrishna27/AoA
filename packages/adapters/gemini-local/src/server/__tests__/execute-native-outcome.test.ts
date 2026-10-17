import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { execute } from "../execute.js";

async function executeProtocol(events: Record<string, unknown>[], model = "gemini-configured", hang = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-gemini-native-outcome-"));
  const script = `#!/usr/bin/env node\n${events.map((event) => `console.log(${JSON.stringify(JSON.stringify(event))});`).join("\n")}\n${hang ? "setInterval(() => {}, 1000);" : ""}\n`;
  const command = path.join(root, process.platform === "win32" ? "agent.cmd" : "agent");
  await fs.writeFile(path.join(root, "agent.cjs"), script, "utf8");
  await fs.writeFile(command, process.platform === "win32" ? '@node "%~dp0agent.cjs" %*\r\n' : script, "utf8");
  await fs.chmod(command, 0o755);
  try {
    return await execute({
      runId: "gemini-native-outcome",
      agent: { id: "agent-fixture", companyId: "company-fixture", name: "Gemini Fixture", adapterType: "gemini_local", adapterConfig: {} },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: { command, cwd: root, model, timeoutSec: hang ? 1.5 : 10, graceSec: 0.1 },
      context: {},
      onLog: async () => {},
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("Gemini native protocol outcome", () => {
  it("retains the observed init model and usage instead of the configured selection", async () => {
    const result = await executeProtocol([
      { type: "init", session_id: "fixture-session", model: "gemini-observed" },
      { type: "result", status: "success", stats: { input_tokens: 100, output_tokens: 40, cached: 20 }, total_cost_usd: 0.012 },
    ]);
    expect(result.model).toBe("gemini-observed");
    expect(result.provider).toBe("google");
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 40, cachedInputTokens: 20 });
    expect(result.costUsd).toBe(0.012);
    expect(result.errorMessage).toBeNull();
  });

  it("uses the configured model when the protocol does not report one", async () => {
    const result = await executeProtocol([{ type: "result", status: "success" }]);
    expect(result.model).toBe("gemini-configured");
    expect(result.errorMessage).toBeNull();
  });

  it("retains the model from the legacy system init envelope", async () => {
    const result = await executeProtocol([
      { type: "system", subtype: "init", session_id: "fixture-session", model: "gemini-legacy-observed" },
      { type: "result", status: "success" },
    ]);
    expect(result.model).toBe("gemini-legacy-observed");
  });

  it("fails closed for the native structured error result", async () => {
    const result = await executeProtocol([{ type: "result", status: "error", error: { type: "fixture", message: "Fixture native failure" } }]);
    expect(result.errorMessage).toContain("Fixture native failure");
  });

  it("fails closed for an explicit failed result even when the child exits zero", async () => {
    const result = await executeProtocol([{ type: "result", status: "failed", error: "Fixture request denied" }]);
    expect(result.exitCode).toBe(0);
    expect(result.errorMessage).toContain("Fixture request denied");
  });

  it("fails closed for an explicit failed result without error detail", async () => {
    const result = await executeProtocol([{ type: "result", status: "failed" }]);
    expect(result.errorMessage).toBeTruthy();
  });

  it.each([
    { type: "error", severity: "error", message: "Fixture standalone failure" },
    { type: "system", subtype: "error", error: "Fixture standalone failure" },
  ])("fails closed for a standalone structured error: $type", async (event) => {
    const result = await executeProtocol([event]);
    expect(result.errorMessage).toContain("Fixture standalone failure");
  });

  it("does not fail a warning-only stream", async () => {
    const result = await executeProtocol([{ type: "error", severity: "warning", message: "Fixture warning" }]);
    expect(result.errorMessage).toBeNull();
  });

  it("retains reported model and usage when the child times out", async () => {
    const result = await executeProtocol([
      { type: "init", session_id: "fixture-session", model: "gemini-observed" },
      { type: "result", status: "success", stats: { input_tokens: 100, output_tokens: 40, cached: 20 }, total_cost_usd: 0.012 },
    ], "gemini-configured", true);
    expect(result.timedOut).toBe(true);
    expect(result.errorMessage).toContain("Timed out");
    expect(result).toMatchObject({ model: "gemini-observed", provider: "google", usage: { inputTokens: 100, outputTokens: 40, cachedInputTokens: 20 }, costUsd: 0.012 });
  });
});

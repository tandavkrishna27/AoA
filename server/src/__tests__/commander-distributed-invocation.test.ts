import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCommanderDistributedInvocation, COMMANDER_INPUT_PATH, COMMANDER_RUNNER_PATH, COMMANDER_CAPTURE_SCRIPT } from "../services/commander-distributed-invocation.js";
const base = { companyId: "c1000000-0000-4000-8000-000000000001", turnId: "c2000000-0000-4000-8000-000000000001", cliTool: "claude_cli", content: "literal $(secret) `text`; prompt", systemContext: "history and instructions", model: "claude-sonnet-4-6", apiBaseUrl: "https://aoa.example/api", timeoutMs: 240000 };
function text(files: {path: string; bytes: Uint8Array}[], path: string) { return new TextDecoder().decode(files.find((file) => file.path === path)!.bytes); }
describe("Commander distributed invocation", () => {
  it("stages Claude prompt, instructions and HTTP tool configuration without credentials or prompt argv", () => {
    const built = buildCommanderDistributedInvocation(base)!;
    expect(built.workload.command).toBe("node"); expect(built.workload.args.join(" ")).not.toContain(base.content);
    const input = JSON.parse(text(built.stagedFiles, COMMANDER_INPUT_PATH));
    expect(input.stdinContent).toBe(base.content); expect(input.args).toContain("--include-partial-messages");
    expect(input.args).toContain("--system-prompt-file");
    const mcp = JSON.parse(text(built.stagedFiles, "/home/user/.aoa-commander-mcp.json"));
    expect(mcp.mcpServers.aoa).toMatchObject({ type: "http", url: `${base.apiBaseUrl}/companies/${base.companyId}/mcp`, headers: { Authorization: "Bearer ${AOA_API_KEY}" } });
    expect(text(built.stagedFiles, COMMANDER_RUNNER_PATH)).toContain('"AOA_API_KEY"');
    expect(built.provider).toBe("anthropic");
  });
  it("configures Codex HTTP MCP through its environment token name and sends history over stdin", () => {
    const built = buildCommanderDistributedInvocation({ ...base, cliTool: "codex", model: "gpt-5.4" })!;
    const input = JSON.parse(text(built.stagedFiles, COMMANDER_INPUT_PATH));
    expect(input.args).toContain("exec"); expect(input.args).toContain("--json");
    expect(input.args).toContain('mcp_servers.aoa.bearer_token_env_var="AOA_API_KEY"');
    expect(input.stdinContent).toContain(base.systemContext); expect(input.stdinContent).toContain(base.content);
    expect(built.provider).toBe("openai");
  });
  it.each(["claude_cli", "codex"])("preserves disabled vendor permission bypass for %s", (cliTool) => {
    const built = buildCommanderDistributedInvocation({ ...base, cliTool, vendorCliBypassEnabled: false })!;
    const input = JSON.parse(text(built.stagedFiles, COMMANDER_INPUT_PATH));
    expect(input.args).not.toContain("--dangerously-skip-permissions");
    expect(input.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });
  it("redacts both provider credentials and the Commander bearer from the real captured object", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aoa-commander-capture-"));
    try {
      const script = join(dir, "runner.cjs"); const payload = join(dir, "input.json"); const result = join(dir, "output", "result.json");
      await writeFile(script, COMMANDER_CAPTURE_SCRIPT);
      await writeFile(payload, JSON.stringify({ operationId: base.turnId, args: ["-e", "process.stdout.write(process.env.AOA_API_KEY + ':' + process.env.OPENAI_API_KEY);"], stdinContent: "", timeoutMs: 5000 }));
      const stdout = execFileSync(process.execPath, [script, process.execPath, payload, result], { env: { ...process.env,
        AOA_API_KEY: "test-commander-bearer", OPENAI_API_KEY: "test-provider-key" }, encoding: "utf8" });
      expect(stdout).toBe("[REDACTED]:[REDACTED]");
      expect(JSON.parse(await readFile(result, "utf8"))).toMatchObject({ operationId: base.turnId, stdout: "[REDACTED]:[REDACTED]", exitCode: 0 });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it.each([{ cliTool: "opencode" }, { apiBaseUrl: "https://user:password@aoa.example/api" }, { apiBaseUrl: "file:///tmp" }, { timeoutMs: 0 }, { timeoutMs: 240001 }, { turnId: "fake" }, { model: "bad\nmodel" }, { content: "x".repeat(1048577) }])("declines unsupported or unsafe input before ownership transfer", (change) => {
    expect(buildCommanderDistributedInvocation({ ...base, ...change })).toBeNull();
  });
});

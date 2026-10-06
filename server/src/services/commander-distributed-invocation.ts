import { batchWorkloadV1Schema, type BatchWorkloadV1 } from "@armyofagents/worker-protocol";
import { ONE_SHOT_RESULT_PATH } from "./one-shot-distributed-invocation.js";
import { MAX_STAGED_FILE_BYTES } from "./task-run-batch-workload.js";
import type { SandboxStagedFile } from "./task-run-sandbox-invocation.js";
export const COMMANDER_RUNNER_PATH = "/home/user/aoa-commander-runner.cjs";
export const COMMANDER_INPUT_PATH = "/home/user/aoa-commander-input.json";
const INSTRUCTIONS_PATH = "/home/user/.aoa-commander-instructions.md";
const MCP_PATH = "/home/user/.aoa-commander-mcp.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/;
// Capture artifacts must redact the tool bearer as well as the provider key.
export const COMMANDER_CAPTURE_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const [command, inputPath, outputPath] = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const startedAt = Date.now();
const needles = [...new Set(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "AOA_API_KEY"]
  .flatMap((name) => { const value = process.env[name]; return value ? [value, ...value.split(/\r?\n|\r/)] : []; })
  .filter(Boolean))].sort((a, b) => b.length - a.length);
const scrub = (value) => { let text = value; for (const secret of needles) text = text.split(secret).join("[REDACTED]"); return text; };
let stdout = ""; let stderr = ""; let stdoutLine = ""; let captureError = null; let timedOut = false; let size = 0;
const child = spawn(command, input.args, { shell: false, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
const timeout = setTimeout(() => { timedOut = true; captureError = "ETIMEDOUT"; child.kill("SIGKILL"); }, input.timeoutMs);
const capture = (chunk, stream) => {
  size += Buffer.byteLength(chunk);
  if (size > 1048576) { captureError = "ENOBUFS"; child.kill("SIGKILL"); return; }
  if (stream === "stderr") { stderr += chunk; return; }
  stdout += chunk; stdoutLine += chunk;
  let newline;
  while ((newline = stdoutLine.indexOf("\n")) >= 0) {
    process.stdout.write(scrub(stdoutLine.slice(0, newline + 1)));
    stdoutLine = stdoutLine.slice(newline + 1);
  }
};
child.stdout.on("data", (chunk) => capture(chunk, "stdout"));
child.stderr.on("data", (chunk) => capture(chunk, "stderr"));
child.stdin.on("error", () => {});
child.on("error", (error) => { captureError = error.code || "capture_failed"; });
child.on("close", (code) => {
  clearTimeout(timeout);
  if (stdoutLine) process.stdout.write(scrub(stdoutLine));
  const payload = { version: 1, operationId: input.operationId, stdout: scrub(stdout), stderr: scrub(stderr),
    exitCode: typeof code === "number" ? code : 1, timedOut, durationMs: Date.now() - startedAt, captureError };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
  process.stderr.write(payload.stderr); process.exitCode = payload.exitCode;
});
child.stdin.end(input.stdinContent);
`.trim();
export interface CommanderDistributedInvocationInput {
  companyId: string; turnId: string; cliTool: string; content: string;
  vendorCliBypassEnabled?: boolean;
  systemContext?: string | null; model?: string | null; apiBaseUrl: string; timeoutMs: number;
}
export function buildCommanderDistributedInvocation(input: CommanderDistributedInvocationInput): {
  workload: BatchWorkloadV1; stagedFiles: SandboxStagedFile[]; provider: "anthropic" | "openai";
} | null {
  if (!UUID.test(input.companyId) || !UUID.test(input.turnId) ||
    !["claude_cli", "codex"].includes(input.cliTool) ||
    !Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0 || input.timeoutMs > 240000 ||
    (input.model && !MODEL.test(input.model))) return null;
  let base: URL;
  try { base = new URL(input.apiBaseUrl); } catch { return null; }
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) return null;
  const url = `${input.apiBaseUrl.replace(/\/$/, "")}/companies/${input.companyId}/mcp`;
  const codex = input.cliTool === "codex";
  const args = codex ? ["exec", "--json", ...(input.vendorCliBypassEnabled === false ? [] : ["--dangerously-bypass-approvals-and-sandbox"]),
    "-c", `mcp_servers.aoa.url=${JSON.stringify(url)}`, "-c", 'mcp_servers.aoa.bearer_token_env_var="AOA_API_KEY"',
    ...(input.model ? ["--model", input.model] : []), "-"] : ["--print", "--verbose", "--output-format", "stream-json",
    "--include-partial-messages", ...(input.vendorCliBypassEnabled === false ? [] : ["--dangerously-skip-permissions"]), "--mcp-config", MCP_PATH, "--strict-mcp-config",
    ...(input.model ? ["--model", input.model] : []), ...(input.systemContext ? ["--system-prompt-file", INSTRUCTIONS_PATH] : [])];
  const encoder = new TextEncoder();
  const file = (path: string, content: string, contentType: string): SandboxStagedFile => ({ path, bytes: encoder.encode(content), contentType });
  const stagedFiles = [file(COMMANDER_RUNNER_PATH, COMMANDER_CAPTURE_SCRIPT, "text/javascript"),
    file(COMMANDER_INPUT_PATH, JSON.stringify({ operationId: input.turnId, args,
      stdinContent: codex && input.systemContext ? `${input.systemContext}\n\n${input.content}` : input.content,
      timeoutMs: input.timeoutMs }), "application/json")];
  if (!codex) {
    stagedFiles.push(file(MCP_PATH, JSON.stringify({ mcpServers: { aoa: { type: "http", url,
      headers: { Authorization: "Bearer ${AOA_API_KEY}" } } } }), "application/json"));
    if (input.systemContext) stagedFiles.push(file(INSTRUCTIONS_PATH, input.systemContext, "text/markdown"));
  }
  if (stagedFiles.some((entry) => entry.bytes.byteLength > MAX_STAGED_FILE_BYTES)) return null;
  const workload = batchWorkloadV1Schema.safeParse({ command: "node", args: [COMMANDER_RUNNER_PATH,
    codex ? "codex" : "claude", COMMANDER_INPUT_PATH, ONE_SHOT_RESULT_PATH], stdinArtifactId: null,
    maxRuntimeSeconds: Math.max(60, Math.ceil(input.timeoutMs / 1000)) });
  return workload.success ? { workload: workload.data, stagedFiles, provider: codex ? "openai" : "anthropic" } : null;
}

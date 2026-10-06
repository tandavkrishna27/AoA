import { batchWorkloadV1Schema, type BatchWorkloadV1 } from "@armyofagents/worker-protocol";
import { MAX_STAGED_FILE_BYTES } from "./task-run-batch-workload.js";
import type { SandboxStagedFile } from "./task-run-sandbox-invocation.js";

export const ONE_SHOT_RUNNER_PATH = "/home/user/aoa-one-shot-runner.cjs";
export const ONE_SHOT_INPUT_PATH = "/home/user/aoa-one-shot-input.json";
export const ONE_SHOT_RESULT_PATH = "/home/user/aoa-output/aoa-one-shot-result.json";
export const ONE_SHOT_CAPTURE_SCRIPT = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const [command, inputPath, outputPath] = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const startedAt = Date.now();
const result = spawnSync(command, input.args, {
  input: input.stdinContent, encoding: "utf8", timeout: input.timeoutMs,
  maxBuffer: 1048576, shell: false, env: process.env,
});
const scrub = (value) => {
  let text = typeof value === "string" ? value : "";
  for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
    const secret = process.env[name];
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  return text;
};
const payload = {
  version: 1, operationId: input.operationId,
  stdout: scrub(result.stdout), stderr: scrub(result.stderr),
  exitCode: typeof result.status === "number" ? result.status : 1,
  timedOut: result.error?.code === "ETIMEDOUT",
  durationMs: Date.now() - startedAt,
  captureError: result.error ? (result.error.code ?? "capture_failed") : null,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
process.stdout.write(payload.stdout);
process.stderr.write(payload.stderr);
process.exitCode = payload.exitCode;
`.trim();

export function buildOneShotDistributedInvocation(input: {
  operationId: string; cliTool: string; command: string; args: string[];
  stdinContent?: string; stagedFile?: { remotePath: string; content: string }; timeoutMs: number;
}): { workload: BatchWorkloadV1; stagedFiles: SandboxStagedFile[] } | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.operationId) ||
    !["claude", "codex"].includes(input.cliTool) || input.command !== input.cliTool ||
    !Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0 || input.timeoutMs > 240_000 ||
    !Array.isArray(input.args) || input.args.some((arg) => typeof arg !== "string")) return null;
  const encoder = new TextEncoder();
  const files: SandboxStagedFile[] = [
    { path: ONE_SHOT_RUNNER_PATH, bytes: encoder.encode(ONE_SHOT_CAPTURE_SCRIPT), contentType: "text/javascript" },
    { path: ONE_SHOT_INPUT_PATH, bytes: encoder.encode(JSON.stringify({
      operationId: input.operationId, args: input.args,
      stdinContent: input.stagedFile ? "" : input.stdinContent ?? "", timeoutMs: input.timeoutMs,
    })), contentType: "application/json" },
  ];
  if (input.stagedFile) {
    // Match the existing sandbox file-import path; require an absolute scoped path.
    if (!input.stagedFile.remotePath.startsWith("/home/user/") ||
      input.stagedFile.remotePath.startsWith("/home/user/aoa-output/") ||
      input.stagedFile.remotePath.includes("\\") || input.stagedFile.remotePath.includes("\0") ||
      input.stagedFile.remotePath.split("/").slice(1).some((part) => part === "." || part === "") ||
      input.stagedFile.remotePath.split("/").some((part) => part === "..") ||
      [ONE_SHOT_INPUT_PATH, ONE_SHOT_RUNNER_PATH, ONE_SHOT_RESULT_PATH].includes(input.stagedFile.remotePath)) return null;
    files.push({ path: input.stagedFile.remotePath, bytes: encoder.encode(input.stagedFile.content), contentType: "text/plain" });
  }
  if (files.some((file) => file.bytes.byteLength > MAX_STAGED_FILE_BYTES)) return null;
  const workload = batchWorkloadV1Schema.safeParse({
    command: "node", args: [ONE_SHOT_RUNNER_PATH, input.cliTool, ONE_SHOT_INPUT_PATH, ONE_SHOT_RESULT_PATH],
    stdinArtifactId: null, maxRuntimeSeconds: Math.max(60, Math.ceil(input.timeoutMs / 1000)),
  });
  return workload.success ? { workload: workload.data, stagedFiles: files } : null;
}

/** Only the exact server-owned capture invocation establishes agentless provider identity. */
export function oneShotAdapterForWorkload(input: unknown): "claude_local" | "codex_local" | null {
  const parsed = batchWorkloadV1Schema.safeParse(input);
  if (!parsed.success) return null;
  const { command, args } = parsed.data;
  if (command !== "node" || args.length !== 4 || args[0] !== ONE_SHOT_RUNNER_PATH ||
    args[2] !== ONE_SHOT_INPUT_PATH || args[3] !== ONE_SHOT_RESULT_PATH) return null;
  return args[1] === "claude" ? "claude_local" : args[1] === "codex" ? "codex_local" : null;
}

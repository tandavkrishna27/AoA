import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { batchWorkloadV1Schema } from "@armyofagents/worker-protocol";
import {
  buildOneShotDistributedInvocation, ONE_SHOT_CAPTURE_SCRIPT,
  oneShotAdapterForWorkload, ONE_SHOT_RESULT_PATH,
} from "../services/one-shot-distributed-invocation.js";

const operationId = "01234567-1234-4234-8234-012345678901";
const input = { operationId, cliTool: "codex", command: "codex", args: ["exec", "literal; $(no shell)"],
  stdinContent: "prompt\nUnicode: λ", timeoutMs: 30_000 };
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe("one-shot distributed invocation", () => {
  it("stages prompt/arguments separately and uses the existing batch wire and output export root", () => {
    const built = buildOneShotDistributedInvocation(input)!;
    expect(batchWorkloadV1Schema.safeParse(built.workload).success).toBe(true);
    expect(built.workload.command).toBe("node");
    expect(built.workload.maxRuntimeSeconds).toBe(60);
    expect(JSON.stringify(built.workload)).not.toContain(input.stdinContent);
    expect(JSON.stringify(built.workload)).not.toContain(input.args[1]);
    expect(built.workload.args.at(-1)).toBe(ONE_SHOT_RESULT_PATH);
    expect(oneShotAdapterForWorkload(built.workload)).toBe("codex_local");
    expect(buildOneShotDistributedInvocation(input)).toEqual(built);
  });
  it.each([
    { command: "custom-cli" }, { cliTool: "other" }, { timeoutMs: 241_000 },
    { timeoutMs: 0 }, { operationId: "not-a-uuid" }, { stdinContent: "x".repeat(1_048_577) },
  ])("refuses unsupported or unbounded invocation %j", (change) => {
    expect(buildOneShotDistributedInvocation({ ...input, ...change })).toBeNull();
  });
  it("refuses an altered wrapper path or provider binary when deriving agentless authority", () => {
    const built = buildOneShotDistributedInvocation(input)!;
    expect(oneShotAdapterForWorkload({ ...built.workload, command: "sh" })).toBeNull();
    expect(oneShotAdapterForWorkload({ ...built.workload, args: ["other-wrapper", ...built.workload.args.slice(1)] })).toBeNull();
    expect(oneShotAdapterForWorkload({ ...built.workload, args: [built.workload.args[0], "python", ...built.workload.args.slice(2)] })).toBeNull();
  });
  it("stages a scoped import while refusing output injection and path aliases", () => {
    expect(buildOneShotDistributedInvocation({ ...input, stagedFile: { remotePath: "/home/user/import.txt", content: "source" } })?.stagedFiles).toHaveLength(3);
    for (const remotePath of ["/home/user/aoa-output/forged.json", "/home/user/./aoa-one-shot-input.json", "/home/user//aoa-one-shot-runner.cjs", "/home/user/../other", "/home/user/import\\bad"]) {
      expect(buildOneShotDistributedInvocation({ ...input, stagedFile: { remotePath, content: "source" } })).toBeNull();
    }
  });
  it.each([
    { code: "process.stderr.write('failed'); process.exit(7)", timeoutMs: 5_000, exitCode: 7, timedOut: false },
    { code: "setTimeout(() => {}, 5000)", timeoutMs: 50, exitCode: 1, timedOut: true },
  ])("exports a terminal child outcome on nonzero exit and timeout: $timedOut", async (child) => {
    const dir = await mkdtemp(join(tmpdir(), "aoa-one-shot-terminal-")); dirs.push(dir);
    const script = join(dir, "capture.cjs"); const payload = join(dir, "input.json"); const output = join(dir, "result.json");
    await writeFile(script, ONE_SHOT_CAPTURE_SCRIPT);
    await writeFile(payload, JSON.stringify({ operationId, args: ["-e", child.code], stdinContent: "", timeoutMs: child.timeoutMs }));
    expect(() => execFileSync(process.execPath, [script, process.execPath, payload, output], { stdio: "pipe" })).toThrow();
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({ operationId, exitCode: child.exitCode, timedOut: child.timedOut });
  });
  it("captures a real child result and scrubs provider values without shell interpolation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aoa-one-shot-capture-")); dirs.push(dir);
    const script = join(dir, "capture.cjs"); const payload = join(dir, "input.json"); const output = join(dir, "output", "result.json");
    await writeFile(script, ONE_SHOT_CAPTURE_SCRIPT);
    await writeFile(payload, JSON.stringify({ operationId, args: ["-e", "process.stdout.write(process.env.OPENAI_API_KEY + ':' + process.argv[1]); process.stderr.write('err');", "literal; $(no shell)"], stdinContent: "", timeoutMs: 5_000 }));
    execFileSync(process.execPath, [script, process.execPath, payload, output], {
      env: { ...process.env, OPENAI_API_KEY: "test-provider-secret-value" }, stdio: "pipe",
    });
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({ version: 1, operationId,
      stdout: "[REDACTED]:literal; $(no shell)", stderr: "err", exitCode: 0, timedOut: false });
  });
});

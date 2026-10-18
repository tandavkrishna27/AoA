import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { finished } from "node:stream/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { propagatedExitCode, runCapturedProcess } from "../../run-vitest-captured.mjs";

const NODE = process.execPath;
const RUNNER = fileURLToPath(new URL("../../run-vitest-captured.mjs", import.meta.url));
const temporaryDirectory = () => mkdtempSync(path.join(os.tmpdir(), "aoa-vitest-capture-"));

test("captures complete native stdout and stderr and preserves a nonzero child exit", async () => {
  const directory = temporaryDirectory();
  const child = path.join(directory, "emit-streams.mjs");
  const capture = path.join(directory, "capture");
  writeFileSync(child, [
    'process.stdout.write("stdout: first\\nstdout: second\\n");',
    'process.stderr.write("stderr: first\\nstderr: second\\n");',
    'if (process.argv[2] !== "forwarded-argument") process.exit(17);',
    "process.exit(23);",
  ].join("\n"));

  try {
    const stdoutErrorListeners = process.stdout.listenerCount("error");
    const stderrErrorListeners = process.stderr.listenerCount("error");
    const stdoutDrainListeners = process.stdout.listenerCount("drain");
    const stderrDrainListeners = process.stderr.listenerCount("drain");
    const result = await runCapturedProcess({
      command: NODE,
      args: [child, "forwarded-argument"],
      captureDir: capture,
      cwd: directory,
    });

    assert.equal(result.exitCode, 23);
    assert.equal(result.signal, null);
    assert.equal(readFileSync(path.join(capture, "stdout.txt"), "utf8"), "stdout: first\nstdout: second\n");
    assert.equal(readFileSync(path.join(capture, "stderr.txt"), "utf8"), "stderr: first\nstderr: second\n");

    const metadata = JSON.parse(readFileSync(path.join(capture, "result.json"), "utf8"));
    assert.equal(metadata.exitCode, 23);
    assert.equal(metadata.signal, null);
    assert.deepEqual(metadata.command.args, [child, "forwarded-argument"]);
    assert.equal(typeof metadata.identity.gitSha === "string" || metadata.identity.gitSha === null, true);
    assert.equal(typeof metadata.startedAt, "string");
    assert.equal(typeof metadata.durationMs, "number");
    assert.ok(metadata.durationMs >= 0);
    assert.equal(metadata.unhandledErrors, "unknown");
    assert.deepEqual(metadata.summary, {
      testFiles: "unknown",
      tests: "unknown",
      passed: "unknown",
      failed: "unknown",
      skipped: "unknown",
    });
    assert.equal(process.stdout.listenerCount("error"), stdoutErrorListeners);
    assert.equal(process.stderr.listenerCount("error"), stderrErrorListeners);
    assert.equal(process.stdout.listenerCount("drain"), stdoutDrainListeners);
    assert.equal(process.stderr.listenerCount("drain"), stderrDrainListeners);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("binds gitSha to the revision present before the child runs", async () => {
  const directory = temporaryDirectory();
  const child = path.join(directory, "advance-head.mjs");
  const capture = path.join(directory, "capture");
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
  };

  try {
    git(["init", "--quiet"]);
    git(["config", "user.name", "Capture test"]);
    git(["config", "user.email", "capture-test@example.invalid"]);
    git(["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "before capture"]);
    const startSha = git(["rev-parse", "HEAD"]);
    writeFileSync(child, [
      'import { execFileSync } from "node:child_process";',
      'execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "during capture"], { cwd: process.cwd(), stdio: "ignore" });',
    ].join("\n"));

    const result = await runCapturedProcess({ command: NODE, args: [child], captureDir: capture, cwd: directory });
    const endSha = git(["rev-parse", "HEAD"]);
    const metadata = JSON.parse(readFileSync(path.join(capture, "result.json"), "utf8"));

    assert.equal(result.exitCode, 0);
    assert.notEqual(endSha, startSha, "the child should have advanced HEAD");
    assert.equal(metadata.identity.gitSha, startSha);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("preserves multiple MiB per stream through simultaneous file and terminal backpressure", async () => {
  const directory = temporaryDirectory();
  const child = path.join(directory, "emit-large-streams.mjs");
  const capture = path.join(directory, "capture");
  const payload = Buffer.from(`${"0123456789abcdef".repeat(2048)}-AoA-λ\n`);
  const repeats = 128;
  const encoded = payload.toString("base64");
  writeFileSync(child, [
    'import { once } from "node:events";',
    `const chunk = Buffer.from(${JSON.stringify(encoded)}, "base64");`,
    `const repeats = ${repeats};`,
    'async function emit(stream) { for (let i = 0; i < repeats; i += 1) { if (!stream.write(chunk)) await once(stream, "drain"); } }',
    'await Promise.all([emit(process.stdout), emit(process.stderr)]);',
  ].join("\n"));

  const slowSink = () => {
    const hash = createHash("sha256");
    let bytes = 0;
    let backpressureDrains = 0;
    let maxBufferedBytes = 0;
    const stream = new Writable({
      highWaterMark: 1024,
      write(chunk, _encoding, callback) {
        bytes += chunk.length;
        maxBufferedBytes = Math.max(maxBufferedBytes, stream.writableLength);
        hash.update(chunk);
        setTimeout(callback, 1);
      },
    });
    stream.on("drain", () => { backpressureDrains += 1; });
    return {
      stream,
      bytes: () => bytes,
      digest: () => hash.digest("hex"),
      backpressureDrains: () => backpressureDrains,
      maxBufferedBytes: () => maxBufferedBytes,
    };
  };
  const stdoutSink = slowSink();
  const stderrSink = slowSink();
  const expectedHash = createHash("sha256");
  for (let index = 0; index < repeats; index += 1) expectedHash.update(payload);
  const expectedDigest = expectedHash.digest("hex");
  const expectedBytes = payload.length * repeats;

  try {
    const result = await runCapturedProcess({
      command: NODE,
      args: [child],
      captureDir: capture,
      cwd: directory,
      stdoutTarget: stdoutSink.stream,
      stderrTarget: stderrSink.stream,
    });
    stdoutSink.stream.end();
    stderrSink.stream.end();
    await Promise.all([finished(stdoutSink.stream), finished(stderrSink.stream)]);

    assert.equal(result.exitCode, 0);
    assert.equal(statSync(path.join(capture, "stdout.txt")).size, expectedBytes);
    assert.equal(statSync(path.join(capture, "stderr.txt")).size, expectedBytes);
    assert.equal(createHash("sha256").update(readFileSync(path.join(capture, "stdout.txt"))).digest("hex"), expectedDigest);
    assert.equal(createHash("sha256").update(readFileSync(path.join(capture, "stderr.txt"))).digest("hex"), expectedDigest);
    assert.equal(stdoutSink.bytes(), expectedBytes);
    assert.equal(stderrSink.bytes(), expectedBytes);
    assert.equal(stdoutSink.digest(), expectedDigest);
    assert.equal(stderrSink.digest(), expectedDigest);
    assert.ok(stdoutSink.backpressureDrains() > 0);
    assert.ok(stderrSink.backpressureDrains() > 0);
    assert.ok(stdoutSink.maxBufferedBytes() <= payload.length * 2);
    assert.ok(stderrSink.maxBufferedBytes() <= payload.length * 2);
  } finally {
    stdoutSink.stream.destroy();
    stderrSink.stream.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("records signal termination and maps it to a failing parent exit status", async (t) => {
  assert.equal(propagatedExitCode({ exitCode: 23, signal: null }), 23);
  assert.equal(propagatedExitCode({ exitCode: null, signal: "SIGTERM" }), 143);
  if (process.platform === "win32") {
    t.skip("Windows does not expose POSIX child signal termination semantics");
    return;
  }

  const directory = temporaryDirectory();
  const child = path.join(directory, "terminate.mjs");
  const capture = path.join(directory, "capture");
  writeFileSync(child, 'process.kill(process.pid, "SIGTERM");');

  try {
    const result = await runCapturedProcess({ command: NODE, args: [child], captureDir: capture, cwd: directory });
    assert.equal(result.exitCode, null);
    assert.equal(result.signal, "SIGTERM");
    const metadata = JSON.parse(readFileSync(path.join(capture, "result.json"), "utf8"));
    assert.equal(metadata.exitCode, null);
    assert.equal(metadata.signal, "SIGTERM");
    assert.throws(() => process.kill(metadata.identity.pid, 0), { code: "ESRCH" });

    const rethrow = path.join(directory, "rethrow-signal.mjs");
    const runnerUrl = new URL("../../run-vitest-captured.mjs", import.meta.url).href;
    writeFileSync(rethrow, `import { propagateOutcome } from ${JSON.stringify(runnerUrl)}; propagateOutcome({ exitCode: null, signal: "SIGTERM" });`);
    const parent = spawnSync(NODE, [rethrow], { encoding: "utf8" });
    assert.equal(parent.status, null);
    assert.equal(parent.signal, "SIGTERM");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("refuses an unusable capture target before it can launch the child", async () => {
  const directory = temporaryDirectory();
  const target = path.join(directory, "capture-is-a-file");
  const child = path.join(directory, "must-not-run.mjs");
  const marker = path.join(directory, "child-ran");
  writeFileSync(target, "occupied");
  writeFileSync(child, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran");`);

  try {
    await assert.rejects(runCapturedProcess({
      command: NODE,
      args: [child],
      captureDir: target,
      cwd: directory,
    }));
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("records a missing child executable and returns a nonzero result", async () => {
  const directory = temporaryDirectory();

  try {
    const result = await runCapturedProcess({
      command: path.join(directory, "missing-child.exe"),
      args: [],
      captureDir: path.join(directory, "capture"),
      cwd: directory,
    });
    assert.equal(result.exitCode, null);
    assert.match(result.spawnError, /ENOENT/i);
    assert.equal(propagatedExitCode(result), 1);
    const metadata = JSON.parse(readFileSync(path.join(directory, "capture", "result.json"), "utf8"));
    assert.equal(metadata.spawnError, result.spawnError);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a Linux /dev/full output failure kills and observes the child and records nonzero capture status", async (t) => {
  if (process.platform !== "linux") {
    t.skip("/dev/full is a Linux-specific failing output sink");
    return;
  }

  const directory = temporaryDirectory();
  const child = path.join(directory, "stay-alive.mjs");
  const capture = path.join(directory, "capture");
  mkdirSync(capture);
  symlinkSync("/dev/full", path.join(capture, "stdout.txt"));
  writeFileSync(child, [
    'const chunk = Buffer.alloc(64 * 1024, "x");',
    'setInterval(() => process.stdout.write(chunk), 1);',
  ].join("\n"));
  const quietTarget = new Writable({ write(_chunk, _encoding, callback) { callback(); } });

  try {
    const result = await runCapturedProcess({
      command: NODE,
      args: [child],
      captureDir: capture,
      cwd: directory,
      stdoutTarget: quietTarget,
      stderrTarget: quietTarget,
    });
    assert.match(result.captureError, /ENOSPC|No space left/i);
    assert.equal(result.exitCode, null);
    assert.equal(result.signal, "SIGTERM");
    assert.throws(() => process.kill(result.identity.pid, 0), { code: "ESRCH" });
    const metadata = JSON.parse(readFileSync(path.join(capture, "result.json"), "utf8"));
    assert.match(metadata.captureError, /ENOSPC|No space left/i);
    assert.equal(propagatedExitCode(metadata), 1);
  } finally {
    quietTarget.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the CLI forwards a failing Vitest invocation and exits with Vitest's code", () => {
  const directory = temporaryDirectory();
  const capture = path.join(directory, "capture");

  try {
    const result = spawnSync(NODE, [RUNNER, "--capture-dir", capture, "--", "--unknown-option"], {
      cwd: path.resolve(path.dirname(RUNNER), ".."),
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const metadata = JSON.parse(readFileSync(path.join(capture, "result.json"), "utf8"));
    assert.equal(metadata.exitCode, 1);
    assert.equal(metadata.signal, null);
    assert.equal(propagatedExitCode(metadata), 1);
    assert.match(readFileSync(path.join(capture, "stderr.txt"), "utf8"), /Unknown option/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

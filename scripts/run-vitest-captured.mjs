import { mkdirSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { finished } from "node:stream/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function readGitSha(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch { /* A capture can run outside a Git checkout; null preserves that unknown identity. */ }
  return null;
}

/**
 * Run a child while teeing its native output to the terminal and raw capture files.
 * Buffers are written as-is, so neither PowerShell nor a text decoder can rewrite output.
 */
export async function runCapturedProcess({
  command,
  args = [],
  captureDir,
  cwd = ROOT,
  env = process.env,
  stdoutTarget = process.stdout,
  stderrTarget = process.stderr,
}) {
  if (typeof command !== "string" || command.length === 0) throw new TypeError("command is required");
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw new TypeError("args must be strings");
  if (typeof captureDir !== "string" || captureDir.length === 0) throw new TypeError("captureDir is required");

  const absoluteCaptureDir = path.resolve(cwd, captureDir);
  mkdirSync(absoluteCaptureDir, { recursive: true });
  const stdoutPath = path.join(absoluteCaptureDir, "stdout.txt");
  const stderrPath = path.join(absoluteCaptureDir, "stderr.txt");
  let stdoutHandle;
  let stderrHandle;
  try {
    stdoutHandle = await open(stdoutPath, "w");
    stderrHandle = await open(stderrPath, "w");
  } catch (error) {
    await Promise.allSettled([stdoutHandle?.close(), stderrHandle?.close()]);
    throw new Error(`cannot open Vitest output capture in ${absoluteCaptureDir}: ${error.message}`, { cause: error });
  }
  const stdoutFile = stdoutHandle.createWriteStream();
  const stderrFile = stderrHandle.createWriteStream();
  const stdoutFinished = finished(stdoutFile).catch((error) => error);
  const stderrFinished = finished(stderrFile).catch((error) => error);
  const startedAt = new Date().toISOString();
  const startTime = performance.now();
  // Bind this capture to the source revision that existed before the child could mutate HEAD.
  const gitSha = readGitSha(cwd);

  let captureError = null;
  const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["inherit", "pipe", "pipe"] });
  const cleanupOutputListeners = [];
  const pendingDrains = new Set();
  const attachOutput = (source, capture, terminal, name) => {
    source.on("data", (chunk) => {
      const state = { drainsPending: 0 };
      const write = (destination) => {
        if (destination.write(chunk)) return;
        source.pause();
        state.drainsPending += 1;
        const pending = { destination, state, onDrain: undefined };
        pending.onDrain = () => {
          pendingDrains.delete(pending);
          destination.removeListener("drain", pending.onDrain);
          state.drainsPending -= 1;
          if (state.drainsPending === 0) source.resume();
        };
        pendingDrains.add(pending);
        destination.once("drain", pending.onDrain);
      };
      if (captureError === null) write(capture);
      write(terminal);
    });
    const cancelDrainsFor = (destination) => {
      for (const pending of pendingDrains) {
        if (pending.destination !== destination) continue;
        destination.removeListener("drain", pending.onDrain);
        pendingDrains.delete(pending);
        pending.state.drainsPending -= 1;
      }
    };
    const onCaptureError = (error) => {
      captureError ??= `${name} capture failed: ${error.message}`;
      child.kill();
      cancelDrainsFor(capture);
      source.resume();
    };
    const onTerminalError = (error) => {
      captureError ??= `${name} terminal forwarding failed: ${error.message}`;
      child.kill();
      cancelDrainsFor(terminal);
      source.resume();
    };
    capture.on("error", onCaptureError);
    terminal.on("error", onTerminalError);
    cleanupOutputListeners.push(() => {
      capture.removeListener("error", onCaptureError);
      terminal.removeListener("error", onTerminalError);
    });
  };
  attachOutput(child.stdout, stdoutFile, stdoutTarget, "stdout");
  attachOutput(child.stderr, stderrFile, stderrTarget, "stderr");

  let spawnError = null;
  const childOutcome = new Promise((resolve) => {
    child.once("error", (error) => { spawnError = `${error.code ?? "spawn_error"}: ${error.message}`; });
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  const sourceOutputFinished = Promise.all([
    finished(child.stdout).catch(() => undefined),
    finished(child.stderr).catch(() => undefined),
  ]);
  let outcome;
  try {
    [outcome] = await Promise.all([childOutcome, sourceOutputFinished]);
  } finally {
    for (const pending of pendingDrains) {
      pending.destination.removeListener("drain", pending.onDrain);
      pendingDrains.delete(pending);
    }
    for (const cleanup of cleanupOutputListeners) cleanup();
  }

  stdoutFile.end();
  stderrFile.end();
  const [stdoutFinishError, stderrFinishError] = await Promise.all([stdoutFinished, stderrFinished]);
  captureError ??= stdoutFinishError === undefined ? null : `stdout capture failed: ${stdoutFinishError.message}`;
  captureError ??= stderrFinishError === undefined ? null : `stderr capture failed: ${stderrFinishError.message}`;

  const result = {
    schemaVersion: 1,
    identity: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      cwd: path.resolve(cwd),
      pid: child.pid ?? null,
      gitSha,
    },
    command: { executable: command, args },
    startedAt,
    durationMs: Math.round((performance.now() - startTime) * 100) / 100,
    exitCode: captureError === null && spawnError === null ? outcome.exitCode : null,
    signal: outcome.signal,
    spawnError,
    captureError,
    stdoutPath,
    stderrPath,
    // The native Vitest summary is kept verbatim in stdout.txt. This wrapper does not infer
    // counters from partial output, so unavailable measurements stay explicitly unknown.
    summary: { testFiles: "unknown", tests: "unknown", passed: "unknown", failed: "unknown", skipped: "unknown" },
    unhandledErrors: "unknown",
  };
  writeFileSync(path.join(absoluteCaptureDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export function propagatedExitCode({ exitCode, signal, spawnError, captureError }) {
  if (spawnError || captureError) return 1;
  if (Number.isInteger(exitCode)) return exitCode;
  const signalNumber = signal == null ? undefined : os.constants.signals[signal];
  return signalNumber === undefined ? 1 : 128 + signalNumber;
}

export function propagateOutcome(result) {
  if (result.signal && process.platform !== "win32" && os.constants.signals[result.signal] !== undefined) {
    // The child has already closed before we re-raise, so no process is left behind.
    process.kill(process.pid, result.signal);
    return;
  }
  process.exitCode = propagatedExitCode(result);
}

function usage() {
  return "Usage: node scripts/run-vitest-captured.mjs --capture-dir <directory> [--] [vitest arguments...]";
}

async function main(argv) {
  const captureIndex = argv.indexOf("--capture-dir");
  if (captureIndex < 0 || typeof argv[captureIndex + 1] !== "string" || argv[captureIndex + 1].startsWith("--")) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  const captureDir = argv[captureIndex + 1];
  const forwarded = argv.filter((_, index) => index !== captureIndex && index !== captureIndex + 1);
  const vitestArgs = forwarded[0] === "--" ? forwarded.slice(1) : forwarded;
  const vitestEntry = require.resolve("vitest/vitest.mjs");
  const result = await runCapturedProcess({
    command: process.execPath,
    args: [vitestEntry, ...vitestArgs],
    captureDir,
  });
  propagateOutcome(result);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`run-vitest-captured: ${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

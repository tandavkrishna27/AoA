import { afterEach, describe, expect, it, vi } from "vitest";
import childProcess, { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { launchWindowsRuntimeJob, isWindowsRuntimeJobRef, normalizeWindowsRuntimeEnv, stopOwnedWindowsRuntimeJob, forgetWindowsRuntimeJob, type WindowsRuntimeJob } from "../utils/windows-runtime-job.js";

const env = () => Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); syncBuiltinESMExports(); });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function gone(pid: number) {
  const deadline = Date.now() + 3_000;
  while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(alive(pid), `owned native process ${pid} must exit`).toBe(false);
}
function line(job: WindowsRuntimeJob): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    let errors = "";
    job.stderr.on("data", (chunk) => { errors += String(chunk); });
    const timeout = setTimeout(() => reject(new Error(`native target did not produce its output: ${errors}`)), 5_000);
    job.stdout.on("data", (chunk) => { text += String(chunk); if (text.includes("\n")) { clearTimeout(timeout); resolve(text.slice(0, text.indexOf("\n"))); } });
  });
}

describe("Windows runtime job reference admission", () => {
  it("matches Node's first lexicographic case-insensitive environment key", () => {
    expect(normalizeWindowsRuntimeEnv({ Path: "second", PATH: "first", z: "last" })).toEqual({ PATH: "first", z: "last" });
  });

  it("never launches a late host after activation expires during asynchronous setup", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-job-delayed-"));
    const originalRm = fs.rm.bind(fs);
    let resume!: (value: string) => void;
    const delayed = new Promise<string>((resolve) => { resume = resolve; });
    let cleaned!: () => void;
    const cleanup = new Promise<void>((resolve) => { cleaned = resolve; });
    const mkdir = vi.spyOn(fs, "mkdtemp").mockReturnValueOnce(delayed);
    const rm = vi.spyOn(fs, "rm").mockImplementationOnce(async (...args) => { await originalRm(...args); cleaned(); });
    const spawn = vi.spyOn(childProcess, "spawn").mockImplementation(() => { throw new Error("late spawn must never be reached"); });
    syncBuiltinESMExports();
    vi.useFakeTimers();
    try {
      const job = launchWindowsRuntimeJob({ ownerId: "owner-a", command: process.execPath, args: [], cwd: process.cwd(), env: env() });
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(job.ready).rejects.toThrow("activation timed out");
      expect(job.state).toBe("unknown");
      resume(directory);
      await cleanup;
      expect(spawn).not.toHaveBeenCalled();
      await expect(job.stop()).resolves.toBe(false);
    } finally { vi.useRealTimers(); mkdir.mockRestore(); rm.mockRestore(); spawn.mockRestore(); await originalRm(directory, { recursive: true, force: true }); }
  });

  it.each(["malformed", "wrong generation", "nonzero accounting"])("keeps %s control unresolved without a native PID fallback", async (mode) => {
    const host = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => { queueMicrotask(() => host.emit("close")); return true; }) });
    host.stdin.once("data", (chunk) => {
      const config = JSON.parse(String(chunk));
      queueMicrotask(() => host.stdout.write(mode === "malformed" ? "not-json\n" : JSON.stringify({ v: 1, ref: config.ref, challenge: mode === "wrong generation" ? "wrong" : config.challenge, type: "empty", activeProcesses: 1, exitCode: 0 }) + "\n"));
    });
    const spawn = vi.spyOn(childProcess, "spawn").mockReturnValue(host as unknown as ChildProcess);
    syncBuiltinESMExports();
    try {
      const job = launchWindowsRuntimeJob({ ownerId: "owner-a", command: process.execPath, args: [], cwd: process.cwd(), env: env() });
      await expect(job.ready).rejects.toThrow(/frame|generation|empty receipt/);
      await expect(job.completion).resolves.toBe("unknown");
      await expect(job.stop()).resolves.toBe(false);
      expect(host.kill).toHaveBeenCalledWith("SIGKILL");
    } finally { spawn.mockRestore(); }
  });

  it("accepts only the explicit canonical v1 generation", async () => {
    const good = "aoa-winjob:v1:12345678-1234-4123-8123-123456789abc";
    expect(isWindowsRuntimeJobRef(good)).toBe(true);
    for (const value of ["42", "", good.toUpperCase(), good.replace("v1", "v2"), good + "junk", good.replace("4123", "1123")]) {
      expect(isWindowsRuntimeJobRef(value)).toBe(false);
      await expect(stopOwnedWindowsRuntimeJob(value, "owner-a")).resolves.toBe(false);
    }
    await expect(stopOwnedWindowsRuntimeJob(good, "owner-a")).resolves.toBe(false);
  });
});

describe.skipIf(process.platform !== "win32")("real private Windows runtime jobs", () => {
  it("roundtrips native args, Unicode cwd/env and target data without exposing control handles", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-job-unicode-λ-"));
    const args = ["", "a b", 'a"b', "end\\", "two\\\\", 'slash\\"quote', "你好"];
    const job = launchWindowsRuntimeJob({ ownerId: "owner-a", command: process.execPath,
      args: ["-e", "console.log(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd(),env:process.env.AOA_JOB_UNICODE,path:process.env.PATH}));setInterval(()=>{},1000)", "--", ...args],
      cwd: directory, env: { ...env(), AOA_JOB_UNICODE: "λ你好", PATH: "first-path", Path: "second-path" }, });
    const output = line(job);
    try {
      await job.ready;
      const actual = JSON.parse(await output);
      expect(actual).toEqual({ args, cwd: directory, env: "λ你好", path: "first-path" });
      expect(job.state).toBe("active");
      await expect(stopOwnedWindowsRuntimeJob(job.providerRef, "other-owner")).resolves.toBe(false);
      expect(job.state).toBe("active");
      expect(isWindowsRuntimeJobRef(job.providerRef)).toBe(true);
      await expect(job.stop()).resolves.toBe(true);
      expect(job.state).toBe("empty");
      await gone(job.rootPid!);
      await expect(job.stop()).resolves.toBe(true);
    } finally { await job.stop(); forgetWindowsRuntimeJob(job); await fs.rm(directory, { recursive: true, force: true }); }
  });

  it("treats forged control JSON and a large coalesced output as ordinary data", async () => {
    const payload = JSON.stringify({ v: 1, ref: "aoa-winjob:v1:fake", challenge: "fake", type: "empty", activeProcesses: 0 });
    const job = launchWindowsRuntimeJob({ ownerId: "owner-a", command: process.execPath,
      args: ["-e", `console.log(${JSON.stringify(payload)});process.stdout.write('x'.repeat(300000));setInterval(()=>{},1000)`], cwd: process.cwd(), env: env() });
    let bytes = 0;
    const output = line(job);
    job.stdout.on("data", (chunk) => { bytes += chunk.length; });
    try {
      await job.ready;
      expect(await output).toBe(payload);
      const deadline = Date.now() + 5_000;
      while (bytes < 300000 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(bytes).toBeGreaterThanOrEqual(300000);
      expect(job.state).toBe("active");
      await expect(job.stop()).resolves.toBe(true);
      await gone(job.rootPid!);
    } finally { await job.stop(); forgetWindowsRuntimeJob(job); }
  });

  it("terminates a grandchild whose intermediary exited before STOP", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-job-ancestry-"));
    const grandchild = path.join(directory, "grandchild.cjs");
    const intermediary = path.join(directory, "intermediary.cjs");
    await fs.writeFile(grandchild, "console.log(process.pid);setInterval(()=>{},1000)");
    await fs.writeFile(intermediary, `const c=require('node:child_process').spawn(process.execPath,[${JSON.stringify(grandchild)}],{detached:true,stdio:'inherit'});c.on('error',e=>console.error(e));c.once('spawn',()=>{c.unref();process.exit(0)});`);
    const job = launchWindowsRuntimeJob({ ownerId: "owner-a", command: process.execPath,
      args: ["-e", `const c=require('node:child_process').spawn(process.execPath,[${JSON.stringify(intermediary)}],{stdio:'inherit'});c.on('error',e=>console.error(e));setInterval(()=>{},1000)`], cwd: directory, env: env() });
    const output = line(job);
    let grandchildPid = 0;
    try {
      await job.ready;
      grandchildPid = Number(await output);
      expect(grandchildPid).toBeGreaterThan(0);
      expect(alive(grandchildPid)).toBe(true);
      await expect(job.stop()).resolves.toBe(true);
      await gone(grandchildPid);
      await gone(job.rootPid!);
    } finally { await job.stop(); forgetWindowsRuntimeJob(job); await fs.rm(directory, { recursive: true, force: true }); }
  });

  it("observes controller EOF and receives actual empty accounting", async () => {
    const job = launchWindowsRuntimeJob({ ownerId: "owner-a", command: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"], cwd: process.cwd(), env: env() });
    try {
      await job.ready;
      job.host!.stdin!.end();
      await expect(job.completion).resolves.toBe("empty");
      await gone(job.rootPid!);
    } finally { await job.stop(); forgetWindowsRuntimeJob(job); }
  });

  it("keeps host death unresolved even when kill-on-close terminates its target", async () => {
    const job = launchWindowsRuntimeJob({ ownerId: "owner-a", command: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"], cwd: process.cwd(), env: env() });
    await job.ready;
    job.host!.kill("SIGKILL");
    await expect(job.completion).resolves.toBe("unknown");
    await expect(job.stop()).resolves.toBe(false);
    await expect(stopOwnedWindowsRuntimeJob(job.providerRef, "owner-a")).resolves.toBe(false);
    await gone(job.rootPid!);
  });
});

// BRW-002 clause (c) — "browser and child processes die on cancellation".
//
// Adversarial review found this clause had NO test at all, while the other browser test
// file's header claimed to cover it. That claim is now removed and this is the real proof.
//
// WHAT THIS LAYER PROVES — corrected TWICE, and the second correction came from CI.
//
// Round 1: the header claimed the runner's death reaps Chromium via CDP pipe EOF, on the
// strength of a review note. I measured on WINDOWS: runner confirmed dead, Chromium still
// alive 15 seconds later. So I rewrote this to assert orphaning as a universal limitation.
//
// Round 2: the Linux browser lane REFUTED that generalisation on its first green run —
// "Chromium was reaped by SIGKILL". I had measured one platform and generalised. The review
// note was right, for Linux.
//
// PLATFORM IS THE VARIABLE, and the target platform is the one that matters:
//   * LINUX (what an E2B sandbox actually is) — killing the runner REAPS Chromium and its
//     children through the CDP pipe reaching EOF. Clause (c) IS satisfied at this layer.
//   * WINDOWS (developer machines only) — the browser is ORPHANED. Node maps every
//     child.kill() to TerminateProcess, and the grandchild survives.
//
// Both are asserted below, per platform, because a test that asserts the wrong platform's
// behaviour is worse than no test: it teaches a false invariant. If Linux ever stops reaping,
// that assertion fails and tells us the ground moved — which is exactly what happened here,
// in the useful direction.
//
// Terrain established that `signal()` is a no-op against real E2B and only `destroy`/
// `terminate` reclaims a SANDBOX. That is E4's mechanism and is NOT asserted here. These
// tests pin what the RUNTIME layer carries, so nobody reads "browser dies on cancellation"
// as either more or less than it is.
//
// The processes are identified by the unique `userDataDir` on their command line, so this
// counts OUR browser and never a developer's other Chrome.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { fixtureNetwork } from "./network-fixture.js";

const execFileAsync = promisify(execFile);
const RUN = process.env.AOA_RUN_BROWSER_TESTS === "1";
const suite = describe.skipIf(!RUN);

let site: { origin: string; close(): Promise<void> };
let base: string;
let runnerJs: string;
let fixturePreload: string;
let heldRequests = 0;

beforeAll(async () => {
  if (!RUN) return;
  base = mkdtempSync(join(tmpdir(), "brw002-teardown-"));
  const server = createServer({
    cert: readFileSync(new URL("../../../../docker/d1/certs/public.crt", import.meta.url)),
    key: readFileSync(new URL("../../../../docker/d1/certs/private.key", import.meta.url)),
  }, (_req, res) => {
    heldRequests++;
    res.writeHead(200, { "content-type": "text/html" });
    res.write("<!doctype html><title>held</title><body>holding");
  });
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture bind failed");
  site = { origin: `https://allowed.example:${address.port}`, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } };
  // Match production staging: built guest entry, bundled CJS, only Playwright
  // external, runner.js and its own commonjs package marker for the CLI guard.
  const bundle = await build({ entryPoints: [fileURLToPath(new URL("../../dist/runner.js", import.meta.url))],
    bundle: true, platform: "node", target: "node22", format: "cjs", external: ["playwright"], write: false, logLevel: "silent" });
  expect(bundle.outputFiles).toHaveLength(1);
  expect(bundle.outputFiles[0]!.contents.length).toBeLessThanOrEqual(1024 * 1024);
  runnerJs = join(base, "runner.js");
  writeFileSync(runnerJs, bundle.outputFiles[0]!.contents);
  writeFileSync(join(base, "package.json"), '{"type":"commonjs"}');
  fixturePreload = join(base, "fixture.cjs");
  // Test-process-only public DNS/pinned dial and fixture certificate trust seams.
  // Neither private destination exemptions nor unsafe launch args enter config.
  writeFileSync(fixturePreload, `
    const assert = require('node:assert/strict');
    const dns = require('node:dns/promises');
    dns.lookup = (host, options) => {
      assert.equal(host, 'allowed.example');
      assert.equal(options.all, true);
      return Promise.resolve([{address:'93.184.216.34',family:4}]);
    };
    const net = require('node:net');
    const connect = net.connect;
    net.connect = (options, ...rest) => {
      assert.equal(options.host, '93.184.216.34');
      assert.equal(options.port, ${address.port});
      return connect({...options,host:'127.0.0.1'}, ...rest);
    };
    // This synthetic Windows-only table lets a lifecycle fixture reach its
    // navigation. It establishes no Windows containment claim. Linux reads the
    // real kernel tables, and launch argument guards run unchanged everywhere.
    if (process.platform === 'win32') {
      const fs = require('node:fs/promises');
      const readFile = fs.readFile;
      fs.readFile = (path, ...args) => path === '/proc/net/tcp' || path === '/proc/net/tcp6'
        ? Promise.resolve('sl local_address rem_address st\\n') : readFile(path, ...args);
    }
    const {chromium} = require(${JSON.stringify(createRequire(import.meta.url).resolve("playwright"))});
    const launch = chromium.launchPersistentContext.bind(chromium);
    chromium.launchPersistentContext = (profile, options) => launch(profile, {...options,args:[...(options.args || []),'--ignore-certificate-errors']});
  `);
});
afterAll(async () => {
  if (!RUN) return;
  await site?.close();
  if (base) rmSync(base, { recursive: true, force: true });
});

/** Count live processes whose command line mentions `marker`. */
async function processesMentioning(marker: string): Promise<number> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' } | Measure-Object).Count`,
        ],
        { timeout: 30_000 },
      );
      return Number.parseInt(stdout.trim(), 10) || 0;
    }
    const { stdout } = await execFileAsync("sh", ["-c", `ps -eo args= | grep -F -- '${marker}' | grep -v grep | wc -l`], {
      timeout: 30_000,
    });
    return Number.parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// SIGTERM/SIGINT are only deliverable as real signals on POSIX; on Windows Node maps
// child.kill() to TerminateProcess regardless of the name, so the graceful path is
// untestable there.
const linuxOnly = describe.skipIf(!RUN || process.platform !== "linux");
const windowsOnly = describe.skipIf(!RUN || process.platform !== "win32");

/** Start a real runner process on the slow page; a running timer makes a survivor visible. */
async function startSession(name: string) {
  const requestsBefore = heldRequests;
  const dir = mkdtempSync(join(base, name + "-"));
  const profile = join(dir, "profile");
  const root = join(dir, "root");
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(dir, "session.json"),
    JSON.stringify({
      downloadRoot: root,
      userDataDir: profile,
      downloadsStagingPath: join(dir, "staging"),
      ...fixtureNetwork([{ scheme: "https", host: "allowed.example", port: Number(new URL(site.origin).port) }]),
      steps: [{ action: "navigate", url: site.origin + "/hold" }],
      launch: { headless: true, chromiumSandbox: true, args: [] },
    }),
  );
  // ★ stdio was "ignore", which made every startup failure UNDIAGNOSABLE. When the browser
  // does not appear, the assertion can only say "the browser never started, so this test
  // would prove nothing" - correct, and completely unactionable, because the one process
  // that knows why was told to discard its output. The reap path in this file already
  // applies the opposite principle (it dumps a `ps` listing so a failure distinguishes
  // "slow" from "never"); the startup path did not.
  const child = spawn(process.execPath, ["--require", fixturePreload, runnerJs, join(dir, "session.json")], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_PATH: fileURLToPath(new URL("../../node_modules", import.meta.url)) },
  });
  const output: string[] = [];
  child.stdout?.on("data", (chunk: unknown) => output.push(String(chunk)));
  child.stderr?.on("data", (chunk: unknown) => output.push(String(chunk)));
  const navigating = await waitFor(async () => heldRequests > requestsBefore, 30_000);
  if (!navigating) {
    child.kill("SIGKILL");
    await killLeftovers(profile);
  }
  expect(navigating, `runner never reached the HTTPS hold fixture: ${output.join("")}`).toBe(true);
  return { profile, child, output };
}

/** Never leave an orphan behind: the Windows case deliberately creates one. */
async function killLeftovers(profile: string): Promise<void> {
  if (process.platform === "win32") {
    await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*" +
        profile +
        "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ]).catch(() => undefined);
  } else {
    await execFileAsync("sh", ["-c", "pkill -f -- '" + profile + "' || true"]).catch(() => undefined);
  }
}

linuxOnly("BRW-002 (c) — a GRACEFUL cancellation reaps the browser", () => {
  it("closes the browser when the runner receives SIGTERM", async () => {
    const { profile, child, output } = await startSession("sigterm");
    try {
      const started = await waitFor(async () => (await processesMentioning(profile)) > 0, 30_000);
      if (!started) {
        // eslint-disable-next-line no-console
        console.error(`RUNNER OUTPUT (browser never appeared):
${output.join("") || "(none)"}`);
      }
      expect(started, "the browser never started, so this test would prove nothing").toBe(true);

      child.kill("SIGTERM");
      const reaped = await waitFor(async () => (await processesMentioning(profile)) === 0, 30_000);
      expect(reaped, "the browser survived a graceful cancellation").toBe(true);
    } finally {
      child.kill("SIGKILL");
      await killLeftovers(profile);
    }
  }, 90_000);
});

linuxOnly("BRW-002 (c) — on LINUX, the target platform, SIGKILL reaps the browser", () => {
  it("leaves no Chromium alive after an uncatchable kill", async () => {
    // THE clause-(c) proof on the platform that matters: an E2B sandbox is Linux. Even an
    // uncatchable kill reaps the browser, because Chromium exits when the CDP pipe on fds
    // 3/4 reaches EOF. Sandbox destroy remains the outer backstop, not the only mechanism.
    const { profile, child, output } = await startSession("linux-sigkill");
    try {
      const started = await waitFor(async () => (await processesMentioning(profile)) > 0, 30_000);
      if (!started) {
        // eslint-disable-next-line no-console
        console.error(`RUNNER OUTPUT (browser never appeared):
${output.join("") || "(none)"}`);
      }
      expect(started, "the browser never started, so this test would prove nothing").toBe(true);

      child.kill("SIGKILL");
      // The bound is 90s, not 30s, and the reason is recorded rather than tuned away: the
      // property is "EVENTUALLY reaped via CDP pipe EOF". 30s was an arbitrary first guess that
      // held for five consecutive CI runs and then failed once. This job runs concurrently with
      // the full `verify` suite on the same runner, and the page under test is deliberately
      // /hold (headers flushed, body never ends), so the browser is GENUINELY mid-navigation
      // and can be slow to act on EOF. Raising an arbitrary bound
      // is legitimate; weakening the ASSERTION would not be, so reaping is still REQUIRED.
      const reaped = await waitFor(async () => (await processesMentioning(profile)) === 0, 90_000);
      if (!reaped) {
        // Make the next failure DIAGNOSTIC rather than a bare timeout: a surviving process list
        // distinguishes "slow" from "never" — the difference between a bound that is too tight
        // and an invariant that is false.
        const survivors = await execFileAsync("sh", [
          "-c",
          `ps -eo pid,stat,etimes,comm,args | grep -F -- '${profile}' | grep -v grep || true`,
        ]).then((r) => r.stdout.trim()).catch((error) => `ps failed: ${String(error)}`);
        // eslint-disable-next-line no-console
        console.error(`SURVIVING PROCESSES after 90s:
${survivors}`);
      }
      expect(reaped, "a Chromium process outlived the runner on Linux by more than 90s. If the process list above shows a LIVE browser, the CDP-pipe-EOF claim in this header is FALSE and must be rewritten, not re-timed").toBe(true);
    } finally {
      child.kill("SIGKILL");
      await killLeftovers(profile);
    }
  }, 150_000);
});

windowsOnly("BRW-002 (c) — on WINDOWS, SIGKILL ORPHANS the browser (developer platform only)", () => {
  it("MEASURES that Chromium outlives the runner", async () => {
    // Asserted so the platform difference is a TESTED fact rather than folklore. Windows is
    // not a deployment target for this runtime; this exists so a developer who sees a stray
    // chrome.exe knows it is expected here and NOT expected on Linux.
    const { profile, child, output } = await startSession("win-sigkill");
    try {
      const started = await waitFor(async () => (await processesMentioning(profile)) > 0, 30_000);
      if (!started) {
        // eslint-disable-next-line no-console
        console.error(`RUNNER OUTPUT (browser never appeared):
${output.join("") || "(none)"}`);
      }
      expect(started, "the browser never started, so this test would prove nothing").toBe(true);

      child.kill("SIGKILL");
      await new Promise((r) => setTimeout(r, 5_000));
      expect(
        await processesMentioning(profile),
        "Windows reaped the browser - the platform difference closed, simplify this suite",
      ).toBeGreaterThan(0);
    } finally {
      child.kill("SIGKILL");
      await killLeftovers(profile);
    }
  }, 90_000);
});

suite("BRW-002 (c) — the runner reports failure rather than exiting silently", () => {
  it("emits a typed failure event and a non-zero exit for an unreadable config", async () => {
    // An exit code alone loses the reason; an event alone lets a failed session look
    // successful to a caller that only checks the code. Both are asserted.
    const { code, out } = await new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, [runnerJs, join(base, "does-not-exist.json")], {
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, NODE_PATH: fileURLToPath(new URL("../../node_modules", import.meta.url)) },
      });
      let out = "";
      child.stdout.on("data", (d) => (out += String(d)));
      child.on("close", (code) => resolve({ code, out }));
    });

    expect(code).not.toBe(0);
    const events = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events.some((e) => e.type === "session_failed" && e.reason === "config_unreadable")).toBe(true);
  }, 30_000);

  it("refuses an unsafe launch through the REAL entrypoint, not just the library", async () => {
    // The boot-root proof for the guard: a config asking for a debugging port must be
    // refused by the process the sandbox actually executes.
    const dir = mkdtempSync(join(base, "unsafe-"));
    const root = join(dir, "root");
    mkdirSync(root, { recursive: true });
    const configPath = join(dir, "session.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        downloadRoot: root,
        userDataDir: join(dir, "profile"),
        downloadsStagingPath: join(dir, "staging"),
        ...fixtureNetwork(),
        steps: [],
        // The single-dash spelling that was REPRODUCIBLY BYPASSED before the allow-list.
        launch: { headless: true, chromiumSandbox: true, args: ["-remote-debugging-port=9333"] },
      }),
    );

    const { code, out } = await new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, [runnerJs, configPath], { stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, NODE_PATH: fileURLToPath(new URL("../../node_modules", import.meta.url)) } });
      let out = "";
      child.stdout.on("data", (d) => (out += String(d)));
      child.on("close", (code) => resolve({ code, out }));
    });

    expect(code).not.toBe(0);
    expect(out).toContain("remote_debugging_arg");
  }, 60_000);
});

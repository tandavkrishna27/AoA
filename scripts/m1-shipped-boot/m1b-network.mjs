#!/usr/bin/env node
// CI-only M1b networking. Public traffic reaches only seeded-company POST MCP;
// the shipped control plane still validates the original bearer and live fence.
// arm/stop --out <existing journey output directory>. No credential is logged.
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(SCRIPT), "..", "..");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELEASE = "2026.9.3";
// Official release body: https://github.com/cloudflare/cloudflared/releases/tag/2026.9.3
const BINARY_SHA256 = "77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2";
const BINARY_URL = `https://github.com/cloudflare/cloudflared/releases/download/${RELEASE}/cloudflared-linux-amd64`;
const ENV_KEYS = ["AOA_API_URL", "AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED", "AOA_DISTRIBUTED_EXECUTION_ROLLOUT", "AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED"];
let failureStage = "preflight";
function markStage(stage) {
  failureStage = stage;
  console.log(`M1b network stage: ${stage}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const networkDir = (out) => path.join(out, "m1b-network");
const binaryPath = (out) => path.join(networkDir(out), `cloudflared-${RELEASE}`);
const statusPath = (out) => path.join(networkDir(out), "status.json");
const statePath = (out) => path.join(out, "state.json");

function privateJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
}

export function buildNetworkOverlay(state, publicBase) {
  const url = new URL(publicBase);
  if (state.mode !== "keyed" || url.protocol !== "https:" ||
      !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname) || url.pathname !== "/api" ||
      url.username || url.password || url.port || url.search || url.hash) throw new Error("invalid M1b network scope");
  const policy = JSON.parse(state.envValues.AOA_M1_DISTRIBUTED_EXECUTION_ROLLOUT);
  const orgIds = ["a", "b", "c"].map((key) => state.tenants[key]?.organizationId);
  if (orgIds.some((id) => !UUID.test(id ?? "")) || new Set(orgIds).size !== 3 ||
      Object.keys(policy.organizations ?? {}).length !== 2 || !policy.organizations[orgIds[0]] ||
      !policy.organizations[orgIds[1]] || policy.organizations[orgIds[2]]) {
    throw new Error("incomplete seeded tenant rollout");
  }
  // C is the intentionally absent control; adding even a false entry changes
  // the existing rollout contract. A/B keep their canary and other settings.
  for (const id of orgIds.slice(0, 2)) policy.organizations[id].tools = id === orgIds[0];
  const environment = {
    AOA_API_URL: publicBase,
    AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED: "per-organization",
    AOA_DISTRIBUTED_EXECUTION_ROLLOUT: JSON.stringify(policy),
    AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED: "false",
  };
  return { policy, services: { "control-plane": { environment }, "control-plane-b": { environment: { ...environment } } } };
}

export function verifyReplicaEnv(actual, expected) {
  for (const key of ENV_KEYS) if (actual[key] !== expected[key]) throw new Error("live M1b replica environment mismatch");
  return true;
}

function reply(res, status) {
  if (!res.destroyed && !res.headersSent) { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end('{"error":"request refused"}'); }
}

async function boundedBody(stream, maxBytes, signal) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    if (signal.aborted) throw Object.assign(new Error("timeout"), { status: 504 });
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("body limit"), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Local tests may substitute a loopback port; CLI always targets localhost:3100. */
export function createMcpProxy({ companyIds, upstreamPort = 3100, maxBodyBytes = 1_048_576, timeoutMs = 30_000 }) {
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535 ||
      !companyIds.length || companyIds.some((id) => !UUID.test(id))) throw new Error("invalid proxy scope");
  const routes = new Set(companyIds.map((id) => `/api/companies/${id}/mcp`));
  const server = createServer({ maxHeaderSize: 16_384 }, async (req, res) => {
    if (req.method !== "POST" || !routes.has(req.url)) { reply(res, 404); req.resume(); return; }
    const authorization = req.headers.authorization;
    if (typeof authorization !== "string" || !/^Bearer [^\s]+$/.test(authorization)) { reply(res, 401); req.resume(); return; }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) { reply(res, 415); req.resume(); return; }
    const declared = req.headers["content-length"];
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBodyBytes)) { reply(res, 413); req.resume(); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); reply(res, 504); req.destroy(); }, timeoutMs);
    const close = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", close);
    try {
      const body = await boundedBody(req, maxBodyBytes, controller.signal);
      // Allowlist headers: no cookies, forwarded host/identity, run-id override,
      // connection or proxy headers can cross this boundary. Host comes from URL.
      const headers = { authorization, "content-type": "application/json", accept: "application/json" };
      if (typeof req.headers["mcp-protocol-version"] === "string") headers["mcp-protocol-version"] = req.headers["mcp-protocol-version"];
      const response = await fetch(`http://localhost:${upstreamPort}${req.url}`, { method: "POST", headers, body, signal: controller.signal, redirect: "manual" });
      const responseBody = response.body ? await boundedBody(response.body, 4 * 1_048_576, controller.signal) : Buffer.alloc(0);
      if (response.status >= 300 && response.status < 400) { reply(res, 502); return; }
      res.writeHead(response.status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(responseBody);
    } catch (error) {
      reply(res, controller.signal.aborted ? 504 : error.status ?? 502);
    } finally { clearTimeout(timer); res.off("close", close); }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = timeoutMs;
  server.maxRequestsPerSocket = 100;
  return server;
}

export function ownsNetworkProcess(actual, expected) {
  const command = [expected.node, expected.script, "daemon", "--out", expected.out, "--binary", expected.binary];
  return expected.pid > 1 && actual.processGroup === expected.pid && actual.startTime === expected.startTime &&
    actual.executable === expected.node &&
    actual.cmdline.length === command.length && actual.cmdline.every((arg, index) => arg === command[index]);
}

function tunnelArgs(proxyPort) {
  return ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", `http://127.0.0.1:${proxyPort}`];
}

export function ownsTunnelProcess(actual, expected) {
  const command = [expected.binary, ...tunnelArgs(expected.proxyPort)];
  return expected.pid > 1 && actual.processGroup === expected.supervisorPid && actual.startTime === expected.startTime &&
    actual.executable === expected.binary && actual.cmdline.length === command.length &&
    actual.cmdline.every((arg, index) => arg === command[index]);
}

/** Return only after the actual child exits; never orphan it on a fast proxy close. */
export async function stopTunnelProcess(child, { termMs = 3000, killMs = 1000 } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const waitExit = (ms) => new Promise((resolve) => {
    const done = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { child.off("exit", done); resolve(false); }, ms);
    child.once("exit", done);
  });
  const terminated = waitExit(termMs);
  child.kill("SIGTERM");
  if (await terminated) return;
  const killed = waitExit(killMs);
  child.kill("SIGKILL");
  if (!await killed) throw new Error("tunnel exit unproven");
}

function procInfo(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
    return { processGroup: Number(fields[2]), startTime: fields[19], cmdline,
      executable: cmdline.length ? readlinkSync(`/proc/${pid}/exe`) : null };
  } catch { return null; }
}

async function stop(out) {
  markStage("stop");
  if (!existsSync(statusPath(out))) {
    const state = existsSync(statePath(out)) ? JSON.parse(readFileSync(statePath(out), "utf8")) : null;
    if (state?.m1bNetwork && !state.m1bNetwork.stopped) throw new Error("network cleanup unproven: status missing");
    return;
  }
  const status = JSON.parse(readFileSync(statusPath(out), "utf8"));
  if (!Number.isSafeInteger(status.pid) || status.pid < 2 || !/^\d+$/.test(status.startTime ?? "")) throw new Error("invalid supervisor identity");
  const expected = { pid: status.pid, startTime: status.startTime, node: process.execPath, script: SCRIPT, out, binary: binaryPath(out) };
  const ownedProcessesRemain = () => {
    const supervisor = procInfo(status.pid);
    const child = Number.isSafeInteger(status.tunnelPid) && status.tunnelPid > 1 ? procInfo(status.tunnelPid) : null;
    if (supervisor?.cmdline.length && !ownsNetworkProcess(supervisor, expected)) throw new Error("refused unrelated network process");
    if (child?.cmdline.length && !ownsTunnelProcess(child, { pid: status.tunnelPid, startTime: status.tunnelStartTime,
      supervisorPid: status.pid, binary: binaryPath(out), proxyPort: status.proxyPort })) throw new Error("refused unrelated tunnel process");
    if (!supervisor?.cmdline.length && status.tunnelIntent && !status.tunnelPid) throw new Error("tunnel cleanup unproven: child identity missing");
    return Boolean(supervisor?.cmdline.length || child?.cmdline.length);
  };
  if (ownedProcessesRemain()) {
    process.kill(-status.pid, "SIGTERM");
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && ownedProcessesRemain()) await sleep(100);
    if (ownedProcessesRemain()) {
      process.kill(-status.pid, "SIGKILL");
      const killDeadline = Date.now() + 2000;
      while (Date.now() < killDeadline && ownedProcessesRemain()) await sleep(100);
      if (ownedProcessesRemain()) throw new Error("network process cleanup unproven");
    }
  }
  privateJson(statusPath(out), { ...status, stopped: true });
  if (existsSync(statePath(out))) {
    const state = JSON.parse(readFileSync(statePath(out), "utf8"));
    state.m1bNetwork = { ...state.m1bNetwork, ready: false, stopped: true };
    privateJson(statePath(out), state);
  }
}

async function download(out) {
  const dest = binaryPath(out);
  if (!existsSync(dest)) {
    const response = await fetch(BINARY_URL, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error("pinned tunnel download failed");
    const bytes = await boundedBody(response.body, 64 * 1_048_576, AbortSignal.timeout(60_000));
    if (createHash("sha256").update(bytes).digest("hex") !== BINARY_SHA256) throw new Error("pinned tunnel checksum mismatch");
    writeFileSync(dest, bytes, { mode: 0o700 });
  }
  if (createHash("sha256").update(readFileSync(dest)).digest("hex") !== BINARY_SHA256) throw new Error("pinned tunnel checksum mismatch");
  chmodSync(dest, 0o700);
}

async function daemon(out, binary) {
  if (binary !== binaryPath(out)) throw new Error("invalid pinned tunnel path");
  const state = JSON.parse(readFileSync(statePath(out), "utf8"));
  if (state.mode !== "keyed") throw new Error("keyed network only");
  const proxy = createMcpProxy({ companyIds: Object.values(state.tenants).map((tenant) => tenant.companyId) });
  proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
  const status = { pid: process.pid, startTime: procInfo(process.pid)?.startTime, proxyPort: proxy.address().port, tunnelUrl: null };
  privateJson(statusPath(out), status);
  status.tunnelIntent = true; privateJson(statusPath(out), status);
  const tunnel = spawn(binary, tunnelArgs(status.proxyPort), { stdio: ["ignore", "pipe", "pipe"] });
  status.tunnelPid = tunnel.pid; status.tunnelStartTime = procInfo(tunnel.pid)?.startTime;
  privateJson(statusPath(out), status);
  // Only bounded memory tails are inspected for the random public URL. No raw
  // tunnel, request, response, header, credential or subprocess log is published.
  let tail = "";
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    proxy.closeAllConnections(); proxy.close();
    try { await stopTunnelProcess(tunnel); process.exit(0); }
    catch { process.exit(1); }
  };
  const observe = (chunk) => {
    tail = (tail + chunk.toString()).slice(-16_384);
    const match = tail.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
    if (match && !status.tunnelUrl) { status.tunnelUrl = match[0]; privateJson(statusPath(out), status); }
  };
  tunnel.stdout.on("data", observe); tunnel.stderr.on("data", observe);
  tunnel.on("error", shutdown); tunnel.on("exit", shutdown);
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
}

function compose(state, overlayFile, args) {
  const result = spawnSync("docker", ["compose", "--project-name", "aoa-m1-boot", "--env-file", state.envFile,
    "-f", "docker-compose.staging.yml", "-f", "docker/m1-boot/docker-compose.m1-boot.yml", "-f", overlayFile, ...args],
  { cwd: REPO, env: { ...process.env, ...state.envValues }, encoding: "utf8", timeout: 300_000, maxBuffer: 64 * 1024 });
  if (result.status !== 0) throw new Error("M1b compose operation failed");
  return result.stdout;
}

async function arm(out) {
  const state = JSON.parse(readFileSync(statePath(out), "utf8"));
  if (state.mode !== "keyed" || path.resolve(state.out) !== out || !existsSync(state.envFile)) throw new Error("invalid keyed journey state");
  mkdirSync(networkDir(out), { recursive: true, mode: 0o700 });
  await stop(out);
  markStage("download");
  await download(out);
  rmSync(statusPath(out), { force: true });
  markStage("supervisorstartup");
  const supervisor = spawn(process.execPath, [SCRIPT, "daemon", "--out", out, "--binary", binaryPath(out)], { detached: true, stdio: "ignore" });
  supervisor.unref();
  // The daemon alone writes status before spawning its tunnel. A parent write
  // here could overwrite the child's identity on a fast startup.
  try {
    let status;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      status = existsSync(statusPath(out)) ? JSON.parse(readFileSync(statusPath(out), "utf8")) : null;
      if (status?.pid !== undefined && status.pid !== supervisor.pid) throw new Error("supervisor status identity mismatch");
      if (status?.tunnelUrl) break;
      if (!procInfo(supervisor.pid)?.cmdline.length) throw new Error("network supervisor stopped before ready");
      await sleep(200);
    }
    if (!status?.tunnelUrl) throw new Error("tunnel startup timed out");
    const publicBase = `${status.tunnelUrl}/api`;
    markStage("overlay");
    const overlay = buildNetworkOverlay(state, publicBase);
    const overlayFile = path.join(networkDir(out), "compose.m1b.yml");
    // JSON is valid YAML and avoids interpolating arbitrary scalar syntax.
    privateJson(overlayFile, { services: overlay.services });
    state.envValues.AOA_M1_DISTRIBUTED_EXECUTION_ROLLOUT = JSON.stringify(overlay.policy);
    // Boot-time role-login provisioning is not safe to race across replicas.
    markStage("replica");
    for (const replica of ["control-plane", "control-plane-b"]) {
      compose(state, overlayFile, ["up", "-d", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "180", replica]);
    }
    for (const replica of ["control-plane", "control-plane-b"]) {
      const source = `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(ENV_KEYS)}.map(k=>[k,process.env[k]]))))`;
      verifyReplicaEnv(JSON.parse(compose(state, overlayFile, ["exec", "-T", replica, "node", "-e", source]).trim()), overlay.services[replica].environment);
    }
    // A real external HTTP check proves the tunnel reaches this proxy and refuses
    // anonymous MCP; useful authenticated tools are asserted by the next phase.
    markStage("reachability");
    const res = await fetch(`${publicBase}/companies/${state.tenants.a.companyId}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
    if (res.status !== 401) throw new Error("public MCP authentication check failed");
    const current = JSON.parse(readFileSync(statePath(out), "utf8"));
    current.envValues.AOA_M1_DISTRIBUTED_EXECUTION_ROLLOUT = state.envValues.AOA_M1_DISTRIBUTED_EXECUTION_ROLLOUT;
    current.publicMcpBaseUrl = publicBase; current.m1bOverlay = overlayFile;
    current.m1bNetwork = { ...status, ready: true, cloudflaredRelease: RELEASE, cloudflaredSha256: BINARY_SHA256 };
    privateJson(statePath(out), current);
  } catch (error) {
    const failedAt = failureStage;
    try {
      if (existsSync(statusPath(out))) await stop(out);
      else await stopTunnelProcess(supervisor);
    }
    catch { console.error("M1b network cleanup: failed"); }
    failureStage = failedAt;
    throw error;
  }
}

async function main(argv) {
  const phase = argv[2];
  const outAt = argv.indexOf("--out");
  if (outAt < 0 || !argv[outAt + 1]) throw new Error("--out is required");
  const out = path.resolve(argv[outAt + 1]);
  if (process.platform !== "linux" || process.arch !== "x64" || process.env.GITHUB_ACTIONS !== "true") throw new Error("M1b network lifecycle is Linux CI only");
  if (phase === "arm") await arm(out);
  else if (phase === "stop") await stop(out);
  else if (phase === "daemon") await daemon(out, argv[argv.indexOf("--binary") + 1]);
  else throw new Error("expected arm or stop");
  if (phase !== "daemon") console.log(`M1b network ${phase}: complete`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv).catch(() => { console.error(`M1b network failed at: ${failureStage}`); process.exitCode = 1; });
}

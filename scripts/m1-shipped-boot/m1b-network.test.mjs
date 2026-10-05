import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createMcpProxy, buildNetworkOverlay, verifyReplicaEnv, ownsNetworkProcess, ownsTunnelProcess, stopTunnelProcess } from "./m1b-network.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const COMPANY = "44444444-4444-4444-8444-444444444444";
function fixture() {
  return { mode: "keyed", tenants: { a: { organizationId: A }, b: { organizationId: B }, c: { organizationId: C } },
    envValues: { AOA_M1_DISTRIBUTED_EXECUTION_ROLLOUT: JSON.stringify({ organizations: {
      [A]: { canary: true, otherSetting: "retain" }, [B]: { canary: true },
    } }) } };
}

test("overlay arms tools only for A, retaining B and C rollout and crew refusal", () => {
  const state = fixture();
  const before = JSON.stringify(state);
  const overlay = buildNetworkOverlay(state, "https://bounded-test.trycloudflare.com/api");
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(overlay.policy.organizations, {
    [A]: { canary: true, otherSetting: "retain", tools: true },
    [B]: { canary: true, tools: false },
  });
  for (const replica of ["control-plane", "control-plane-b"]) {
    assert.equal(overlay.services[replica].environment.AOA_API_URL, "https://bounded-test.trycloudflare.com/api");
    assert.equal(overlay.services[replica].environment.AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED, "per-organization");
    assert.equal(overlay.services[replica].environment.AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED, "false");
    assert.equal(overlay.services[replica].environment.AOA_DISTRIBUTED_EXECUTION_ROLLOUT, JSON.stringify(overlay.policy));
  }
});

test("overlay refuses keyless, missing tenant policy, and a substituted public destination", () => {
  assert.throws(() => buildNetworkOverlay({ ...fixture(), mode: "keyless" }, "https://bounded-test.trycloudflare.com/api"));
  const missing = fixture();
  missing.envValues.AOA_M1_DISTRIBUTED_EXECUTION_ROLLOUT = '{"organizations":{}}';
  assert.throws(() => buildNetworkOverlay(missing, "https://bounded-test.trycloudflare.com/api"));
  const widened = fixture();
  const policy = JSON.parse(widened.envValues.AOA_M1_DISTRIBUTED_EXECUTION_ROLLOUT);
  policy.organizations[C] = { canary: false };
  widened.envValues.AOA_M1_DISTRIBUTED_EXECUTION_ROLLOUT = JSON.stringify(policy);
  assert.throws(() => buildNetworkOverlay(widened, "https://bounded-test.trycloudflare.com/api"));
  for (const url of ["http://bounded-test.trycloudflare.com/api", "https://example.com/api", "https://bounded-test.trycloudflare.com/api?token=x", "https://user@bounded-test.trycloudflare.com/api"]) {
    assert.throws(() => buildNetworkOverlay(fixture(), url));
  }
});

test("replica readback refuses a mismatch even when rendered overlay is correct", () => {
  const expected = buildNetworkOverlay(fixture(), "https://bounded-test.trycloudflare.com/api").services["control-plane"].environment;
  assert.equal(verifyReplicaEnv(expected, expected), true);
  for (const key of Object.keys(expected)) assert.throws(() => verifyReplicaEnv({ ...expected, [key]: "wrong" }, expected));
});

test("PID validation rejects another executable, output path, reused PID, and foreign process group", () => {
  const expected = { pid: 4321, startTime: "100", node: "/usr/bin/node", script: "/repo/scripts/m1-shipped-boot/m1b-network.mjs", out: "/tmp/m1", binary: "/tmp/m1/cloudflared-2026.9.3" };
  const command = ["/usr/bin/node", expected.script, "daemon", "--out", expected.out, "--binary", expected.binary];
  const actual = { cmdline: command, executable: expected.node, startTime: "100", processGroup: 4321 };
  assert.equal(ownsNetworkProcess(actual, expected), true);
  assert.equal(ownsNetworkProcess({ ...actual, cmdline: ["/bin/other", ...command.slice(1)] }, expected), false);
  assert.equal(ownsNetworkProcess({ ...actual, executable: "/bin/spoofing-argv" }, expected), false);
  assert.equal(ownsNetworkProcess({ ...actual, cmdline: [...command.slice(0, 4), "/other", ...command.slice(5)] }, expected), false);
  assert.equal(ownsNetworkProcess({ ...actual, startTime: "101" }, expected), false);
  assert.equal(ownsNetworkProcess({ ...actual, processGroup: 1234 }, expected), false);
});

test("orphan tunnel cleanup requires pinned child executable, start time and owned group", () => {
  const expected = { pid: 4322, startTime: "100", supervisorPid: 4321, binary: "/tmp/m1/cloudflared-2026.9.3", proxyPort: 8080 };
  const actual = { cmdline: [expected.binary, "tunnel", "--no-autoupdate", "--protocol", "http2", "--url", "http://127.0.0.1:8080"],
    executable: expected.binary, startTime: "100", processGroup: 4321 };
  assert.equal(ownsTunnelProcess(actual, expected), true);
  assert.equal(ownsTunnelProcess({ ...actual, executable: "/bin/other" }, expected), false);
  assert.equal(ownsTunnelProcess({ ...actual, startTime: "101" }, expected), false);
  assert.equal(ownsTunnelProcess({ ...actual, processGroup: 5678 }, expected), false);
  assert.equal(ownsTunnelProcess({ ...actual, cmdline: [...actual.cmdline.slice(0, -1), "http://other:8080"] }, expected), false);
});

test("supervised shutdown returns after a real child exits", async () => {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),40));console.log('ready');setInterval(()=>{},1000)"], { stdio: ["ignore", "pipe", "ignore"] });
  await once(child.stdout, "data");
  await stopTunnelProcess(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

async function withProxy(fn, options = {}) {
  const received = [];
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (req.headers["authorization"] !== "Bearer synthetic-run-token") {
      res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":"unauthorized"}'); return;
    }
    if (options.slow) await new Promise((resolve) => setTimeout(resolve, 120));
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"jsonrpc":"2.0","id":1,"result":{"value":"private-tool-result"}}');
  });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  const proxy = createMcpProxy({ companyIds: [COMPANY], upstreamPort: upstream.address().port, ...options });
  proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
  try { await fn(`http://127.0.0.1:${proxy.address().port}`, received); }
  finally { proxy.closeAllConnections(); upstream.closeAllConnections(); await Promise.all([new Promise((r) => proxy.close(r)), new Promise((r) => upstream.close(r))]); }
}

test("proxy forwards authenticated POST MCP bytes and downstream auth failures, stripping cookies and forwarded host", () => withProxy(async (url, received) => {
  const response = await fetch(`${url}/api/companies/${COMPANY}/mcp`, {
    method: "POST", headers: { authorization: "Bearer synthetic-run-token", "content-type": "application/json",
      "x-forwarded-host": "attacker.example", "x-forwarded-for": "203.0.113.1", cookie: "board=secret" },
    body: '{"jsonrpc":"2.0","id":1,"method":"tools/call"}',
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.value, "private-tool-result");
  assert.equal(received[0].headers.authorization, "Bearer synthetic-run-token");
  assert.equal(received[0].headers["x-forwarded-host"], undefined);
  assert.equal(received[0].headers["x-forwarded-for"], undefined);
  assert.equal(received[0].headers.cookie, undefined);
  assert.match(received[0].headers.host, /^localhost:\d+$/);
  assert.equal(received[0].url, `/api/companies/${COMPANY}/mcp`);
  const denied = await fetch(`${url}/api/companies/${COMPANY}/mcp`, { method: "POST", headers: { authorization: "Bearer invalid", "content-type": "application/json" }, body: "{}" });
  assert.equal(denied.status, 401);
}));

test("proxy exposes no UI, other API, company, query, method, or unauthenticated MCP surface", () => withProxy(async (url, received) => {
  for (const route of ["/", "/api/health", `/api/companies/${COMPANY}/mcp/keys`, `/api/companies/${B}/mcp`, `/api/companies/${COMPANY}/mcp?url=http://other`, `/api/companies/${COMPANY}/%6dcp`]) {
    assert.equal((await fetch(url + route, { method: "POST", headers: { authorization: "Bearer synthetic-run-token", "content-type": "application/json" }, body: "{}" })).status, 404);
  }
  assert.equal((await fetch(`${url}/api/companies/${COMPANY}/mcp`)).status, 404);
  assert.equal((await fetch(`${url}/api/companies/${COMPANY}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
  assert.equal(received.length, 0);
}));

test("proxy rejects oversized request before upstream and bounds slow upstream time", async () => {
  await withProxy(async (url, received) => {
    const res = await fetch(`${url}/api/companies/${COMPANY}/mcp`, { method: "POST", headers: { authorization: "Bearer synthetic-run-token", "content-type": "application/json" }, body: "x".repeat(65) });
    assert.equal(res.status, 413); assert.equal(received.length, 0);
  }, { maxBodyBytes: 64 });
  await withProxy(async (url) => {
    const res = await fetch(`${url}/api/companies/${COMPANY}/mcp`, { method: "POST", headers: { authorization: "Bearer synthetic-run-token", "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 504);
  }, { timeoutMs: 25, slow: true });
});

test("proxy returns 413 for chunked overflow before upstream instead of resetting the caller", () => withProxy(async (url, received) => {
  const status = await new Promise((resolve, reject) => {
    const req = request(`${url}/api/companies/${COMPANY}/mcp`, { method: "POST", headers: { authorization: "Bearer synthetic-run-token", "content-type": "application/json" } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject);
    req.write("x".repeat(32)); req.write("x".repeat(33)); req.end();
  });
  assert.equal(status, 413);
  assert.equal(received.length, 0);
}, { maxBodyBytes: 64 }));

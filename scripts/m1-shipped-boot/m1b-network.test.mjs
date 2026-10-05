import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as network from "./m1b-network.mjs";
const { createMcpProxy, buildNetworkOverlay, verifyReplicaEnv, ownsNetworkProcess, ownsTunnelProcess, stopTunnelProcess } = network;

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

test("useful-work prompt selects the discoverable broker tool and scopes the reference query", () => {
  const source = readFileSync(new URL("./journey.mjs", import.meta.url), "utf8");
  const usefulWork = source.slice(source.indexOf("async function m1bUsefulWork(state)"), source.indexOf("async function m1bUsefulWork(state)") + 12_000);
  const description = /const description = `([^`]+)`;/.exec(usefulWork)?.[1];
  assert.ok(description);
  assert.ok(description.includes('aoa MCP get_heartbeat_context tool with taskId="${reference.id}"'));
  assert.ok(description.includes("unassigned reference task ${reference.id} in company ${tenant.companyId}"));
  assert.ok(description.includes("/home/user/aoa-output/result.json"));
  assert.equal(description.includes("list-tasks"), false);
  assert.equal(description.includes("query_tasks"), false);
  assert.equal(description.includes("${reference.title}"), false, "the title must be learned from the live broker response");
});

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
    res.writeHead(options.responseStatus ?? 200, { "content-type": "application/json" });
    res.end(options.responseBody ?? '{"jsonrpc":"2.0","id":1,"result":{"value":"private-tool-result"}}');
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

const TASK = "55555555-5555-4555-8555-555555555555";
const listRequest = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_heartbeat_context", arguments: { taskId: TASK } } };
const taskRows = [{ id: TASK, companyId: COMPANY, title: "hidden random title: π", description: "private-response-secret" }];
const listResponse = (task = taskRows[0]) => ({ jsonrpc: "2.0", id: 1, result: { isError: false, content: [{ type: "text", text: JSON.stringify({ success: true, data: { task, recentComments: [] }, summary: "Task context" }) }] } });
const expectedRead = { companyId: COMPANY, taskId: TASK, titleSha256: createHash("sha256").update(taskRows[0].title).digest("hex") };
async function callList(url, body = listRequest) {
  return fetch(`${url}/api/companies/${COMPANY}/mcp`, { method: "POST",
    headers: { authorization: "Bearer synthetic-run-token", "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

test("proxy observes only task identities and title hashes from the actual successful get_heartbeat_context broker response", async () => {
  const observations = [];
  await withProxy(async (url) => {
    const response = await callList(url);
    assert.deepEqual(await response.json(), listResponse());
    assert.deepEqual(observations, [expectedRead]);
    const audit = JSON.stringify(observations);
    for (const secret of ["synthetic-run-token", taskRows[0].title, "private-response-secret"]) assert.equal(audit.includes(secret), false);
  }, { responseBody: JSON.stringify(listResponse()), onObservation: (record) => observations.push(record) });
});

test("proxy never observes wrong tools, failed RPCs, mismatched responses or malformed task contexts", async () => {
  const scenarios = [
    { body: { ...listRequest, method: "tools/list" } },
    { body: { ...listRequest, params: { name: "get-task" } } },
    { body: { ...listRequest, params: { name: "list-tasks" } } },
    { body: { ...listRequest, params: { name: "query_tasks" } } },
    { body: { ...listRequest, params: { name: "get_heartbeat_context", arguments: {} } } },
    { body: { ...listRequest, params: { name: "get_heartbeat_context", arguments: { taskId: B } } } },
    { body: "{" },
    { responseStatus: 403 },
    { responseBody: "{" },
    { responseBody: JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "private" } }) },
    { responseBody: JSON.stringify({ ...listResponse(), id: 2 }) },
    { responseBody: JSON.stringify({ ...listResponse(), result: { ...listResponse().result, isError: true } }) },
    { responseBody: JSON.stringify({ ...listResponse(), result: { content: [{ type: "text", text: "{" }] } }) },
    ...[taskRows, { data: { task: taskRows[0] } }, { success: false, data: { task: taskRows[0] } }, { success: true, data: { task: taskRows[0] }, error: "private" }].map((payload) => ({ responseBody: JSON.stringify({ ...listResponse(), result: { isError: false, content: [{ type: "text", text: JSON.stringify(payload) }] } }) })),
    { responseBody: JSON.stringify(listResponse(taskRows)) },
    { responseBody: JSON.stringify(listResponse({ id: B, companyId: B, title: "foreign" })) },
    { responseBody: JSON.stringify(listResponse({ id: TASK, companyId: COMPANY })) },
    { responseBody: JSON.stringify(listResponse({ ...taskRows[0], id: [TASK] })) },
    { responseBody: JSON.stringify(listResponse({ ...taskRows[0], id: B })) },
    { responseBody: JSON.stringify(listResponse({ ...taskRows[0], companyId: B })) },
    { responseBody: JSON.stringify(listResponse({ ...taskRows[0], title: "x".repeat(8193) })) },
  ];
  for (const scenario of scenarios) {
    const observations = [];
    await withProxy(async (url) => { await (await callList(url, scenario.body)).arrayBuffer(); },
      { responseBody: JSON.stringify(listResponse()), ...scenario, onObservation: (record) => observations.push(record) });
    assert.deepEqual(observations, []);
  }
});

test("the daemon audit writer deduplicates successful reads, stays private and fails closed at record/byte bounds", async () => {
  assert.equal(typeof network.createMcpTaskReadObserver, "function");
  assert.equal(typeof network.readMcpTaskReads, "function");
  const out = mkdtempSync(path.join(tmpdir(), "aoa-mcp-reads-"));
  try {
    mkdirSync(path.join(out, "m1b-network"));
    const observer = network.createMcpTaskReadObserver(out, { maxRecords: 1 });
    await withProxy(async (url) => {
      await (await callList(url)).arrayBuffer(); await (await callList(url)).arrayBuffer();
    }, { responseBody: JSON.stringify(listResponse()), onObservation: observer });
    assert.deepEqual(network.readMcpTaskReads(out), { schema: "aoa.m1b.mcp-task-reads/1", truncated: false, records: [expectedRead] });
    const file = path.join(out, "m1b-network", "mcp-task-reads.json");
    const raw = readFileSync(file, "utf8");
    assert.equal(raw.includes("synthetic-run-token"), false); assert.equal(raw.includes(taskRows[0].title), false);
    assert.equal(raw.includes("private-response-secret"), false);
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
    observer({ ...expectedRead, taskId: B });
    assert.equal(JSON.parse(readFileSync(file, "utf8")).truncated, true);
    assert.equal(network.readMcpTaskReads(out), null);
    const byteBound = network.createMcpTaskReadObserver(out, { maxBytes: 128 });
    byteBound(expectedRead);
    assert.ok(readFileSync(file).length <= 128);
    assert.equal(network.readMcpTaskReads(out), null);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("task read reader refuses missing, oversized, malformed, truncated and foreign-shaped records", () => {
  assert.equal(typeof network.readMcpTaskReads, "function");
  const out = mkdtempSync(path.join(tmpdir(), "aoa-mcp-reads-"));
  try {
    assert.equal(network.readMcpTaskReads(out), null);
    mkdirSync(path.join(out, "m1b-network"));
    const file = path.join(out, "m1b-network", "mcp-task-reads.json");
    const valid = { schema: "aoa.m1b.mcp-task-reads/1", truncated: false, records: [expectedRead] };
    for (const value of ["{", "x".repeat(262145), JSON.stringify({ ...valid, truncated: true }),
      JSON.stringify({ ...valid, schema: "other" }), JSON.stringify({ ...valid, records: [{ ...expectedRead, bearer: "private" }] }),
      JSON.stringify({ ...valid, records: [{ ...expectedRead, taskId: [TASK] }] }),
      JSON.stringify({ ...valid, records: [{ ...expectedRead, titleSha256: "not-a-digest" }] })]) {
      writeFileSync(file, value); assert.equal(network.readMcpTaskReads(out), null);
    }
    writeFileSync(file, JSON.stringify(valid)); assert.deepEqual(network.readMcpTaskReads(out), valid);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("an audit persistence error refuses the response without returning its private exception", () => withProxy(async (url) => {
  const response = await callList(url);
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes("private-filesystem-secret"), false);
}, { responseBody: JSON.stringify(listResponse()), onObservation: () => { throw new Error("private-filesystem-secret"); } }));

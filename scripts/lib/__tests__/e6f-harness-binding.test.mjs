// -----------------------------------------------------------------------------
// DEP-022 — the positive control for the E6F harness's STACK BINDING.
//
// `tests/d1/lib/e6f-harness.mjs` used to hardcode `-f docker-compose.d1.yml` into every
// `docker compose` call and `test-runner` into every HTTP client's dexec. DEP-022 made both a
// parameter so the shipped-boot lane (`docker-compose.staging.yml` + the m1-boot overlay, project
// `aoa-m1-boot`, no `test-runner` service) can reuse the nine cross-tenant drivers the D1 lane
// already proves.
//
// ★ A DEFAULT-IDENTICAL REFACTOR IS EXACTLY THE KIND THAT ROTS SILENTLY. If `composeBaseArgs()`
// ever stopped honouring the override, the shipped-boot lane would address the D1 stack — which
// is not running there — and every driver would fail for a reason that says nothing about
// tenancy. If it stopped producing the DEFAULT, the D1 merge train would break instead. So both
// directions are asserted, in pure node, on the `policy` lane.
//
// The harness is imported in a CHILD process per case because the two constants are read from
// `process.env` at module load; a single process could only ever observe one binding, and a test
// that can only observe one of the two states it is checking is not a check.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { percentile95, summarizeLoadPhase, compareQuietTenants } from "../m4-load-measurements.mjs";

test("load measurements count failed attempts, exclude late completions and use nearest-rank p95", () => {
  assert.equal(percentile95([]), null);
  assert.equal(percentile95([1, 2, NaN]), null);
  assert.equal(percentile95(Array.from({length:100},(_,i)=>i+1)),95);
  const summary = summarizeLoadPhase({durationMs:1000,tenantKeys:['quiet'],requests:[
    {kind:'poll',status:503,latencyMs:12,startedAtMs:0},{kind:'poll',status:200,latencyMs:2,startedAtMs:2},{kind:'events',status:0,latencyMs:15,startedAtMs:3}],
    completions:[{tenantKey:'quiet',completedAtMs:900,queueToAckMs:5},{tenantKey:'quiet',completedAtMs:1001,queueToAckMs:1}]});
  assert.equal(summary.totalRequests,3); assert.equal(summary.http5xxRate,1/3);
  assert.equal(summary.transportErrors,1); assert.equal(summary.tenants.quiet.completed,1);
  assert.equal(summary.pollP95Ms,12);
});

test("load request cohort excludes drain starts but retains slow in-window failures", () => {
  const summary=summarizeLoadPhase({durationMs:1000,tenantKeys:[],completions:[],requests:[
    {kind:'poll',status:503,latencyMs:2000,startedAtMs:999,completedAtMs:2999},
    {kind:'poll',status:500,latencyMs:20,startedAtMs:1000,completedAtMs:1020}]});
  assert.equal(summary.totalRequests,1);
  assert.equal(summary.http5xx,1);
  assert.equal(summary.pollP95Ms,2000);
  assert.equal(summary.drainRequestCount,1);
});

test("quiet fairness fails on starvation, missing baseline, or excessive delay without aggregate masking", () => {
  const baseline={tenants:{a:{throughputPerSecond:10,queueToAckP95Ms:10},b:{throughputPerSecond:10,queueToAckP95Ms:10}}};
  const loaded={tenants:{a:{throughputPerSecond:9,queueToAckP95Ms:20},b:{throughputPerSecond:8.9,queueToAckP95Ms:20.1}}};
  assert.deepEqual(compareQuietTenants(baseline,loaded,['a','b']).map(x=>x.passed),[true,false]);
  assert.equal(compareQuietTenants({tenants:{}},loaded,['a'])[0].passed,false);
});

test("local load source rejects unbounded duration and duplicate tenant identities before Docker use", async () => {
  const { buildLocalLoadSource } = await import("../../../tests/d1/lib/m4-local-load-runtime.mjs");
  const worker={tenantKey:'quiet',orgId:'org',workerId:'worker',targetId:'target',rate:2,jobIds:['job'],session:'secret',privateKeyPem:'key',publicKeyDer:'pub'};
  assert.throws(()=>buildLocalLoadSource({durationMs:Infinity,workers:[worker]},''),/bounded/);
  assert.throws(()=>buildLocalLoadSource({durationMs:1000,workers:[worker,worker]},''),/duplicate/);
  for(const noisyStreams of [0,11,1.5,'1']) {
    assert.throws(()=>buildLocalLoadSource({durationMs:1000,workers:[worker],noisyStreams},''),/bounded/);
  }
  const source=buildLocalLoadSource({durationMs:1000,workers:[worker]},'// proof');
  assert.ok(source.includes('canonicalEventDigestInputV1'));
  assert.ok(source.includes('AbortSignal.timeout'));
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const harness = path.join(repoRoot, "tests", "d1", "lib", "e6f-harness.mjs");

/** Load the harness in a child process under `env` and report its binding. */
function binding(env) {
  const source = [
    `const m = await import(${JSON.stringify(new URL(`file://${harness.split(path.sep).join("/")}`).href)});`,
    `console.log(JSON.stringify({ argv: m.composeBaseArgs(), http: m.HTTP_SERVICE, composeFile: m.COMPOSE_FILE }));`,
  ].join("\n");
  const res = spawnSync(process.execPath, ["--input-type=module"], {
    input: source,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  assert.equal(res.status, 0, `child exited ${res.status}: ${res.stderr}`);
  const line = res.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  return JSON.parse(line);
}

const CLEAR = {
  AOA_E6F_COMPOSE_FILES: "",
  AOA_E6F_COMPOSE_PROJECT: "",
  AOA_E6F_COMPOSE_ENV_FILE: "",
  AOA_E6F_HTTP_SERVICE: "",
};

test("spine topology observation honors the same isolated stack binding as its HTTP clients", () => {
  const source = readFileSync(path.join(repoRoot, "tests/d1/m1-spine.test.mjs"), "utf8");
  const snippet = source.slice(source.indexOf("  const composeArgs ="), source.indexOf("  const rendered ="));
  const observeArgs = new Function("composeBaseArgs", "process", snippet + "\nreturn composeArgs;");
  const explicit = ["compose", "-p", "isolated", "--env-file", "local.env", "-f", "base.yml", "-f", "slot.json"];
  assert.deepEqual(observeArgs(() => [...explicit], { env: { AOA_E6F_COMPOSE_FILES: "base.yml;slot.json" } }), explicit);
  assert.deepEqual(observeArgs(() => ["compose", "-f", "base.yml"], { env: {} }),
    ["compose", "-f", "base.yml", "-f", "docker/d1/m1-spine.override.yml"]);
});

test("DEFAULT: with no override the binding is byte-for-byte the D1 lane's own argv", () => {
  const b = binding(CLEAR);
  assert.deepEqual(b.argv, ["compose", "-f", b.composeFile]);
  assert.ok(b.composeFile.endsWith("docker-compose.d1.yml"), `default compose file: ${b.composeFile}`);
  assert.equal(b.http, "test-runner");
});

test("OVERRIDE: the shipped-boot lane's project, two files and HTTP service all take effect", () => {
  const files = ["docker-compose.staging.yml", "docker/m1-boot/docker-compose.m1-boot.yml"];
  const b = binding({
    AOA_E6F_COMPOSE_FILES: files.join(path.delimiter),
    AOA_E6F_COMPOSE_PROJECT: "aoa-m1-boot",
    AOA_E6F_COMPOSE_ENV_FILE: "/tmp/m1/.env",
    AOA_E6F_HTTP_SERVICE: "control-plane",
  });
  assert.deepEqual(b.argv, [
    "compose", "-p", "aoa-m1-boot", "--env-file", "/tmp/m1/.env",
    "-f", "docker-compose.staging.yml",
    "-f", "docker/m1-boot/docker-compose.m1-boot.yml",
  ]);
  assert.equal(b.http, "control-plane");
  // The override must REPLACE the D1 file, never be appended beside it: addressing both stacks
  // at once would render services that are not running and fail for an unrelated reason.
  assert.ok(!b.argv.includes(b.composeFile), "the D1 compose file must not survive an override");
});

test("PARTIAL override: a project with no file list still addresses the default file", () => {
  const b = binding({ ...CLEAR, AOA_E6F_COMPOSE_PROJECT: "solo" });
  assert.deepEqual(b.argv, ["compose", "-p", "solo", "-f", b.composeFile]);
});

test("an env file with no project or file override still reaches the default file", () => {
  const b = binding({ ...CLEAR, AOA_E6F_COMPOSE_ENV_FILE: "/tmp/x.env" });
  assert.deepEqual(b.argv, ["compose", "--env-file", "/tmp/x.env", "-f", b.composeFile]);
});

test("BLANK and whitespace-only values are treated as absent, not as an empty file argument", () => {
  const b = binding({ AOA_E6F_COMPOSE_FILES: "  ", AOA_E6F_COMPOSE_PROJECT: " ", AOA_E6F_COMPOSE_ENV_FILE: " ", AOA_E6F_HTTP_SERVICE: "  " });
  assert.deepEqual(b.argv, ["compose", "-f", b.composeFile]);
  assert.equal(b.http, "test-runner");
});

test("the harness has NO remaining hardcoded compose-file argv", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(harness, "utf8");
  // The only surviving mention of the constant must be its declaration and the default inside
  // `composeBaseArgs()`; a `["compose", "-f", COMPOSE_FILE` argv anywhere else is a site the
  // refactor missed, and it would silently keep addressing the D1 stack.
  assert.equal(source.includes('"compose", "-f", COMPOSE_FILE'), false,
    "a compose call still hardcodes COMPOSE_FILE instead of spreading composeBaseArgs()");
  assert.equal(source.includes('dexecModule("test-runner"'), false,
    "an HTTP client still hardcodes the test-runner service instead of HTTP_SERVICE");
});

// Execute the ACK client emitted into each Docker runner. Only the external HTTP
// boundary and clock are replaced; request construction and Ed25519 signing run.
function ackClient(runner, replies, { remainingMs = 10_000 } = {}) {
  const source = readFileSync(harness, "utf8");
  const runnerSource = source.slice(source.indexOf(`export function ${runner}(`));
  const ackSource = runnerSource.slice(runnerSource.indexOf("async function ackOnce("),
    runnerSource.indexOf("const isNoWork ="));
  const snippet = source.slice(source.indexOf("const DEVICE_PROOF_SNIPPET = `") +
    "const DEVICE_PROOF_SNIPPET = `".length, source.indexOf("`;", source.indexOf("const DEVICE_PROOF_SNIPPET = `")));
  const signer = new Function("RESULT_MARKER", `return \`${snippet}\`;`)("unused")
    .replace(/^import .*;\r?\n/m, "");
  let clock = Date.parse("2026-10-05T00:00:00Z");
  const requests = [];
  const sleeps = [];
  const key = crypto.generateKeyPairSync("ed25519");
  const worker = {
    workerId: "00000000-0000-4000-8000-000000000001", session: "test-session",
    privateKeyPem: key.privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKeyDer: key.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    ackPrefix: "http://control-plane/api/worker-control/leases/", ackSuffix: "/ack",
  };
  const offer = { leaseId: "00000000-0000-4000-8000-000000000002", jobId: "job",
    attempt: 1, fenceToken: "fence", ackDeadline: new Date(clock + remainingMs).toISOString() };
  const Clock = class extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  };
  const send = async (url, options) => {
    requests.push({ url, ...options });
    const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
    return { status: reply.status, text: async () => JSON.stringify(reply.body) };
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const invoke = new AsyncFunction("P", "createHash", "createPrivateKey", "edSign", "randomUUID",
    "randomBytes", "Buffer", "URL", "Date", "fetch", "setTimeout", "worker", "offer",
    `${signer}\n${ackSource}\nreturn ackOnce(worker, offerOf({ status: 200,
      body: { outcome: "offer", body: { ...offer, job: { jobId: offer.jobId, attempt: offer.attempt } } } }));`);
  return { requests, sleeps, offer, key, run: () => invoke(worker, crypto.createHash, crypto.createPrivateKey,
    crypto.sign, crypto.randomUUID, crypto.randomBytes, Buffer, URL, Clock, send,
    (done, ms) => { sleeps.push(ms); clock += ms; done(); }, worker, offer) };
}

const unavailable = { status: 503, body: { code: "internal_unavailable", retryAfterMs: 1_000 } };
const acknowledged = { status: 200, body: { outcome: "acknowledged" } };

for (const runner of ["runLeaseRace", "runReplicaRace"]) {
  test(`${runner}: a transient ACK retries the same operation with fresh signed proof`, async () => {
    const client = ackClient(runner, [unavailable, acknowledged]);
    assert.equal((await client.run()).status, 200);
    assert.equal(client.requests.length, 2);
    assert.deepEqual(client.sleeps, [1_000]);
    const [first, second] = client.requests.map((r) => JSON.parse(r.body));
    assert.equal(first.idempotencyKey, second.idempotencyKey);
    assert.deepEqual(first.body, second.body);
    assert.notEqual(first.nonce, second.nonce);
    assert.notEqual(first.correlationId, second.correlationId);
    assert.notEqual(client.requests[0].headers["aoa-device-proof-id"],
      client.requests[1].headers["aoa-device-proof-id"]);
    for (const request of client.requests) {
      const headers = request.headers;
      const canonical = ["AOA-DEVICE-PROOF-V1", "POST", new URL(request.url).pathname,
        crypto.createHash("sha256").update(request.body).digest("hex"),
        headers["aoa-device-request-id"], headers["aoa-device-issued-at"],
        headers["aoa-device-proof-id"]].join("\n");
      assert.equal(crypto.verify(null, Buffer.from(canonical), client.key.publicKey,
        Buffer.from(headers["aoa-device-signature"], "base64url")), true);
    }
  });

  test(`${runner}: ACK backpressure exhausts a bounded number of attempts`, async () => {
    const client = ackClient(runner, [unavailable]);
    assert.equal((await client.run()).status, 503);
    assert.equal(client.requests.length, 4);
    assert.deepEqual(client.sleeps, [1_000, 1_000, 1_000]);
  });

  test(`${runner}: ACK never sleeps past its offered deadline or sends an expired retry`, async () => {
    const client = ackClient(runner, [unavailable, acknowledged], { remainingMs: 500 });
    assert.equal((await client.run()).status, 503);
    assert.equal(client.requests.length, 1);
    assert.deepEqual(client.sleeps, []);
  });

  test(`${runner}: unauthorized, stale fence and unknown failures are never retried`, async () => {
    for (const [status, code] of [[401, "unauthorized"], [409, "stale_fence"], [503, "unknown"]]) {
      const client = ackClient(runner, [{ status, body: { code, retryAfterMs: 1 } }, acknowledged]);
      assert.equal((await client.run()).status, status);
      assert.equal(client.requests.length, 1);
      assert.deepEqual(client.sleeps, []);
    }
  });

  test(`${runner}: throttled ACK retries and a zero hint cannot spin without waiting`, async () => {
    const client = ackClient(runner, [{ status: 429, body: { code: "throttled", retryAfterMs: 0 } }, acknowledged]);
    assert.equal((await client.run()).status, 200);
    assert.equal(client.requests.length, 2);
    assert.deepEqual(client.sleeps, [1]);
  });

  test(`${runner}: an absent or expired ACK deadline sends no request`, async () => {
    for (const ackDeadline of [undefined, "invalid", "2026-10-04T00:00:00Z"]) {
      const client = ackClient(runner, [acknowledged]);
      client.offer.ackDeadline = ackDeadline;
      await assert.rejects(client.run(), /unexpired offered ackDeadline/);
      assert.equal(client.requests.length, 0);
    }
  });

  test(`${runner}: malformed retry hints never trigger another ACK`, async () => {
    for (const retryAfterMs of [undefined, null, -1, 0.5, "1000", 30_000]) {
      const client = ackClient(runner, [{ status: 503,
        body: { code: "internal_unavailable", retryAfterMs } }, acknowledged]);
      assert.equal((await client.run()).status, 503);
      assert.equal(client.requests.length, 1);
      assert.deepEqual(client.sleeps, []);
    }
  });
}

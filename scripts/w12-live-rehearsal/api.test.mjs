import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const api = fileURLToPath(new URL("./api.mjs", import.meta.url));
const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  company: "33333333-3333-4333-8333-333333333333",
  agent: "44444444-4444-4444-8444-444444444444",
  approval: "55555555-5555-4555-8555-555555555555",
  openAiSecret: "66666666-6666-4666-8666-666666666666",
  e2bKey: "77777777-7777-4777-8777-777777777777",
  job: "88888888-8888-4888-8888-888888888888",
  output: "99999999-9999-4999-8999-999999999999",
  retiredTarget: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  successorTarget: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

test("explicit handoff phase sends only exact target IDs and preserves private target history", async () => {
  await privateFixture(async (dir) => {
    await writeFile(path.join(dir, "state.json"), JSON.stringify({ organizationId: ids.organization,
      targets: [{ id: ids.retiredTarget, slug: "aoa-canary-e2b" },
        { id: ids.successorTarget, slug: "w12-staging" }] }));
    await writeFile(path.join(dir, "session.cookie"), "better-auth.session_token=signed.mock\n");
    await mockApi(({ method, url, body }) => {
      assert.equal(method, "POST");
      assert.equal(url, `/api/organizations/${ids.organization}/execution-targets/${ids.retiredTarget}/successor`);
      assert.deepEqual(body, { successorTargetId: ids.successorTarget });
      return { body: { result: "handed_off", organizationId: ids.organization,
        retiredTargetId: ids.retiredTarget, successorTargetId: ids.successorTarget,
        retiredSlug: `retired-to-${ids.successorTarget}`, executionTargetSlug: "aoa-canary-e2b" } };
    }, async (origin, calls) => {
      const env = { W12_RETIRED_TARGET_ID: ids.retiredTarget, W12_SUCCESSOR_TARGET_ID: ids.successorTarget };
      const first = await runApi("handoff-target", dir, origin, env);
      assert.equal(first.code, 0, first.stderr);
      assert.equal(calls.length, 1);
      assert.deepEqual(JSON.parse(first.stdout), { phase: "handoff-target", result: "handed_off",
        retiredTargetId: ids.retiredTarget, successorTargetId: ids.successorTarget,
        retiredSlug: `retired-to-${ids.successorTarget}`, executionTargetSlug: "aoa-canary-e2b" });
      const state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
      assert.equal(state.targets[0].slug, `retired-to-${ids.successorTarget}`);
      assert.equal(state.targets[1].slug, "aoa-canary-e2b");
      const invalid = await runApi("handoff-target", dir, origin, { ...env, W12_SUCCESSOR_TARGET_ID: ids.retiredTarget });
      assert.equal(invalid.code, 1);
      assert.equal(calls.length, 1);
    });
  });
});

async function privateFixture(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "w12-api-mock-"));
  try {
    return await run(dir);
  } finally {
    const resolved = path.resolve(dir);
    const tempRoot = path.resolve(os.tmpdir());
    assert.ok(resolved.startsWith(`${tempRoot}${path.sep}`), "refuse cleanup outside temp root");
    await rm(resolved, { recursive: true, force: true });
  }
}

async function mockApi(handler, run) {
  const calls = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      const call = {
        method: req.method,
        url: req.url,
        cookie: req.headers.cookie ?? null,
        origin: req.headers.origin ?? null,
        authorization: req.headers.authorization ?? null,
        body: raw ? JSON.parse(raw) : null,
      };
      calls.push(call);
      // Exercise the Origin path required by board-mutation-guard.ts for this
      // cookie-based helper. The bearer-only test-session mint has no board cookie.
      if (call.cookie && !["GET", "HEAD", "OPTIONS"].includes(call.method) &&
          call.origin !== `http://${req.headers.host}`) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Board mutation requires trusted browser origin" }));
        return;
      }
      const answer = handler(call);
      res.writeHead(answer.status ?? 200, { "Content-Type": answer.bytes ? "application/octet-stream" : "application/json" });
      res.end(answer.bytes ?? JSON.stringify(answer.body));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "mock handler failed" }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`, calls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function runApi(phase, dir, origin, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [api, phase], {
      env: { ...process.env, W12_BASE_URL: origin, W12_PRIVATE_DIR: dir, ...extraEnv },
      timeout: 10_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("cloud-auth seed uses a governed hire and is idempotent", async () => {
  await privateFixture(async (dir) => {
    await writeFile(path.join(dir, "test-token"), "fake-test-support-token\n");
    let approvalStatus = "pending";
    await mockApi(({ method, url }) => {
      if (method === "POST" && url === "/api/test-support/session") return {
        body: { userId: ids.user, cookie: { name: "better-auth.session_token", value: "signed.mock" } },
      };
      if (method === "POST" && url === "/api/organizations") return { status: 201, body: { id: ids.organization } };
      if (method === "POST" && url === "/api/companies") return { status: 201, body: { id: ids.company } };
      if (method === "POST" && url === `/api/companies/${ids.company}/agent-hires`) return {
        status: 201,
        body: { agent: { id: ids.agent, status: "pending_approval" },
          approval: { id: ids.approval, status: "pending" } },
      };
      if (method === "GET" && url === `/api/approvals/${ids.approval}`) return {
        body: { id: ids.approval, status: approvalStatus },
      };
      if (method === "POST" && url === `/api/approvals/${ids.approval}/approve`) {
        approvalStatus = "approved";
        return { body: { id: ids.approval, status: approvalStatus } };
      }
      if (method === "GET" && url === `/api/agents/${ids.agent}`) return {
        body: { id: ids.agent, status: "idle" },
      };
      return { status: 404, body: { error: "unexpected mock route" } };
    }, async (origin, calls) => {
      const noOrigin = await fetch(`${origin}/api/organizations`, {
        method: "POST", headers: { Cookie: "better-auth.session_token=signed.mock", "Content-Type": "application/json" },
        body: JSON.stringify({ name: "refused" }),
      });
      assert.equal(noOrigin.status, 403, "mock must reject a cookie mutation without Origin");
      const env = { W12_TEST_SUPPORT_TOKEN_FILE: path.join(dir, "test-token") };
      const first = await runApi("seed-identity", dir, origin, env);
      assert.equal(first.code, 0, first.stderr);
      assert.equal(first.stderr, "");
      assert.deepEqual(JSON.parse(first.stdout), { phase: "seed-identity",
        organizationId: ids.organization, companyId: ids.company, agentId: ids.agent });
      const sessionMint = calls.find((call) => call.url === "/api/test-support/session");
      assert.equal(sessionMint.authorization, "Bearer fake-test-support-token");
      assert.equal(sessionMint.body.email.includes("@"), true);
      assert.equal(calls.filter((call) => call.url.endsWith("/agent-hires")).length, 1);
      assert.equal(calls.filter((call) => call.url.endsWith("/approve")).length, 1);
      const acceptedCookieMutations = calls.filter((call) => call.cookie && call.origin);
      assert.ok(acceptedCookieMutations.every((call) => call.cookie === "better-auth.session_token=signed.mock"));
      assert.ok(acceptedCookieMutations.every((call) => call.origin === origin));
      assert.ok(!first.stdout.includes("fake-test-support-token"));
      assert.ok(!first.stdout.includes("signed.mock"));

      const state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
      assert.equal(state.userId, ids.user);
      assert.equal(state.hireApprovalId, ids.approval);
      assert.equal(state.pendingAgent, undefined);
      assert.equal(await readFile(path.join(dir, "session.cookie"), "utf8"),
        "better-auth.session_token=signed.mock\n");

      const second = await runApi("seed-identity", dir, origin, env);
      assert.equal(second.code, 0, second.stderr);
      assert.equal(calls.filter((call) => call.url.endsWith("/agent-hires")).length, 1);
      assert.equal(calls.filter((call) => call.url.endsWith("/approve")).length, 1);

      const refreshed = await runApi("refresh-session", dir, origin, env);
      assert.equal(refreshed.code, 0, refreshed.stderr);
      assert.equal(JSON.parse(refreshed.stdout).userId, ids.user);
      assert.equal(calls.at(-1).body.email, state.testEmail);
    });
  });
});

test("company OpenAI and E2B keys stay out of public phase output", async () => {
  await privateFixture(async (dir) => {
    await writeFile(path.join(dir, "state.json"), JSON.stringify({
      userId: ids.user, organizationId: ids.organization, companyId: ids.company, agentId: ids.agent,
    }));
    await writeFile(path.join(dir, "session.cookie"), "better-auth.session_token=signed.mock\n");
    await writeFile(path.join(dir, "openai-key"), "fake-openai-secret\n");
    await writeFile(path.join(dir, "e2b-key"), "fake-e2b-secret\n");
    await mockApi(({ method, url }) => {
      if (method === "POST" && url === `/api/companies/${ids.company}/secrets`) return {
        status: 201, body: { id: ids.openAiSecret },
      };
      if (method === "POST" && url === `/api/companies/${ids.company}/runtime-provider-keys/with-secret`) return {
        status: 201, body: { id: ids.e2bKey },
      };
      return { status: 404, body: { error: "unexpected mock route" } };
    }, async (origin, calls) => {
      const env = { W12_OPENAI_KEY_FILE: path.join(dir, "openai-key"), W12_E2B_KEY_FILE: path.join(dir, "e2b-key") };
      const result = await runApi("seed", dir, origin, env);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(calls.length, 2);
      assert.equal(calls[0].body.name, "provider:openai");
      assert.equal(calls[0].body.provider, "local_encrypted");
      assert.equal(calls[0].body.value, "fake-openai-secret");
      assert.equal(calls[1].body.provider, "e2b");
      assert.equal(calls[1].body.value, "fake-e2b-secret");
      assert.ok(!result.stdout.includes("fake-openai-secret"));
      assert.ok(!result.stdout.includes("fake-e2b-secret"));
      assert.ok(!result.stdout.includes("signed.mock"));
      const state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
      assert.equal(state.userId, ids.user);
      assert.equal(state.openAiSecretId, ids.openAiSecret);
      assert.equal(state.e2bProviderKeyId, ids.e2bKey);

      const second = await runApi("seed", dir, origin, env);
      assert.equal(second.code, 0, second.stderr);
      assert.equal(calls.length, 2);
    });
  });
});

test("HTTP failures do not echo secret-bearing response bodies", async () => {
  await privateFixture(async (dir) => {
    await writeFile(path.join(dir, "state.json"), JSON.stringify({
      userId: ids.user, organizationId: ids.organization, companyId: ids.company, agentId: ids.agent,
    }));
    await writeFile(path.join(dir, "session.cookie"), "better-auth.session_token=signed.mock\n");
    await writeFile(path.join(dir, "openai-key"), "fake-openai-secret\n");
    await mockApi(() => ({ status: 500, body: { error: "fake-openai-secret signed.mock" } }), async (origin) => {
      const result = await runApi("seed", dir, origin, { W12_OPENAI_KEY_FILE: path.join(dir, "openai-key") });
      assert.equal(result.code, 1);
      assert.match(result.stderr, /w12-api: POST \/api\/companies\/[^ ]+\/secrets returned HTTP 500/);
      assert.ok(!`${result.stdout}${result.stderr}`.includes("fake-openai-secret"));
      assert.ok(!`${result.stdout}${result.stderr}`.includes("signed.mock"));
    });
  });
});

async function checkDownloadedBytes(expected, shouldMatch) {
  await privateFixture(async (dir) => {
    const content = Buffer.from("real governed output\n", "utf8");
    const digest = createHash("sha256").update(content).digest("hex");
    await writeFile(path.join(dir, "state.json"), JSON.stringify({
      organizationId: ids.organization, companyId: ids.company, currentJobId: ids.job,
    }));
    await writeFile(path.join(dir, "session.cookie"), "better-auth.session_token=signed.mock\n");
    const expectedFile = path.join(dir, "expected.bin");
    await writeFile(expectedFile, expected);
    await mockApi(({ method, url }) => {
      if (method === "GET" && url === `/api/organizations/${ids.organization}/companies/${ids.company}/jobs/${ids.job}`) {
        return { body: { job: { id: ids.job, status: "completed" }, artifacts: [{
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", outputId: ids.output,
          status: "committed", recoveryQuarantinedAt: null, sizeBytes: content.length, sha256: digest,
        }] } };
      }
      if (method === "GET" && url === `/api/task-outputs/${ids.output}/content`) return { bytes: content };
      return { status: 404, body: { error: "unexpected mock route" } };
    }, async (origin, calls) => {
      const result = await runApi("download", dir, origin, {
        W12_OUTPUT_ID: ids.output, W12_EXPECTED_OUTPUT_FILE: expectedFile,
      });
      assert.equal(calls.length, 2);
      assert.equal(result.code, shouldMatch ? 0 : 1, result.stderr);
      assert.deepEqual(await readFile(path.join(dir, `output-${ids.output}.bin`)), content);
      if (shouldMatch) {
        assert.deepEqual(JSON.parse(result.stdout), { phase: "download", outputId: ids.output,
          file: path.join(dir, `output-${ids.output}.bin`), sizeBytes: content.length,
          sha256: digest, exactMatch: true });
        assert.equal(result.stderr, "");
      } else {
        assert.equal(result.stdout, "", "a mismatch must not produce a success result");
        assert.match(result.stderr, /download differs from expected bytes/);
        assert.ok(!result.stderr.includes(content.toString("utf8")));
      }
    });
  });
}

test("committed output matching expected bytes succeeds", async () => {
  await checkDownloadedBytes(Buffer.from("real governed output\n"), true);
});

test("committed output differing from expected bytes fails nonzero", async () => {
  await checkDownloadedBytes(Buffer.from("different output\n"), false);
});

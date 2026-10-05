import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { observeComposeCleanup } from "../m1-cleanup-evidence.mjs";
import * as cleanup from "../m1-cleanup-evidence.mjs";

test("declared cleanup cancels each unfinished job once and preserves terminal jobs", async () => {
  assert.equal(typeof cleanup.cancelDeclaredJobs, "function");
  const calls = [];
  const result = await cleanup.cancelDeclaredJobs({ candidate, intents: [{ candidate, ...intent }],
    read: () => [{ ...binding, jobStatus: "running", attemptStatus: "failed" },
      { ...binding, jobStatus: "running", attemptId: "retry" }],
    cancel: async (job, options) => { calls.push({ job, options }); return { status: "queued" }; },
  });
  assert.equal(result.pass, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].job, { organizationId: intent.organizationId, companyId: intent.companyId, jobId: binding.jobId });
  assert.ok(calls[0].options.timeoutMs > 0 && calls[0].options.timeoutMs <= 30_000);
  const terminal = await cleanup.cancelDeclaredJobs({ candidate, intents: [{ candidate, ...intent }],
    read: () => [binding], cancel: async () => { throw new Error("terminal job must not change"); } });
  assert.equal(terminal.pass, true);
  assert.equal(terminal.requests.length, 0);
});

test("declared cleanup refuses foreign/missing bindings before any cancellation", async () => {
  assert.equal(typeof cleanup.cancelDeclaredJobs, "function");
  for (const rows of [[], [{ ...binding, companyId: "foreign", jobStatus: "queued" }],
    [{ ...binding, jobId: "foreign", jobStatus: "queued" }]]) {
    let calls = 0;
    const result = await cleanup.cancelDeclaredJobs({ candidate, intents: [{ candidate, ...intent }],
      read: () => rows, cancel: async () => { calls++; return { status: "cancelled" }; } });
    assert.equal(result.pass, false);
    assert.equal(calls, 0);
  }
});

test("declared cleanup fails closed on transport, rejected outcome, and exhausted deadline", async () => {
  assert.equal(typeof cleanup.cancelDeclaredJobs, "function");
  for (const cancel of [async () => { throw new Error("private credential"); },
    async () => ({ status: "not_found" }), async () => null]) {
    const result = await cleanup.cancelDeclaredJobs({ candidate, intents: [{ candidate, ...intent }],
      read: () => [{ ...binding, jobStatus: "queued" }], cancel });
    assert.equal(result.pass, false);
    assert.equal(JSON.stringify(result).includes("private credential"), false);
  }
  let time = 0;
  let calls = 0;
  const result = await cleanup.cancelDeclaredJobs({ candidate, intents: [{ candidate, ...intent }], timeoutMs: 100,
    now: () => time, read: () => { time = 101; return [{ ...binding, jobStatus: "queued" }]; },
    cancel: async () => { calls++; return { status: "cancelled" }; } });
  assert.equal(result.pass, false);
  assert.equal(calls, 0);
});

test("declared cleanup aborts a stalled request at its finite deadline", async () => {
  let signal;
  const result = await cleanup.cancelDeclaredJobs({ candidate, intents: [{ candidate, ...intent }], timeoutMs: 20,
    read: () => [{ ...binding, jobStatus: "queued" }], cancel: (_job, options) => {
      signal = options.signal;
      return new Promise(() => {});
    } });
  assert.equal(result.pass, false);
  assert.equal(signal.aborted, true);
  assert.ok(result.violations.includes("cancellation_request_failed"));
});

test("declared cleanup bounds inventory cardinality and checks task-run identity", async () => {
  let called = false;
  const journey = { candidate, ...intent, kind: "journey", issueTitle: "unique task" };
  for (const rows of [Array(513).fill(binding), [{ ...binding, jobStatus: "queued", sourceIdentity: "run-a", sourceRunId: "run-b" }]]) {
    const result = await cleanup.cancelDeclaredJobs({ candidate, intents: [journey], read: () => rows,
      cancel: async () => { called = true; return { status: "cancelled" }; } });
    assert.equal(result.pass, false);
  }
  assert.equal(called, false);
});

// Run the real phase entry point, replacing only Docker at the process boundary.
function runPhase({ downStatus = 0, downThrows = false, kind = null, listStatus = 0, remaining = "", phase = "teardown", scan = null, mode = "keyless", inventoryWriteFails = false, stopStatus = 0, intents = [], inventoryRows = [], inventoryRowsSequence = null, providerMode = "closed", cancellationStatus = 202 } = {}) {
  const out = mkdtempSync(path.join(os.tmpdir(), "m1-cleanup-"));
  const envFile = path.join(out, "compose.env");
  const secret = "cleanup-disposable-secret-123456";
  mkdirSync(path.join(out, "keys"));
  writeFileSync(path.join(out, "keys", "key"), secret);
  writeFileSync(envFile, secret);
  if (intents.length) writeFileSync(path.join(out, "resource-intents.jsonl"), intents.map((value) => JSON.stringify(value) + "\n").join(""));
  writeFileSync(path.join(out, "state.json"), JSON.stringify({
    out, envFile, candidate: "a".repeat(40), mode, redact: [secret], secrets: { fixture: secret },
    tenants: {
      a: { role: "enabled", organizationId: "org-a", companyId: "company-a", targetId: "target-a", worker: "m1-worker-a" },
      b: { role: "enabled", organizationId: "org-b", companyId: "company-b", targetId: "target-b", worker: "m1-worker-b" },
    },
  }));
  const callsPath = path.join(out, "calls.jsonl");
  const preload = `
    import cp from 'node:child_process';
    import fs from 'node:fs';
    import { appendFileSync, readFileSync } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const write = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => {
      if (${inventoryWriteFails} && String(file).endsWith('provider-resource-inventory.json')) throw new Error('disk full');
      return write(file, ...args);
    };
    let inventoryReadCount = 0;
    let workersStopped = false;
    const inventorySnapshots = ${JSON.stringify(inventoryRowsSequence ?? [inventoryRows])};
    cp.spawnSync = (command, args, options) => {
      if (command !== 'docker') throw new Error('unexpected command');
      appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');
      if (args.includes('stop')) { workersStopped = true; return { status: ${JSON.stringify(stopStatus)}, stdout: '', stderr: '' }; }
      if (options?.input?.includes('FROM jobs j')) {
        appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify([workersStopped ? 'inventory-read' : 'cancellation-preflight-read']) + '\\n');
        const rows = inventorySnapshots[workersStopped ? Math.min(inventoryReadCount++, inventorySnapshots.length - 1) : 0];
        return { status: 0, stderr: '', stdout: '__M1_RESULT__' + JSON.stringify({ ok: true, rows }) };
      }
      if (options?.input?.includes('FROM execution_targets')) return {
        status: 0, stderr: '', stdout: '__M1_RESULT__' + JSON.stringify({ ok: true, rows: [{
          organizationId: 'org-a', profileHash: 'a'.repeat(64), providerDigest: 'b'.repeat(64), generation: 1,
        }] }),
      };
      if (options?.input?.includes('INSERT INTO')) {
        const records = readFileSync(${JSON.stringify(path.join(out, "resource-intents.jsonl"))}, 'utf8').trim().split('\\n').map(JSON.parse);
        appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(['intent-at-seed', records.length]) + '\\n');
        return { status: 1, stdout: '__E6F_RESULT__{"ok":false}', stderr: '' };
      }
      if (args.includes('down')) {
        if (${downThrows}) throw new Error(${JSON.stringify(secret)});
        return { status: ${JSON.stringify(downStatus)}, stdout: ${JSON.stringify(secret)}, stderr: '' };
      }
      const selected = args[0] === ${JSON.stringify(kind)};
      return { status: selected ? ${JSON.stringify(listStatus)} : 0, stdout: selected ? ${JSON.stringify(remaining)} : '', stderr: '' };
    };
    syncBuiltinESMExports();
    globalThis.fetch = (url, options) => {
      const parsed = new URL(url);
      if (parsed.origin === 'https://api.e2b.app') {
        appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(['provider', parsed.pathname, options.method]) + '\\n');
        if (${JSON.stringify(providerMode)} === 'error') throw new Error('inert-offline-key');
        const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
        if (parsed.pathname === '/v2/sandboxes') return response(${JSON.stringify(providerMode)} === 'present'
          ? [{ sandboxID: 'abcdefghijklmnop', state: 'paused' }] : []);
        if (parsed.pathname.startsWith('/events/sandboxes/')) return response(['created', 'killed'].map((type, index) => ({
          id: 'event-' + index, version: 'v2', type: 'sandbox.lifecycle.' + type,
          timestamp: '2026-09-29T00:0' + (index + 1) + ':00.000Z', sandboxId: 'abcdefghijklmnop',
          sandboxTeamId: 'team-a', sandboxExecutionId: 'execution-a', sandboxTemplateId: 'template-a', sandboxBuildId: 'build-a',
        })));
        return response({}, 404);
      }
      if (parsed.pathname.endsWith('/cancel')) {
        appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(['cancel-job', parsed.pathname, JSON.parse(options.body)]) + '\\n');
        return new Response(JSON.stringify({ status: 'queued' }), { status: ${cancellationStatus} });
      }
      const records = readFileSync(${JSON.stringify(path.join(out, "resource-intents.jsonl"))}, 'utf8').trim().split('\\n').map(JSON.parse);
      appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(['intent-at-dispatch', records.length]) + '\\n');
      throw new Error('network forbidden in phase fixture');
    };
  `;
  try {
    const result = spawnSync(process.execPath, [
      "--import", `data:text/javascript,${encodeURIComponent(preload)}`,
      "scripts/m1-shipped-boot/journey.mjs", phase, "--out", out,
    ], { encoding: "utf8", env: { ...process.env, AOA_M1_SECRET_OWNER: "", E2B_API_KEY: "inert-offline-key" }, timeout: 15_000 });
    const reportPath = path.join(out, "evidence", "compose-cleanup.json");
    const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : null;
    let scanResult = null;
    if (scan) {
      writeFileSync(path.join(out, "job-log.txt"), scan === "log-leak" ? secret : "clean captured teardown\n");
      if (scan === "report-leak") writeFileSync(reportPath, JSON.stringify({ ...report, late: secret }));
      scanResult = spawnSync(process.execPath, ["scripts/m1-shipped-boot/journey.mjs", "leak-scan", "--out", out], {
        encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true" }, timeout: 15_000,
      });
    }
    return {
      ...result,
      report, scanResult,
      providerReport: existsSync(path.join(out, "evidence", "provider-cleanup.json"))
        ? JSON.parse(readFileSync(path.join(out, "evidence", "provider-cleanup.json"), "utf8")) : null,
      intents: existsSync(path.join(out, "resource-intents.jsonl"))
        ? readFileSync(path.join(out, "resource-intents.jsonl"), "utf8").trim().split("\n").map(JSON.parse) : [],
      evidenceRetained: existsSync(reportPath),
      calls: existsSync(callsPath) ? readFileSync(callsPath, "utf8").trim().split("\n").map(JSON.parse) : [],
      stateRetained: existsSync(path.join(out, "state.json")),
      envRetained: existsSync(envFile), keysRetained: existsSync(path.join(out, "keys")), secret,
    };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

test("the real dispatch phase retains an intent when the issue creation response is lost", () => {
  const result = runPhase({ mode: "keyed", phase: "dispatch" });
  assert.equal(result.status, 1);
  assert.equal(result.intents.length, 1, result.stderr);
  assert.equal(result.intents[0].kind, "journey");
  assert.equal(result.intents[0].tenant, "a");
  assert.ok(result.intents[0].issueTitle.includes("DEP-015"));
  assert.ok(result.calls.some((call) => call[0] === "intent-at-dispatch" && call[1] === 1));
});

test("the real redaction phase retains its first arm intent when seeding fails", () => {
  const result = runPhase({ mode: "keyed", phase: "redaction" });
  assert.equal(result.status, 1);
  assert.equal(result.intents.length, 1, result.stderr);
  assert.equal(result.intents[0].kind, "redaction");
  assert.ok(result.intents[0].jobId);
  assert.ok(result.intents[0].attemptId);
  assert.equal(result.intents[0].tenant, "a");
  assert.ok(result.calls.some((call) => call[0] === "intent-at-seed" && call[1] === 1));
});

test("keyed teardown without a durable resource inventory refuses provider success but still removes Compose", () => {
  const result = runPhase({ mode: "keyed" });
  assert.equal(result.status, 1);
  assert.equal(result.report.pass, true);
  assert.equal(result.providerReport?.pass, false);
  assert.ok(result.providerReport.violations.includes("inventory_unavailable"));
  assert.ok(result.calls.some((args) => args.includes("down")));
  assert.equal(result.stateRetained, true);
});

test("an inventory evidence write failure cannot prevent the remaining Compose cleanup", () => {
  const result = runPhase({ mode: "keyed", inventoryWriteFails: true });
  assert.equal(result.status, 1);
  assert.ok(result.calls.some((args) => args.includes("down")));
  assert.equal(result.report.pass, true);
});

const candidate = "a".repeat(40);
const intent = {
  id: "intent-1", kind: "redaction", tenant: "a", companyId: "company-a",
  organizationId: "org-a", targetId: "target-a", worker: "m1-worker-a", jobId: "job-a", attemptId: "attempt-a",
};
const binding = {
  organizationId: "org-a", companyId: "company-a", targetId: "target-a", jobId: "job-a",
  jobStatus: "succeeded", attemptId: "attempt-a", attemptStatus: "succeeded",
  leaseId: "lease-a", leaseStatus: "released", sandboxId: "abcdefghijklmnop",
  leaseCreatedAt: "2026-09-29T00:00:00.000Z",
};

test("cleanup inventories all declared jobs with their tenant and lease, not just the successful journey", () => {
  assert.equal(typeof cleanup.collectProviderInventory, "function");
  const result = cleanup.collectProviderInventory({ candidate, intents: [{ candidate, ...intent }], read: () => [binding] });
  assert.equal(result.complete, true);
  assert.deepEqual(result.resources, [{ ...binding, intentId: "intent-1", tenant: "a", worker: "m1-worker-a" }]);
});

test("inventory accounts for a proven cancelled unleased retry without fabricating a sandbox", () => {
  const declared = { candidate, ...intent, kind: "journey", issueTitle: "unique useful work", jobId: undefined, attemptId: undefined };
  const prior = { ...binding, sourceIdentity: "run-1", sourceRunId: "run-1", jobStatus: "cancelled",
    attemptStatus: "failed", leaseStatus: "expired", attemptNumber: 1 };
  const retry = { ...prior, attemptId: "attempt-2", attemptNumber: 2, attemptStatus: "cancelled",
    leaseId: null, leaseStatus: null, targetId: null, leaseCreatedAt: null, sandboxId: null,
    attemptLeaseCount: 0, attemptStartedEventCount: 0 };
  const result = cleanup.collectProviderInventory({ candidate, intents: [declared], read: () => [prior, retry] });
  assert.equal(result.complete, true);
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].sandboxId, binding.sandboxId);
  assert.deepEqual(result.unleasedRetries, [{ intentId: intent.id, organizationId: binding.organizationId,
    companyId: binding.companyId, jobId: binding.jobId, attemptId: "attempt-2", attemptNumber: 2,
    disposition: "cancelled_without_lease_or_start" }]);
  for (const bad of [{ attemptLeaseCount: undefined }, { attemptLeaseCount: 1 }, { attemptStartedEventCount: 1 },
    { attemptStatus: "pending" }, { jobStatus: "queued" }, { attemptNumber: 1 }, { sandboxId: "abcdefghijklmnop" }]) {
    const negative = cleanup.collectProviderInventory({ candidate, intents: [declared], read: () => [prior, { ...retry, ...bad }] });
    assert.equal(negative.complete, false, JSON.stringify(bad));
  }
  assert.equal(cleanup.collectProviderInventory({ candidate, intents: [declared], read: () => [retry] }).complete, false);
});

for (const [name, rows] of [
  ["no job after an uncertain seed", []],
  ["missing sandbox after lease activation", [{ ...binding, sandboxId: null }]],
  ["wrong tenant", [{ ...binding, companyId: "company-b" }]],
  ["wrong target", [{ ...binding, targetId: "target-b" }]],
  ["wrong job", [{ ...binding, jobId: "job-b" }]],
  ["wrong attempt", [{ ...binding, attemptId: "attempt-b" }]],
  ["missing lease", [{ ...binding, leaseId: null }]],
  ["still active lease", [{ ...binding, leaseStatus: "active" }]],
  ["still running job", [{ ...binding, jobStatus: "running" }]],
  ["fake sandbox", [{ ...binding, sandboxId: "fake-provider" }]],
  ["missing lease lifecycle window", [{ ...binding, leaseCreatedAt: null }]],
  ["malformed lifecycle window", [{ ...binding, leaseCreatedAt: "yesterday" }]],
  ["future lifecycle window", [{ ...binding, leaseCreatedAt: "2099-01-01T00:00:00.000Z" }]],
  ["same sandbox on another lease", [binding, { ...binding, leaseId: "lease-b" }]],
]) {
  test(`provider inventory refuses ${name}`, () => {
    assert.equal(typeof cleanup.collectProviderInventory, "function");
    const result = cleanup.collectProviderInventory({ candidate, intents: [{ candidate, ...intent }], read: () => rows });
    assert.equal(result.complete, false);
    assert.ok(result.violations.length > 0);
  });
}

test("inventory reads remaining intents after one fails and does not retain raw diagnostics", () => {
  assert.equal(typeof cleanup.collectProviderInventory, "function");
  const readIds = [];
  const result = cleanup.collectProviderInventory({ candidate,
    intents: [{ candidate, ...intent }, { candidate, ...intent, id: "intent-2", jobId: "job-b" }],
    read: (entry) => { readIds.push(entry.id); if (entry.id === "intent-1") throw new Error("private-secret"); return [{ ...binding, jobId: "job-b" }]; },
  });
  assert.equal(result.complete, false);
  assert.deepEqual(readIds, ["intent-1", "intent-2"]);
  assert.equal(JSON.stringify(result).includes("private-secret"), false);
});

test("inventory collection stops at its shared deadline and leaves unobserved jobs incomplete", () => {
  let clock = 0;
  let reads = 0;
  const result = cleanup.collectProviderInventory({ candidate, deadlineMs: 50, now: () => clock,
    intents: [{ candidate, ...intent }, { candidate, ...intent, id: "intent-2" }],
    read: () => { reads++; clock = 51; return [binding]; },
  });
  assert.equal(reads, 1);
  assert.equal(result.complete, false);
  assert.ok(result.violations.some((value) => value.includes("deadline")));
});

test("write-ahead intents survive a subsequent failure and reject candidate substitution or truncated records", () => {
  assert.equal(typeof cleanup.recordResourceIntent, "function");
  const out = mkdtempSync(path.join(os.tmpdir(), "m1-intents-"));
  try {
    cleanup.recordResourceIntent({ out, candidate, intent });
    assert.deepEqual(cleanup.readResourceIntents({ out, candidate }), { intents: [{ candidate, expectedDistributedJobs: "present", ...intent }], violations: [] });
    assert.equal(cleanup.readResourceIntents({ out, candidate: "b".repeat(40) }).intents.length, 0);
    writeFileSync(path.join(out, "resource-intents.jsonl"), `${JSON.stringify({ candidate, ...intent })}\n{"partial":`);
    const recovered = cleanup.readResourceIntents({ out, candidate });
    assert.equal(recovered.intents.length, 1);
    assert.ok(recovered.violations.includes("intent_journal_truncated"));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("explicit no-job control accepts a successful empty read but enabled journeys do not", () => {
  const control = { candidate, ...intent, kind: "journey", issueTitle: "control", expectedDistributedJobs: "none" };
  assert.equal(cleanup.collectProviderInventory({ candidate, intents: [control], read: () => [] }).complete, true);
  assert.equal(cleanup.collectProviderInventory({ candidate, intents: [{ ...control, expectedDistributedJobs: "present" }], read: () => [] }).complete, false);
  assert.equal(cleanup.collectProviderInventory({ candidate, intents: [control], read: () => { throw new Error("private"); } }).complete, false);
});

for (const rows of [[{ ...binding, sourceIdentity: "run-a", sourceRunId: "run-a" }], [{ ...binding, sandboxId: null }]]) {
  test(`an unexpected control job refuses success and retains any observed sandbox (${rows[0].sandboxId})`, () => {
    const control = { candidate, ...intent, kind: "journey", issueTitle: "control", expectedDistributedJobs: "none" };
    const result = cleanup.collectProviderInventory({ candidate, intents: [control], read: () => rows });
    assert.equal(result.complete, false);
    assert.ok(result.violations.includes("intent-1:unexpected_control_job"));
    assert.equal(result.resources.length, rows[0].sandboxId ? 1 : 0);
  });
}

test("journey source identity inconsistencies cannot hide behind an otherwise complete sandbox binding", () => {
  const journey = { candidate, ...intent, kind: "journey", issueTitle: "journey" };
  assert.equal(cleanup.collectProviderInventory({ candidate, intents: [journey], read: () => [{
    ...binding, sourceIdentity: "run-a", sourceRunId: "run-b",
  }] }).complete, false);
});

test("keyed teardown stops workers before the final database snapshot, then downs Compose", () => {
  const result = runPhase({ mode: "keyed", intents: [{ candidate, ...intent }], inventoryRows: [binding] });
  const stop = result.calls.findIndex((args) => args.includes("stop"));
  const read = result.calls.findIndex((args) => args[0] === "inventory-read");
  const down = result.calls.findIndex((args) => args.includes("down"));
  assert.ok(stop >= 0 && stop < read && read < down, JSON.stringify(result.calls));
  assert.ok(result.calls.findIndex((args) => args[0] === "cancellation-preflight-read") < stop);
  assert.ok(result.calls[stop].includes("m1-worker-a"));
  assert.ok(result.calls[stop].includes("m1-worker-b"));
  assert.ok(result.calls[stop].includes("m1-worker-c"));
  assert.equal(result.calls[stop].includes("adapter-manager"), false, "adapter must remain available during graceful worker cleanup");
});

test("real teardown cancels declared unfinished jobs before stop and preserves failed cancellation", () => {
  for (const cancellationStatus of [202, 503]) {
    const result = runPhase({ mode: "keyed", intents: [{ candidate, ...intent }], cancellationStatus,
      inventoryRowsSequence: [[{ ...binding, jobStatus: "running", attemptStatus: "failed" }], [binding]] });
    const cancel = result.calls.findIndex((args) => args[0] === "cancel-job");
    const stop = result.calls.findIndex((args) => args.includes("stop"));
    const down = result.calls.findIndex((args) => args.includes("down"));
    assert.ok(cancel >= 0 && cancel < stop && stop < down);
    assert.deepEqual(result.calls[cancel][2], { reason: "shipped-boot teardown", graceful: true });
    assert.equal(result.providerReport.pass, cancellationStatus === 202);
    assert.equal(result.status, cancellationStatus === 202 ? 0 : 1, result.stderr);
  }
});

test("inventory settlement waits for the normal job and lease transition", async () => {
  let time = 0;
  let reads = 0;
  const deadlines = [];
  const result = await cleanup.awaitProviderInventory({
    timeoutMs: 10, pollMs: 5, now: () => time, sleep: async (ms) => { time += ms; },
    collect: ({ deadlineMs }) => {
      deadlines.push(deadlineMs);
      const pending = ++reads === 1;
      return { resources: [{ ...binding, jobStatus: pending ? "running" : "succeeded", leaseStatus: pending ? "active" : "expired" }],
        complete: !pending, violations: pending ? ["intent-1:execution_not_terminal"] : [] };
    },
  });
  assert.equal(result.complete, true);
  assert.equal(reads, 2);
  assert.deepEqual(deadlines, [10, 5]);
  assert.equal(result.resources[0].leaseStatus, "expired");
});

test("real teardown preserves the database until a terminal attempt's job and lease settle", () => {
  const result = runPhase({ mode: "keyed", intents: [{ candidate, ...intent }],
    inventoryRowsSequence: [[{ ...binding, jobStatus: "running", leaseStatus: "active" }], [binding]] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.providerReport.pass, true);
  const reads = result.calls.flatMap((args, index) => args[0] === "inventory-read" ? [index] : []);
  assert.equal(reads.length, 2);
  assert.ok(result.calls.findIndex((args) => args.includes("stop")) < reads[0]);
  assert.ok(reads[1] < result.calls.findIndex((args) => args.includes("down")));
});

test("inventory settlement stays failed at its deadline and retains observed resources", async () => {
  let time = 0;
  const result = await cleanup.awaitProviderInventory({
    timeoutMs: 10, pollMs: 5, now: () => time, sleep: async (ms) => { time += ms; },
    collect: () => ({ resources: [binding], complete: false, violations: ["intent-1:execution_not_terminal"] }),
  });
  assert.equal(result.complete, false);
  assert.equal(time, 10);
  assert.deepEqual(result.violations, ["intent-1:execution_not_terminal", "inventory_settlement_deadline"]);
  assert.deepEqual(result.resources, [binding]);
});

test("inventory settlement refuses other errors immediately without losing earlier bindings", async () => {
  let reads = 0;
  let sleeps = 0;
  const result = await cleanup.awaitProviderInventory({
    now: () => 0, sleep: async () => { sleeps++; },
    collect: () => ++reads === 1
      ? { resources: [binding], complete: false, violations: ["intent-1:execution_not_terminal"] }
      : { resources: [], complete: false, violations: ["intent-1:inventory_read_failed"] },
  });
  assert.equal(sleeps, 1);
  assert.equal(result.complete, false);
  assert.deepEqual(result.resources, [binding]);
  assert.deepEqual(result.violations, ["intent-1:inventory_read_failed"]);
});

test("inventory settlement cannot pass on a late response or a disappeared binding", async () => {
  let time = 0;
  const late = await cleanup.awaitProviderInventory({
    timeoutMs: 10, pollMs: 5, now: () => time,
    collect: () => { time = 11; return { resources: [binding], complete: true, violations: [] }; },
  });
  assert.equal(late.complete, false);
  assert.ok(late.violations.includes("inventory_settlement_deadline"));
  let reads = 0;
  const missing = await cleanup.awaitProviderInventory({
    now: () => 0, sleep: async () => {},
    collect: () => ++reads === 1
      ? { resources: [binding], complete: false, violations: ["intent-1:execution_not_terminal"] }
      : { resources: [], complete: true, violations: [] },
  });
  assert.equal(missing.complete, false);
  assert.deepEqual(missing.resources, [binding]);
  assert.ok(missing.violations.includes("inventory_resource_disappeared"));
});

test("a failed worker stop cannot skip Compose down or certify a final inventory", () => {
  const result = runPhase({ mode: "keyed", stopStatus: 1, intents: [{ candidate, ...intent }], inventoryRows: [binding] });
  assert.equal(result.status, 1);
  assert.ok(result.calls.some((args) => args.includes("down")));
  assert.equal(result.providerReport?.inventory.complete, false);
  assert.ok(result.providerReport?.violations.includes("worker_stop_failed"));
});

test("the real keyed teardown passes only with complete bindings, terminal lifecycle evidence, and empty readback", () => {
  const result = runPhase({ mode: "keyed", intents: [{ candidate, ...intent }], inventoryRows: [binding] });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.providerReport?.pass, true);
  assert.equal(result.providerReport?.observation.observations[0].status, "absent");
  const calls = result.calls.filter((args) => args[0] === "provider");
  assert.ok(calls.length >= 3);
  assert.ok(calls.every((args) => args[2] === "GET"));
  assert.ok(result.calls.findIndex((args) => args.includes("down")) < result.calls.findIndex((args) => args[0] === "provider"));
});

for (const providerMode of ["present", "error"]) {
  test(`the real keyed teardown refuses provider ${providerMode} despite successful Compose cleanup`, () => {
    const result = runPhase({ mode: "keyed", intents: [{ candidate, ...intent }], inventoryRows: [binding], providerMode });
    assert.equal(result.status, 1);
    assert.equal(result.report.pass, true);
    assert.equal(result.providerReport?.pass, false);
    assert.equal(result.providerReport?.observation.pass, false);
    assert.equal(JSON.stringify(result.providerReport).includes("inert-offline-key"), false);
  });
}

test("valid provider evidence cannot mask failed Compose removal", () => {
  const result = runPhase({ mode: "keyed", downStatus: 1, intents: [{ candidate, ...intent }], inventoryRows: [binding] });
  assert.equal(result.status, 1);
  assert.equal(result.providerReport?.pass, false);
});

test("teardown retains a candidate-bound Compose-only result and scanner state", () => {
  const result = runPhase();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report?.pass, true);
  assert.equal(result.report.candidate, "a".repeat(40));
  assert.equal(result.report.scope, "compose-project-only");
  assert.equal(result.report.project, "aoa-m1-boot");
  assert.equal(result.report.providerCleanup, "not-assessed");
  assert.equal(result.stateRetained, true);
  assert.equal(result.envRetained, true);
  assert.equal(result.keysRetained, true);
  assert.equal(JSON.stringify(result.report).includes(result.secret), false);
  assert.equal(result.stdout.includes(result.secret), false);
  assert.equal(result.stderr.includes(result.secret), false);
  for (const kind of ["container", "network", "volume"]) {
    const query = result.calls.find((args) => args[0] === kind);
    assert.ok(query, kind);
    assert.ok(query.includes("label=com.docker.compose.project=aoa-m1-boot"));
    if (kind === "container") assert.ok(query.includes("--all"));
  }
});

for (const downStatus of [1, null]) {
  test(`teardown refuses down status ${downStatus} even when the final inventory is empty`, () => {
    const result = runPhase({ downStatus });
    assert.notEqual(result.status, 0);
    assert.equal(result.report?.pass, false);
    assert.equal(result.report.down.status, downStatus);
    assert.equal(result.stateRetained, true);
    assert.doesNotMatch(result.stdout, /stack removed/);
    assert.equal(result.calls.filter((args) => args.includes("ls")).length, 3);
  });
}

test("a thrown down error still observes all resource kinds without publishing the error value", () => {
  const result = runPhase({ downThrows: true });
  assert.notEqual(result.status, 0);
  assert.equal(result.report?.pass, false);
  assert.equal(result.calls.filter((args) => args.includes("ls")).length, 3);
  assert.equal(result.stderr.includes(result.secret), false);
  assert.equal(result.stateRetained, true);
});

for (const kind of ["container", "network", "volume"]) {
  test(`teardown refuses a remaining owned ${kind}`, () => {
    const result = runPhase({ kind, remaining: "still-present\n" });
    assert.notEqual(result.status, 0);
    assert.equal(result.report?.pass, false);
    assert.deepEqual(result.report.observations[kind].remaining, ["still-present"]);
  });
  for (const listStatus of [1, null]) {
    test(`empty ${kind} output with status ${listStatus} is unknown, not proof of absence`, () => {
      const result = runPhase({ kind, listStatus });
      assert.notEqual(result.status, 0);
      assert.equal(result.report?.pass, false);
      assert.equal(result.report.observations[kind].status, listStatus);
    });
  }
}

test("purge-secrets is separate from teardown and never operates Docker", () => {
  const result = runPhase({ phase: "purge-secrets" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stateRetained, false);
  assert.equal(result.envRetained, false);
  assert.equal(result.keysRetained, false);
  assert.deepEqual(result.calls, []);
});

for (const scan of ["report-leak", "log-leak"]) {
  test(`the post-teardown scanner still rejects a late ${scan}`, () => {
    const result = runPhase({ scan });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.scanResult.status, 1);
    assert.match(result.scanResult.stderr, /contains job secret 'fixture'/);
    assert.equal(result.scanResult.stderr.includes(result.secret), false);
    assert.equal(result.evidenceRetained, false);
  });
}

test("a failed cleanup with complete safe evidence can still pass the upload leak scan", () => {
  const result = runPhase({ downStatus: 1, scan: "clean" });
  assert.equal(result.status, 1);
  assert.equal(result.report.pass, false);
  assert.equal(result.scanResult.status, 0, result.scanResult.stderr);
  assert.equal(result.evidenceRetained, true);
});

for (const bad of [
  { status: 0, stdout: null },
  { status: 0, stdout: "", error: new Error("private diagnostic") },
  { status: 0, stdout: "", signal: "SIGTERM" },
  null,
]) {
  test(`inventory must be complete, not merely empty: ${JSON.stringify(bad)}`, () => {
    const kinds = [];
    const report = observeComposeCleanup({
      candidate: "a".repeat(40), project: "aoa-m1-boot", down: () => ({ status: 0 }),
      inspect: (kind) => { kinds.push(kind); return kind === "container" ? bad : { status: 0, stdout: "" }; },
    });
    assert.equal(report.pass, false);
    assert.ok(report.violations.includes("container_inventory_unknown"));
    assert.deepEqual(kinds, ["container", "network", "volume"]);
    assert.equal(JSON.stringify(report).includes("private diagnostic"), false);
  });
}

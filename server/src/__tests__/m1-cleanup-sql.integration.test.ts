import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import postgres from "postgres";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";
import { setupJobControlFixture, auth, pollRequest, ackRequest, ORG, COMPANY, TARGET, type JobControlFixture } from "./helpers/job-control-fixture.js";
import { createJobLeasingService } from "../services/job-leasing.js";
import { createJobReconciliationService } from "../services/job-reconciliation.js";
import { runInTenant } from "../db/tenant-context.js";

const integration = describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1");
const id = (n: number) => `a6000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = id(1), company = id(2), target = id(3), issue = id(4);
type Row = Record<string, unknown>;
const tables = {
  jobs: "id uuid, organization_id uuid, company_id uuid, status text, source_kind text, source_identity text, source_intent jsonb",
  job_attempts: "id uuid, job_id uuid, organization_id uuid, company_id uuid, status text, attempt_number int",
  leases: "id uuid, attempt_id uuid, job_id uuid, organization_id uuid, company_id uuid, status text, target_id uuid, created_at timestamptz",
  job_events: "job_id uuid, attempt_id uuid, lease_id uuid, organization_id uuid, company_id uuid, event_type text, event jsonb",
  issues: "id uuid, company_id uuid, title text",
  heartbeat_runs: "company_id uuid, distributed_job_id uuid, context_snapshot jsonb",
};

function fixture(): Record<string, Row[]> {
  const rows: Record<string, Row[]> = {
    jobs: [], job_attempts: [], leases: [], job_events: [],
    issues: [{ id: issue, company_id: company, title: "proof" }],
    heartbeat_runs: [{ company_id: company, distributed_job_id: id(10), context_snapshot: { issueId: issue } }],
  };
  for (const n of [10, 20]) {
    rows.jobs.push({ id: id(n), organization_id: org, company_id: company, status: "succeeded", source_kind: "task_run",
      source_identity: id(n + 3), source_intent: { issueId: issue, runId: id(n + 3) } });
    rows.job_attempts.push({ id: id(n + 1), job_id: id(n), organization_id: org, company_id: company, status: "succeeded", attempt_number: 1 });
    rows.leases.push({ id: id(n + 2), attempt_id: id(n + 1), job_id: id(n), organization_id: org, company_id: company,
      status: "released", target_id: target, created_at: "2026-09-29T00:00:00Z" });
    rows.job_events.push({ job_id: id(n), attempt_id: id(n + 1), lease_id: id(n + 2), organization_id: org,
      company_id: company, event_type: "attempt_started", event: { payload: { sandboxId: `sandbox${n}abcdefghijklmnop` } } });
  }
  return rows;
}

// Capture the actual generated query at the Docker boundary, then execute it in
// real PostgreSQL. CTE fixtures provide typed rows, not a second query evaluator.
function cleanupQuery(kind = "journey") {
  const source = readFileSync(new URL("../../../scripts/m1-shipped-boot/journey.mjs", import.meta.url), "utf8");
  const ast = ts.createSourceFile("journey.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "readCleanupBindings");
  if (!fn) throw new Error("cleanup query entry point missing");
  let query: string | undefined;
  const read = vm.runInNewContext(`(${fn.getText(ast)})`, {
    REPORT: "",
    dexec: (_state: unknown, _service: string, script: string) => {
      const generated = ts.createSourceFile("readback.mjs", script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && node.expression.getText(generated) === "sql.unsafe"
          && ts.isStringLiteral(node.arguments[0])) query = node.arguments[0].text;
        ts.forEachChild(node, visit);
      }
      visit(generated);
      return { status: 0, result: { ok: true, rows: [] } };
    },
  }) as (state: object, intent: object, options: object) => unknown;
  read({}, { kind, organizationId: org, companyId: company, issueTitle: "proof", jobId: id(10) }, { timeoutMs: 1000 });
  if (!query) throw new Error("cleanup query was not captured");
  return query;
}

integration("M1 cleanup inventory SQL", () => {
  let dir: string | undefined;
  let embedded: { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> } | undefined;
  let sql: postgres.Sql;
  beforeAll(async () => {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    dir = mkdtempSync(path.join(tmpdir(), "aoa-cleanup-sql-"));
    const port = await allocateEmbeddedPgPort();
    embedded = new EmbeddedPostgres({ databaseDir: path.join(dir, "db"), user: "test", password: "test", port,
      persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"] });
    await embedded.initialise();
    await embedded.start();
    sql = postgres(`postgres://test:test@127.0.0.1:${port}/postgres`, { max: 1 });
  }, 120_000);
  afterAll(async () => {
    try { if (sql) await sql.end({ timeout: 5 }); }
    finally {
      try { if (embedded) await embedded.stop(); }
      finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
    }
  });
  function run(rows: Record<string, Row[]>, title = "proof", kind = "journey") {
    const ctes = Object.entries(tables).map(([name, columns], i) =>
      `${name} AS (SELECT * FROM jsonb_to_recordset(($${i + 4}::text)::jsonb) AS x(${columns}))`).join(",");
    return sql.unsafe(`WITH ${ctes} ${cleanupQuery(kind)}`, [org, company, kind === "redaction" ? id(10) : title,
      ...Object.keys(tables).map((name) => JSON.stringify(rows[name]))]);
  }
  it("discovers both submitted jobs without heartbeat markers and preserves distinct lease bindings", async () => {
    const rows = await run(fixture());
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.sandboxId)).size).toBe(2);
  });
  it("does not accept a sandbox event belonging to another lease", async () => {
    const data = fixture();
    data.job_events[1].lease_id = id(12);
    const rows = await run(data);
    expect(rows.find((row) => row.jobId === id(20))?.sandboxId).toBeNull();
  });
  it("keeps jobs missing attempt_started visible for the incomplete-inventory verdict", async () => {
    const data = fixture();
    data.job_events = [];
    const rows = await run(data);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.sandboxId === null)).toBe(true);
  });
  it("distinguishes a zero-job control from an unexpected submitted control job", async () => {
    expect(await run(fixture(), "control-with-no-jobs")).toHaveLength(0);
    const data = fixture();
    data.issues[0].title = "control";
    expect(await run(data, "control")).toHaveLength(2);
  });
  it("restricts a redaction intent to its exact job", async () => {
    const rows = await run(fixture(), "proof", "redaction");
    expect(rows).toHaveLength(1);
    expect(rows[0].jobId).toBe(id(10));
  });
  it("proves a cancelled retry has no lease or started event without hiding the original resource", async () => {
    const data = fixture();
    data.jobs.forEach((job) => { job.status = "cancelled"; });
    data.job_attempts.push({ id: id(30), job_id: id(10), organization_id: org, company_id: company,
      status: "cancelled", attempt_number: 2 });
    const rows: Row[] = JSON.parse(JSON.stringify(await run(data)));
    const retry = rows.find((row) => row.attemptId === id(30));
    expect(retry).toMatchObject({ attemptNumber: 2, attemptLeaseCount: 0, attemptStartedEventCount: 0,
      jobStatus: "cancelled", attemptStatus: "cancelled", leaseId: null, sandboxId: null });
    expect(rows.find((row) => row.attemptId === id(11))?.sandboxId).toBe("sandbox10abcdefghijklmnop");
    const helperUrl = new URL("../../../scripts/lib/m1-cleanup-evidence.mjs", import.meta.url);
    const { collectProviderInventory } = await import(/* @vite-ignore */ helperUrl.href);
    const inventory = () => collectProviderInventory({ candidate: "a".repeat(40), intents: [{ candidate: "a".repeat(40),
      id: "intent", kind: "journey", tenant: "a", worker: "worker", organizationId: org, companyId: company,
      targetId: target, issueTitle: "proof" }], read: () => rows });
    expect(inventory().complete).toBe(true);
    expect(inventory().resources).toHaveLength(2);
    expect(inventory().unleasedRetries).toHaveLength(1);
    data.job_events.push({ job_id: id(10), attempt_id: id(30), lease_id: id(99), organization_id: org,
      company_id: company, event_type: "attempt_started", event: { payload: { sandboxId: "orphanabcdefghijklmnop" } } });
    const withStart: Row[] = JSON.parse(JSON.stringify(await run(data)));
    expect(withStart.find((row) => row.attemptId === id(30))?.attemptStartedEventCount).toBe(1);
    expect(collectProviderInventory({ candidate: "a".repeat(40), intents: [{ candidate: "a".repeat(40),
      id: "intent", kind: "journey", tenant: "a", worker: "worker", organizationId: org, companyId: company,
      targetId: target, issueTitle: "proof" }], read: () => withStart }).complete).toBe(false);
  });
});

integration("M1 cleanup production cancellation", () => {
  let fx: JobControlFixture;
  beforeAll(async () => { fx = await setupJobControlFixture("m1-cleanup-cancel"); }, 180_000);
  afterAll(async () => { await fx?.teardown(); }, 60_000);

  async function failedAttempt(ordinal: number) {
    await fx.resetRuntimeRows();
    const seeded = await fx.seedPlacedJob(ordinal);
    // Configure a short lease at creation; never age its deadline or write status.
    const leasing = createJobLeasingService({ appDb: fx.app.db, ackTimeoutMs: 1_000, leaseDurationMs: 2_000 });
    const polled = await leasing.poll({ auth: auth(`cleanup-poll-${ordinal}`), request: pollRequest(`cleanup-poll-${ordinal}`) });
    if (polled.outcome !== "offer") throw new Error("cleanup test offer missing");
    const offer = polled.body;
    const ack = await leasing.ack({ auth: auth(`cleanup-ack-${ordinal}`), request: ackRequest(offer) });
    expect(ack.outcome).toBe("acknowledged");
    await runInTenant(fx.app.db, ORG, (repos) => repos.jobControl.completeAttempt({
      ...fx.fenceIdentity(seeded, offer), terminalStatus: "failed" }));
    return { seeded, offer };
  }
  async function waitForExpiry(expiresAt: string) {
    const remaining = Date.parse(expiresAt) - Date.now() + 50;
    expect(remaining).toBeLessThanOrEqual(2_100);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  async function statuses(jobId: string) {
    return fx.admin`SELECT j.status AS "jobStatus", a.status AS "attemptStatus", a.attempt_number AS "attemptNumber",
      l.status AS "leaseStatus" FROM jobs j JOIN job_attempts a ON a.job_id=j.id
      LEFT JOIN leases l ON l.attempt_id=a.id WHERE j.id=${jobId} ORDER BY a.attempt_number`;
  }
  async function cancelDeclared(jobId: string, attemptId: string) {
    const rows = await fx.admin`SELECT id AS "jobId", organization_id AS "organizationId", company_id AS "companyId",
      status AS "jobStatus" FROM jobs WHERE id=${jobId} AND organization_id=${ORG} AND company_id=${COMPANY}`;
    const helperUrl = new URL("../../../scripts/lib/m1-cleanup-evidence.mjs", import.meta.url);
    const { cancelDeclaredJobs } = await import(/* @vite-ignore */ helperUrl.href);
    const reconciliation = createJobReconciliationService({ appDb: fx.app.db });
    return cancelDeclaredJobs({ candidate: "a".repeat(40), intents: [{ candidate: "a".repeat(40), id: "intent",
      kind: "redaction", tenant: "a", worker: "worker", organizationId: ORG, companyId: COMPANY,
      targetId: TARGET, jobId, attemptId }], read: () => rows,
      cancel: (job: { organizationId: string; companyId: string; jobId: string }) => reconciliation.requestCancellation({
        ...job, reason: "shipped-boot teardown", graceful: true }) });
  }

  it("cancels a failed-but-leased job before natural expiry, preserves its failure, and prevents retry", async () => {
    const { seeded, offer } = await failedAttempt(7_701);
    const cancelled = await cancelDeclared(seeded.jobId, seeded.attemptId);
    expect(cancelled.pass).toBe(true);
    expect(cancelled.requests[0].outcome).toBe("queued");
    expect(await statuses(seeded.jobId)).toMatchObject([{ jobStatus: "cancel_requested", attemptStatus: "failed", leaseStatus: "active" }]);
    await waitForExpiry(offer.expiresAt);
    const reaped = await createJobReconciliationService({ appDb: fx.app.db }).reapOrganization(ORG);
    expect(reaped.cancelled).toBe(1);
    expect(reaped.retried).toBe(0);
    expect(await statuses(seeded.jobId)).toMatchObject([{ jobStatus: "cancelled", attemptStatus: "failed", leaseStatus: "revoked" }]);
    expect(await statuses(seeded.jobId)).toHaveLength(1);
  }, 60_000);

  it("settles a retry when the normal reaper won first without changing the failed original attempt", async () => {
    const { seeded, offer } = await failedAttempt(7_702);
    await waitForExpiry(offer.expiresAt);
    const reconciliation = createJobReconciliationService({ appDb: fx.app.db });
    expect((await reconciliation.reapOrganization(ORG)).retried).toBe(1);
    expect(await statuses(seeded.jobId)).toMatchObject([
      { jobStatus: "queued", attemptStatus: "failed", leaseStatus: "expired" },
      { jobStatus: "queued", attemptStatus: "pending", leaseStatus: null },
    ]);
    const cancelled = await cancelDeclared(seeded.jobId, seeded.attemptId);
    expect(cancelled.pass).toBe(true);
    expect(cancelled.requests[0].outcome).toBe("cancelled");
    expect(await statuses(seeded.jobId)).toMatchObject([
      { jobStatus: "cancelled", attemptStatus: "failed", leaseStatus: "expired" },
      { jobStatus: "cancelled", attemptStatus: "cancelled", leaseStatus: null },
    ]);
    const poll = await fx.leasing.poll({ auth: auth("cleanup-after-cancel"), request: pollRequest("cleanup-after-cancel") });
    expect(poll.outcome).toBe("no_work");
    expect((await reconciliation.reapOrganization(ORG)).retried).toBe(0);
  }, 60_000);
});

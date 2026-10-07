// JOB-016 — the E3-D-ACC in-transaction accepted-event seam, pricing registered on it, the
// hard-stop scope cancel, the terminal-without-usage signal and the bounded re-drive. Embedded
// PostgreSQL; Linux CI is the formal authority, SKIPPED on Windows unless AOA_RUN_WIN_INTEGRATION=1.
//
// Decision: docs/replatform/epics/E3-job-control/decisions.md, `E3-D-ACC` (accepted with three
// amendments). Every behaviour is proven against the REAL repository `acceptEvent` under a REAL
// fence, and the production composition (the ingest registers pricing) is proven through the real
// poll → ack → ingest path.
//
// MULTI-TENANT (F10): two Organizations, each with its own Company, target, worker, agent and
// model config, price side by side; a hard stop in one refuses only that one.
import { createCrewResultRecovery } from "../services/crew-result-recovery.js";
import { deliverCrewRunResult } from "../services/crew-result-relay.js";
import { synthesizeThreadDeliveryRefs } from "../services/viewer-ref-synthesis.js";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { AcceptEventInput, AcceptedEventProjector, ActiveFenceRequest, Db } from "@armyofagents/db";
import {
  canonicalEventDigestInputV1,
  type EventUploadOperationRequestV1,
  type LeaseOfferV1,
} from "@armyofagents/worker-protocol";
import type { SubmitJobSource } from "@armyofagents/shared";
import {
  setupJobControlFixture,
  auth,
  sha256,
  COMPANY,
  ORG,
  TARGET,
  WORKER,
  type JobControlFixture,
} from "./helpers/job-control-fixture.js";
import { runInTenant } from "../db/tenant-context.js";
import {
  createAcceptedUsagePricingProjector,
  createAuthoritativeCostRedriveSweep,
  createHubStuckChargeNotifier,
  redrivePendingAuthoritativeCost,
  redrivePendingProjection,
  AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS,
  STUCK_CHARGE_HUB_SOURCE_TYPE,
  type AcceptedUsageOutcome,
} from "../services/job-accepted-usage-pricing.js";
import {
  jobBudgetCostBridge,
  priceAcceptedUsageCore,
  JobBudgetCostTenantError,
} from "../services/job-budget-cost-bridge.js";
import { computeCostCents } from "../services/internal-agent/cost-model.js";
import { admitAttemptCapacity } from "../services/org-concurrency.js";
import { createJobEventIngestService } from "../services/job-events.js";
import { createDistributedExecutionDrainStore } from "../services/job-distributed-drain-store.js";
import { createDistributedExecutionDrain } from "../services/job-distributed-drain.js";
import { logger } from "../middleware/logger.js";
import { clearBudgetHooks, onBudgetExhausted, type BudgetEnforcementScope } from "../services/budget-hooks.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";
import { ackRequest, pollRequest } from "./helpers/job-control-fixture.js";
import { eq } from "drizzle-orm";
import { jobProjectionReceipts } from "@armyofagents/db";
import { createAcceptedActivityAuditProjector } from "../services/job-accepted-activity-audit.js";
import { resolveAcceptedOutputProjector } from "../services/job-accepted-output-projection.js";
import { recordAcceptedActivityCore, JobAuditBridgeTenantError } from "../services/job-audit-bridge.js";
import { projectAcceptedOutputCore, JobOutputBridgeTenantError } from "../services/job-output-bridge.js";
import { createJobOperationsService } from "../services/job-operations.js";
import { createTaskOutputContentService } from "../services/task-output-content.js";
import { taskOutputRoutes } from "../routes/task-outputs.js";
import { expectedAttemptObjectPrefix } from "@armyofagents/worker-protocol";
import type { StorageProvider } from "../storage/types.js";

const ENABLED_ENV = { AOA_DISTRIBUTED_EXECUTION_ENABLED: "true" } as const;
const KNOWN_MODEL = "claude-sonnet-4-6";
const UNKNOWN_MODEL = "totally-unknown-model-x";

// Organization B — a SECOND tenant with its own Company, target, worker and agent.
const ORG_B = "a6000000-0000-4000-8000-0000000000b1";
const COMPANY_B = "a6000000-0000-4000-8000-0000000000b2";
const COMPANY_SIBLING = "a6000000-0000-4000-8000-0000000000c2";
const TARGET_B = "a6000000-0000-4000-8000-0000000000b3";
const WORKER_B = "a6000000-0000-4000-8000-0000000000b5";

const AGENT_A = "a7160000-0000-4000-8000-0000000000a1";
const AGENT_A_UNKNOWN = "a7160000-0000-4000-8000-0000000000a2";
const AGENT_B = "a7160000-0000-4000-8000-0000000000b1";
const USER_A = "job016-user-a";
const USER_B = "job016-user-b";

const HASH_A = "7".repeat(64);
const HASH_B = "8".repeat(64);

interface Tenant {
  organizationId: string;
  companyId: string;
  targetId: string;
  workerId: string;
  targetAuthorityKey: string;
}
const TENANT_A: Tenant = {
  organizationId: ORG, companyId: COMPANY, targetId: TARGET, workerId: WORKER,
  targetAuthorityKey: `organization:${ORG}`,
};
const TENANT_B: Tenant = {
  organizationId: ORG_B, companyId: COMPANY_B, targetId: TARGET_B, workerId: WORKER_B,
  targetAuthorityKey: `organization:${ORG_B}`,
};

let fixture: JobControlFixture | null = null;
let setupError: unknown = null;

function guard(): JobControlFixture {
  if (setupError) throw new Error(`fixture setup failed: ${String(setupError)}`);
  if (!fixture) throw new Error("fixture not initialised");
  return fixture;
}

async function count(table: string, where: string): Promise<number> {
  const [row] = await guard().admin.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`);
  return (row as { n: number }).n;
}

function taskSource(agentId: string): SubmitJobSource {
  return { kind: "task_run", runId: randomUUID(), issueId: randomUUID(), assigneeAgentId: agentId };
}

/** Seed a job + a RUNNING attempt + an ACTIVE lease for `tenant`, directly. Returns the fence. */
async function seedLeasedAttempt(tenant: Tenant, source: SubmitJobSource): Promise<ActiveFenceRequest> {
  const f = guard();
  const jobId = randomUUID();
  const attemptId = randomUUID();
  const leaseId = randomUUID();
  const fence = `fence-${randomUUID()}`;
  await f.admin`INSERT INTO jobs (id, organization_id, company_id, source_kind, source_identity, source_intent, status)
    VALUES (${jobId}, ${tenant.organizationId}, ${tenant.companyId}, ${source.kind}, ${jobId}, ${f.admin.json(source as never)}, 'running')`;
  await f.admin`INSERT INTO job_attempts (id, organization_id, company_id, job_id, attempt_number, status)
    VALUES (${attemptId}, ${tenant.organizationId}, ${tenant.companyId}, ${jobId}, 1, 'running')`;
  const hash = tenant === TENANT_A ? HASH_A : HASH_B;
  await f.admin`INSERT INTO leases
    (id, organization_id, attempt_id, company_id, job_id, attempt_number, worker_id, target_id,
     target_authority_key, target_generation, profile_hash, provider_constraint_hash, status, fence,
     ack_deadline, expires_at, activated_at)
    VALUES (${leaseId}, ${tenant.organizationId}, ${attemptId}, ${tenant.companyId}, ${jobId}, 1,
      ${tenant.workerId}, ${tenant.targetId}, ${tenant.targetAuthorityKey}, 1, ${hash}, ${hash},
      'active', ${fence}, now() + interval '1 minute', now() + interval '10 minutes', now())`;
  return {
    organizationId: tenant.organizationId,
    companyId: tenant.companyId,
    jobId,
    attemptId,
    attemptNumber: 1,
    leaseId,
    workerId: tenant.workerId,
    targetId: tenant.targetId,
    targetAuthorityKey: tenant.targetAuthorityKey,
    targetGeneration: 1,
    profileHash: hash,
    providerConstraintHash: hash,
    fence,
  };
}

/** Seed a QUEUED job (no lease) for `tenant`; returns its ids. */
async function seedQueuedJob(tenant: Tenant, source: SubmitJobSource): Promise<{ jobId: string; attemptId: string }> {
  const f = guard();
  const jobId = randomUUID();
  const attemptId = randomUUID();
  await f.admin`INSERT INTO jobs (id, organization_id, company_id, source_kind, source_identity, source_intent, status)
    VALUES (${jobId}, ${tenant.organizationId}, ${tenant.companyId}, ${source.kind}, ${jobId}, ${f.admin.json(source as never)}, 'queued')`;
  await f.admin`INSERT INTO job_attempts (id, organization_id, company_id, job_id, attempt_number, status)
    VALUES (${attemptId}, ${tenant.organizationId}, ${tenant.companyId}, ${jobId}, 1, 'pending')`;
  return { jobId, attemptId };
}

function acceptInput(
  fence: ActiveFenceRequest,
  seq: number,
  eventType: string,
  payload: Record<string, unknown>,
  opts: { eventId?: string; terminalStatus?: "succeeded" | "failed" | "cancelled" | "expired" } = {},
): AcceptEventInput {
  const eventId = opts.eventId ?? randomUUID();
  const digest = createHash("sha256").update(`${eventId}:${seq}`).digest("hex");
  return {
    eventId,
    sequence: seq,
    eventType,
    fenceToken: fence.fence,
    suppliedDigest: digest,
    recomputedDigest: digest,
    occurredAt: new Date(),
    // The repository stores the WHOLE wire event; the usage units ride its `payload`.
    payload: { eventId, eventType, seq, payload },
    terminalStatus: opts.terminalStatus ?? null,
    serviceProjection: null,
  };
}
const usage = (fence: ActiveFenceRequest, seq: number, eventId?: string) =>
  acceptInput(fence, seq, "usage", { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0, runtimeMillis: 100 }, { eventId });
const terminal = (fence: ActiveFenceRequest, seq: number) =>
  acceptInput(fence, seq, "terminal", { status: "succeeded", exitCode: 0, errorCode: null, errorMessage: null }, { terminalStatus: "succeeded" });
const cancelEv = (fence: ActiveFenceRequest, seq: number) =>
  acceptInput(fence, seq, "log", { stream: "stdout", level: "info", message: "cancel acknowledged" });

/** Drive the REAL repository `acceptEvent` under the fence, with the given registrations. */
async function accept(
  fence: ActiveFenceRequest,
  events: AcceptEventInput[],
  projectors: readonly AcceptedEventProjector[] = [createAcceptedUsagePricingProjector()],
) {
  return runInTenant(guard().app.db, fence.organizationId, (repos) =>
    repos.jobControl.acceptEvent({ ...fence, batch: { events, acceptedEventProjectors: projectors } }));
}

async function seedCompanyHardStop(companyId: string, amountCents: number): Promise<void> {
  await guard().admin`INSERT INTO budget_policies
    (company_id, scope_type, scope_id, metric, window_kind, amount_cents, warn_percent, hard_stop_enabled, is_active)
    VALUES (${companyId}, 'company', ${companyId}, 'cost_cents', 'calendar_month_utc', ${amountCents}, 80, true, true)`;
}

async function receiptFor(fence: ActiveFenceRequest, eventId: string) {
  const rows = await guard().admin`SELECT id, status, target_aggregate_id, aggregate_kind, organization_id, company_id
    FROM job_projection_receipts WHERE projection_kind = 'authoritative_cost'
      AND organization_id = ${fence.organizationId} AND source_identity = ${`cost:${fence.companyId}:${eventId}`}`;
  return rows[0] as { id: string; status: string; target_aggregate_id: string; aggregate_kind: string; organization_id: string; company_id: string } | undefined;
}

/** Submit-time admission exactly as `submitJobWithinTenant` runs it: inside the tenant tx. */
async function admitIn(f: JobControlFixture, input: Parameters<typeof admitAttemptCapacity>[1]) {
  return runInTenant(f.app.db, input.organizationId, (_repos, tx) => admitAttemptCapacity(tx, input));
}

// The OWNER pool the production notifier gets (`db` in index.ts). A SEPARATE client: drizzle's
// postgres-js driver rewrites its client's type serializers, so wrapping `fixture.admin` would
// corrupt every later raw query the fixture makes.
let ownerClient: ReturnType<typeof postgres> | null = null;
function ownerDb(): Db {
  if (!ownerClient) {
    const options = guard().admin.options as unknown as { port: number[] };
    ownerClient = postgres(`postgres://test:test@127.0.0.1:${options.port[0]}/postgres`, { max: 2 });
  }
  return drizzle(ownerClient) as unknown as Db;
}

beforeAll(async () => {
  try {
    fixture = await setupJobControlFixture("job016-seam");
    const f = fixture;
    // Organization B: its own org, Company, target and worker (cloned shape, new identities).
    await f.admin`INSERT INTO organizations (id, name, slug) VALUES (${ORG_B}, 'JOB-016 org B', 'job-016-org-b')`;
    await f.admin`INSERT INTO companies (id, organization_id, name, issue_prefix) VALUES (${COMPANY_B}, ${ORG_B}, 'JOB-016 company B', 'J16B')`;
    await f.admin`INSERT INTO companies (id, organization_id, name, issue_prefix) VALUES (${COMPANY_SIBLING}, ${ORG}, 'JOB-016 sibling company', 'J16C')`;
    await f.admin`INSERT INTO execution_targets
      (id, organization_id, slug, kind, trust_class, status, capabilities, config, scope,
       target_authority_key, device_generation, registered_profile, registered_profile_hash,
       provider_constraint_profile, last_seen_at)
      SELECT ${TARGET_B}, ${ORG_B}, 'job-016-target-b', kind, trust_class, status, capabilities, config, scope,
        ${TENANT_B.targetAuthorityKey}, 1, registered_profile, registered_profile_hash,
        provider_constraint_profile, clock_timestamp()
      FROM execution_targets WHERE id = ${TARGET}`;
    await f.admin`INSERT INTO workers
      (id, scope, organization_id, execution_target_id, target_authority_key, device_public_key,
       device_thumbprint, device_generation, profile_hash, profile_snapshot, enrolled_at, last_seen_at, label, status)
      SELECT ${WORKER_B}, scope, ${ORG_B}, ${TARGET_B}, ${TENANT_B.targetAuthorityKey}, 'job-016-b-public-key',
        ${"9".repeat(64)}, 1, profile_hash, profile_snapshot, clock_timestamp(), clock_timestamp(), 'JOB-016 worker B', 'enrolled'
      FROM workers WHERE id = ${WORKER}`;
    // Per-tenant agents + model config (each Company resolves its OWN rate source).
    await f.admin`INSERT INTO agents (id, company_id, name, kind, status, adapter_type, adapter_config)
      VALUES (${AGENT_A}, ${COMPANY}, 'J016 A', 'org', 'idle', 'claude_local', ${f.admin.json({ model: KNOWN_MODEL })})`;
    await f.admin`INSERT INTO agents (id, company_id, name, kind, status, adapter_type, adapter_config)
      VALUES (${AGENT_A_UNKNOWN}, ${COMPANY}, 'J016 A unknown', 'org', 'idle', 'claude_local', ${f.admin.json({ model: UNKNOWN_MODEL })})`;
    await f.admin`INSERT INTO agents (id, company_id, name, kind, status, adapter_type, adapter_config)
      VALUES (${AGENT_B}, ${COMPANY_B}, 'J016 B', 'org', 'idle', 'claude_local', ${f.admin.json({ model: KNOWN_MODEL })})`;
    await f.admin`INSERT INTO internal_agent_config (company_id, model, provider) VALUES (${COMPANY}, ${KNOWN_MODEL}, 'anthropic')`;
    await f.admin`INSERT INTO internal_agent_config (company_id, model, provider) VALUES (${COMPANY_B}, ${KNOWN_MODEL}, 'anthropic')`;
    for (const [user, company] of [[USER_A, COMPANY], [USER_B, COMPANY_B]] as const) {
      await f.admin`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
        VALUES (${user}, ${user}, ${`${user}@example.test`}, true, now(), now())`;
      await f.admin`INSERT INTO company_memberships (company_id, principal_type, principal_id, status, membership_role)
        VALUES (${company}, 'user', ${user}, 'active', 'owner')`;
    }
  } catch (error) {
    setupError = error;
  }
}, 180_000);

afterAll(async () => {
  await ownerClient?.end().catch(() => {});
  await fixture?.teardown().catch(() => {});
}, 60_000);

beforeEach(async () => {
  if (!fixture) return;
  await fixture.resetRuntimeRows();
  await fixture.admin`DELETE FROM budget_incidents`;
  await fixture.admin`DELETE FROM budget_policies`;
  await fixture.admin`DELETE FROM cost_events`;
  await fixture.admin`DELETE FROM approvals`;
  await fixture.admin`DELETE FROM notifications`;
  await fixture.admin`UPDATE companies SET spent_monthly_cents = 0`;
  await fixture.admin`UPDATE agents SET spent_monthly_cents = 0, status = 'idle'`;
  await fixture.admin`UPDATE agents SET adapter_config = ${fixture.admin.json({ model: UNKNOWN_MODEL })} WHERE id = ${AGENT_A_UNKNOWN}`;
});

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "JOB-016 E3-D-ACC accepted-event seam (embedded PG)",
  () => {
    it("[acc 1 + d] usage-then-terminal in ONE batch prices exactly once (cost > 0) with an applied receipt, and never trips the fence", async () => {
      const f = guard();
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const u = usage(fence, 1);
      const result = await accept(fence, [u, terminal(fence, 2)]);

      expect(result.ingest?.status).toBe("accepted");
      expect(result.ingest?.acceptedThroughSeq).toBe(2);
      expect(result.acceptedEventProjections?.map((p) => p.outcome)).toEqual(["applied"]);
      const rows = await f.admin`SELECT id, cost_cents, company_id, source_idempotency_key FROM cost_events`;
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.cost_cents)).toBeGreaterThan(0);
      expect(Number(rows[0]!.cost_cents)).toBe(computeCostCents("claude_local", KNOWN_MODEL, 1_000_000, 1_000_000));
      expect(rows[0]!.company_id).toBe(COMPANY);
      expect(rows[0]!.source_idempotency_key).toBe(`cost:${COMPANY}:${u.eventId}`);
      const receipt = await receiptFor(fence, u.eventId);
      expect(receipt?.status).toBe("applied");
      expect(receipt?.aggregate_kind).toBe("cost_events");
      expect(receipt?.target_aggregate_id).toBe(rows[0]!.id);
      // The terminal projected AFTER the charge, in the same transaction.
      expect(await count("job_attempts", `id = '${fence.attemptId}' AND status = 'succeeded'`)).toBe(1);
    });

    it("[d] cancel-then-terminal in ONE batch does not trip the fence either", async () => {
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const result = await accept(fence, [cancelEv(fence, 1), usage(fence, 2), terminal(fence, 3)]);
      expect(result.ingest?.status).toBe("accepted");
      expect(result.acceptedEventProjections?.map((p) => p.outcome)).toEqual(["applied"]);
      expect(await count("cost_events", "true")).toBe(1);
    });

    it("[acc 2 + d] a replay re-runs nothing: the replayed batch prices nothing, and the wrapper reports `replayed` off the SAME receipt", async () => {
      const f = guard();
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const u = usage(fence, 1);
      await accept(fence, [u]);
      const replay = await accept(fence, [u]);
      expect(replay.ingest?.status).toBe("accepted");
      expect(replay.acceptedEventProjections ?? []).toEqual([]);
      expect(await count("cost_events", "true")).toBe(1);

      // The JOB-012 wrapper shares the identity `cost:{company}:{eventId}` → `replayed`, no row.
      const out = await jobBudgetCostBridge(f.app.db, { env: ENABLED_ENV }).priceAcceptedUsage({
        source: taskSource(AGENT_A),
        actor: { kind: "user", id: USER_A, companyId: COMPANY },
        fence,
        acceptedEventId: u.eventId,
        eventDigest: u.recomputedDigest,
        units: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, runtimeMillis: 1 },
      });
      expect(out.status).toBe("replayed");
      expect(await count("cost_events", "true")).toBe(1);
    });

    it("[d] the idempotency comes from the RECEIPT table: a new-tail event whose receipt already exists is `replayed`, not re-charged", async () => {
      const f = guard();
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const eventId = randomUUID();
      // Price it through the wrapper first (same identity), then deliver it as a NEW event.
      await jobBudgetCostBridge(f.app.db, { env: ENABLED_ENV }).priceAcceptedUsage({
        source: taskSource(AGENT_A),
        actor: { kind: "user", id: USER_A, companyId: COMPANY },
        fence, acceptedEventId: eventId, eventDigest: "a".repeat(64),
        units: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, runtimeMillis: 1 },
      });
      const result = await accept(fence, [usage(fence, 1, eventId)]);
      expect(result.acceptedEventProjections?.map((p) => p.outcome)).toEqual(["replayed"]);
      expect(await count("cost_events", "true")).toBe(1);
    });

    it("[acc 5] an injected projector failure (unknown-rate model) leaves the append COMMITTED and the receipt `pending`, pointed at the attempt; the detector surfaces it", async () => {
      const f = guard();
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A_UNKNOWN));
      const u = usage(fence, 1);
      const result = await accept(fence, [u, terminal(fence, 2)]);

      expect(result.ingest?.status).toBe("accepted");
      expect(result.acceptedEventProjections).toEqual([
        expect.objectContaining({ outcome: "pending", reason: "JOB_BUDGET_COST_RATE", eventId: u.eventId }),
      ]);
      expect(await count("job_events", `attempt_id = '${fence.attemptId}'`)).toBe(2);
      expect(await count("job_attempts", `id = '${fence.attemptId}' AND status = 'succeeded'`)).toBe(1);
      expect(await count("cost_events", "true")).toBe(0);
      const receipt = await receiptFor(fence, u.eventId);
      expect(receipt?.status).toBe("pending");
      expect(receipt?.target_aggregate_id).toBe(fence.attemptId);
      expect(receipt?.aggregate_kind).toBe("job_attempts");

      // The detector surfaces it (per Organization + Company, with kind and ids).
      const warn = vi.fn();
      const sweep = createAuthoritativeCostRedriveSweep({
        appDb: f.app.db,
        notifier: { isNotified: async () => false, notify: async () => {} },
        log: { warn, info: () => {} },
        // Keep the failure persistent so this test observes only the detector.
        redrive: async () => { throw new Error("still unpriceable"); },
        maxAttempts: 100,
        staleAfterMs: 0,
        now: () => new Date(Date.now() + 1_000),
      });
      const swept = await sweep.sweepOrganization(ORG);
      expect(swept.stale).toBe(1);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          classification: "stale_pending_projection_receipt",
          organizationId: ORG, companyId: COMPANY, projectionKind: "authoritative_cost",
          jobId: fence.jobId, attemptId: fence.attemptId, receiptId: receipt!.id,
        }),
        expect.any(String),
      );
    });

    it("[c] a projector's own writes roll back with its savepoint; the append and the pending receipt survive", async () => {
      const f = guard();
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const throwing: AcceptedEventProjector = {
        projectionKind: "authoritative_cost",
        aggregateKind: "cost_events",
        sourceIdentity: (event, fenceIn) => event.eventType === "usage" ? `cost:${fenceIn.companyId}:${event.eventId}` : null,
        async apply({ tx }) {
          await tx.execute(
            // A write through the savepoint handle, then a throw: it must NOT survive.
            (await import("drizzle-orm")).sql`INSERT INTO cost_events (company_id, provider, biller, billing_type, model, input_tokens, output_tokens, cost_cents, occurred_at)
              VALUES (${COMPANY}, 'x', 'x', 'unknown', 'x', 0, 0, 999, now())`,
          );
          throw new Error("boom");
        },
      };
      const u = usage(fence, 1);
      const result = await accept(fence, [u, terminal(fence, 2)], [throwing]);
      expect(result.ingest?.status).toBe("accepted");
      expect(result.acceptedEventProjections?.[0]?.outcome).toBe("pending");
      expect(await count("cost_events", "true")).toBe(0);
      expect(await count("job_events", `attempt_id = '${fence.attemptId}'`)).toBe(2);
      expect((await receiptFor(fence, u.eventId))?.status).toBe("pending");
      void f;
    });

    it("[b1 step 2] a usage event AFTER the terminal in the same batch is recorded `pending` (after_terminal), never dropped and never charged", async () => {
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const u = usage(fence, 2);
      const result = await accept(fence, [terminal(fence, 1), u]);
      expect(result.ingest?.status).toBe("accepted");
      expect(result.acceptedEventProjections).toEqual([
        expect.objectContaining({ outcome: "pending", reason: "after_terminal", eventId: u.eventId }),
      ]);
      expect(await count("cost_events", "true")).toBe(0);
      expect((await receiptFor(fence, u.eventId))?.status).toBe("pending");
    });

    it("[acc 3 + Amendment 2] after a Company hard-stop breach a job queued BEFORE the breach is never leased (cancelled, the legacy-equivalent state), and the next submit is refused", async () => {
      const f = guard();
      // J: a real PLACED, leasable job of Company A, queued before the breach.
      const placed = await f.seedPlacedJob(41);
      await seedCompanyHardStop(COMPANY, 1);
      // A different attempt breaches the Company hard stop through a priced usage event.
      const breaching = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      await accept(breaching, [usage(breaching, 1)]);

      expect(await count("budget_incidents", `company_id = '${COMPANY}' AND threshold_type = 'hard_stop'`)).toBe(1);
      expect(await count("jobs", `id = '${placed.jobId}' AND status = 'cancelled'`)).toBe(1);
      expect(await count("job_attempts", `id = '${placed.attemptId}' AND status = 'cancelled'`)).toBe(1);
      // J is not leased: the real poll finds nothing to offer.
      const polled = await f.leasing.poll({ auth: auth("j016-poll"), request: pollRequest("j016-poll") });
      expect(polled.outcome).not.toBe("offer");
      expect(await count("leases", `job_id = '${placed.jobId}'`)).toBe(0);

      // The next dispatch is refused at submit (company-scoped preflight in admitAttemptCapacity).
      const nextJ = await seedQueuedJob(TENANT_A, taskSource(AGENT_A));
      const admission = await admitIn(f, {
        organizationId: ORG, companyId: COMPANY, workloadType: "batch", attemptId: nextJ.attemptId,
        principalId: USER_A, principalKind: "user", cap: 100,
      });
      expect(admission).toMatchObject({ admitted: false, reason: "budget" });
    });

    it("[acc 3 positive control] with NO hard stop, the same queued job stays leasable and IS offered", async () => {
      const f = guard();
      const placed = await f.seedPlacedJob(42);
      const other = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      await accept(other, [usage(other, 1)]);
      expect(await count("jobs", `id = '${placed.jobId}' AND status = 'queued'`)).toBe(1);
      const polled = await f.leasing.poll({ auth: auth("j016-poll-pc"), request: pollRequest("j016-poll-pc") });
      expect(polled.outcome).toBe("offer");
    });

    it("[Codex P2] a savepoint that rolls back AFTER the core ran emits NO budget.exhausted signal (no live work is cancelled for a charge that never committed)", async () => {
      clearBudgetHooks();
      const emitted: BudgetEnforcementScope[] = [];
      onBudgetExhausted((scope) => { emitted.push(scope); });
      // Codex P2 (second round): nor may a `budget.incident_created` live event escape.
      const liveTypes: string[] = [];
      const unsubscribe = subscribeCompanyLiveEvents(COMPANY, (event) => { liveTypes.push(event.type); });
      try {
        await seedCompanyHardStop(COMPANY, 1);
        const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
        const real = createAcceptedUsagePricingProjector();
        const failsLate: AcceptedEventProjector = {
          ...real,
          async apply(ctx) {
            await real.apply(ctx); // the whole core ran: charge, incident, breach
            throw new Error("a later step in the savepoint failed");
          },
        };
        const result = await accept(fence, [usage(fence, 1)], [failsLate]);
        expect(result.acceptedEventProjections?.[0]?.outcome).toBe("pending");
        expect(await count("cost_events", "true")).toBe(0);
        expect(await count("budget_incidents", "true")).toBe(0);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(emitted).toEqual([]);
        expect(liveTypes).not.toContain("budget.incident_created");
      } finally {
        unsubscribe();
        clearBudgetHooks();
      }
    });

    it("[Codex P1] a job whose lease was OFFERED but not yet ACKed at the breach is cancelled, and its ACK is refused (never leased)", async () => {
      const f = guard();
      const placed = await f.seedPlacedJob(43);
      // The worker has polled: an OFFERED lease exists; jobs.status is still `queued`.
      const polled = await f.leasing.poll({ auth: auth("j016-p1-poll"), request: pollRequest("j016-p1-poll") });
      expect(polled.outcome).toBe("offer");
      if (polled.outcome !== "offer") return;
      expect(await count("leases", `job_id = '${placed.jobId}' AND status = 'offered'`)).toBe(1);
      expect(await count("jobs", `id = '${placed.jobId}' AND status = 'queued'`)).toBe(1);

      await seedCompanyHardStop(COMPANY, 1);
      const breaching = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      await accept(breaching, [usage(breaching, 1)]);

      expect(await count("jobs", `id = '${placed.jobId}' AND status = 'cancel_requested'`)).toBe(1);
      expect(await count("job_attempts", `id = '${placed.attemptId}' AND status = 'cancel_requested'`)).toBe(1);
      // The worker's late ACK does not make the attempt leased.
      const acked = await f.leasing.ack({ auth: auth("j016-p1-ack"), request: ackRequest(polled.body) })
        .then((r) => r.outcome, () => "refused");
      expect(acked).not.toBe("acknowledged");
      expect(await count("job_attempts", `id = '${placed.attemptId}' AND status IN ('leased', 'running')`)).toBe(0);
      expect(await count("leases", `job_id = '${placed.jobId}' AND status = 'active'`)).toBe(0);
    });

    it("[acc 7 / F10] two Organizations price side by side; each row carries its own tenant; a hard stop in A refuses only A", async () => {
      const f = guard();
      await seedCompanyHardStop(COMPANY, 1);
      const queuedA = await seedQueuedJob(TENANT_A, taskSource(AGENT_A));
      const queuedB = await seedQueuedJob(TENANT_B, taskSource(AGENT_B));
      const fenceA = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const fenceB = await seedLeasedAttempt(TENANT_B, taskSource(AGENT_B));
      const uA = usage(fenceA, 1);
      const uB = usage(fenceB, 1);
      await accept(fenceA, [uA, terminal(fenceA, 2)]);
      await accept(fenceB, [uB, terminal(fenceB, 2)]);

      const rows = await f.admin`SELECT company_id, source_idempotency_key, cost_cents FROM cost_events ORDER BY company_id`;
      expect(rows.map((r) => r.company_id).sort()).toEqual([COMPANY, COMPANY_B].sort());
      expect(rows.find((r) => r.company_id === COMPANY)!.source_idempotency_key).toBe(`cost:${COMPANY}:${uA.eventId}`);
      expect(rows.find((r) => r.company_id === COMPANY_B)!.source_idempotency_key).toBe(`cost:${COMPANY_B}:${uB.eventId}`);
      const rA = await receiptFor(fenceA, uA.eventId);
      const rB = await receiptFor(fenceB, uB.eventId);
      expect([rA?.organization_id, rA?.company_id, rA?.status]).toEqual([ORG, COMPANY, "applied"]);
      expect([rB?.organization_id, rB?.company_id, rB?.status]).toEqual([ORG_B, COMPANY_B, "applied"]);
      // Budget evaluation is per tenant: only A has an incident.
      expect(await count("budget_incidents", `company_id = '${COMPANY}'`)).toBe(1);
      expect(await count("budget_incidents", `company_id = '${COMPANY_B}'`)).toBe(0);
      // The hard stop in A cancels A's queued job and NOT B's.
      expect(await count("jobs", `id = '${queuedA.jobId}' AND status = 'cancelled'`)).toBe(1);
      expect(await count("jobs", `id = '${queuedB.jobId}' AND status = 'queued'`)).toBe(1);
      // Next dispatch: A refused, B admitted (the positive control for the refusal).
      const nextA = await seedQueuedJob(TENANT_A, taskSource(AGENT_A));
      const nextB = await seedQueuedJob(TENANT_B, taskSource(AGENT_B));
      const admitA = await admitIn(f, {
        organizationId: ORG, companyId: COMPANY, workloadType: "batch", attemptId: nextA.attemptId,
        principalId: USER_A, principalKind: "user", cap: 100,
      });
      const admitB = await admitIn(f, {
        organizationId: ORG_B, companyId: COMPANY_B, workloadType: "batch", attemptId: nextB.attemptId,
        principalId: USER_B, principalKind: "user", cap: 100,
      });
      expect(admitA).toMatchObject({ admitted: false, reason: "budget" });
      expect(admitB).toMatchObject({ admitted: true });
    });

    it("[F10] the core refuses to charge a Company the Organization does not own (no cost row written)", async () => {
      const f = guard();
      const fenceB = await seedLeasedAttempt(TENANT_B, taskSource(AGENT_B));
      await expect(runInTenant(f.app.db, ORG_B, (repos, tx) => priceAcceptedUsageCore({ tx, repos }, {
        source: taskSource(AGENT_A),
        organizationId: ORG_B,
        companyId: COMPANY, // Organization A's Company
        jobId: fenceB.jobId,
        acceptedEventId: randomUUID(),
        units: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, runtimeMillis: 1 },
      }))).rejects.toBeInstanceOf(JobBudgetCostTenantError);
      expect(await count("cost_events", "true")).toBe(0);

      // Nor can Organization B's attempt borrow Organization A's agent as its rate source: the
      // model lookup is scoped to the charge's own Company, so it fails closed → `pending`.
      const borrowing = await seedLeasedAttempt(TENANT_B, taskSource(AGENT_A));
      const bu = usage(borrowing, 1);
      const out = await accept(borrowing, [bu]);
      expect(out.acceptedEventProjections).toEqual([
        expect.objectContaining({ outcome: "pending", reason: "JOB_BUDGET_COST_RATE" }),
      ]);
      expect(await count("cost_events", "true")).toBe(0);
    });

    it("[acc 6a] a pending cost receipt BLOCKS the drain; re-driven to applied, the SAME drain proceeds", async () => {
      const f = guard();
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A_UNKNOWN));
      const u = usage(fence, 1);
      await accept(fence, [u]); // the attempt stays live, so the drain has something to cancel
      const receipt = await receiptFor(fence, u.eventId);
      expect(receipt?.status).toBe("pending");

      const store = createDistributedExecutionDrainStore(f.app.db, f.operator.db);
      const bridge = jobBudgetCostBridge(f.app.db, { env: ENABLED_ENV });
      const requestCancellation = vi.fn(async () => ({ status: "queued" as const, command: null }));
      const drain = createDistributedExecutionDrain({
        listAdmittedOrganizationIds: async ({ afterOrganizationId }) => afterOrganizationId === null ? [ORG] : [],
        listOrganizationCompanyIds: (organizationId) => store.listOrganizationCompanyIds(organizationId),
        listActiveAttempts: (organizationId) => store.listActiveAttempts(organizationId),
        requestCancellation,
        assertRollbackSafe: (companyId) => bridge.assertRollbackSafe(companyId),
      });
      // The JOB-012 wrapper's fast path reads the receipt STATUS: an owed charge is `pending`,
      // never `replayed` with the attempt id passed off as a cost row.
      const viaWrapper = await bridge.priceAcceptedUsage({
        source: taskSource(AGENT_A_UNKNOWN),
        actor: { kind: "user", id: USER_A, companyId: COMPANY },
        fence, acceptedEventId: u.eventId, eventDigest: u.recomputedDigest,
        units: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, runtimeMillis: 1 },
      });
      expect(viaWrapper).toMatchObject({ status: "pending", costEventId: null, receiptId: receipt!.id });

      const blocked = await drain.drainAll();
      expect(blocked.skippedOrganizations).toEqual([ORG]);
      expect(blocked.perOrganization[0]).toMatchObject({ skipped: true, reason: "rollback_pending" });
      expect(requestCancellation).not.toHaveBeenCalled();

      // Fix the cause (the agent's model becomes a known rate) and re-drive.
      await f.admin`UPDATE agents SET adapter_config = ${f.admin.json({ model: KNOWN_MODEL })} WHERE id = ${AGENT_A_UNKNOWN}`;
      const redriven = await redrivePendingAuthoritativeCost(f.app.db, { organizationId: ORG, receiptId: receipt!.id });
      expect(redriven.status).toBe("redriven");
      const after = await receiptFor(fence, u.eventId);
      expect(after?.status).toBe("applied");
      expect(after?.aggregate_kind).toBe("cost_events");
      const [cost] = await f.admin`SELECT id, cost_cents FROM cost_events`;
      expect(after?.target_aggregate_id).toBe(cost!.id);
      expect(Number(cost!.cost_cents)).toBeGreaterThan(0);
      // A second re-drive of the same receipt is a no-op (compare-and-set on `pending`).
      expect((await redrivePendingAuthoritativeCost(f.app.db, { organizationId: ORG, receiptId: receipt!.id })).status).toBe("not_pending");
      expect(await count("cost_events", "true")).toBe(1);

      const proceeded = await drain.drainAll();
      expect(proceeded.skippedOrganizations).toEqual([]);
      expect(requestCancellation).toHaveBeenCalled();
    });

    it("[Amendment 3] a PERSISTENT failure stops at the bound and raises EXACTLY ONE Inbox item, durably (a restarted sweep neither retries nor re-raises)", async () => {
      const f = guard();
      await f.admin`DELETE FROM notifications WHERE source_type = ${STUCK_CHARGE_HUB_SOURCE_TYPE}`;
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A_UNKNOWN));
      const u = usage(fence, 1);
      await accept(fence, [u, terminal(fence, 2)]);
      const receipt = await receiptFor(fence, u.eventId);
      expect(receipt?.status).toBe("pending");

      let redriveCalls = 0;
      const countingRedrive: typeof redrivePendingAuthoritativeCost = async (db, input) => {
        redriveCalls += 1;
        return redrivePendingAuthoritativeCost(db, input);
      };
      const outcomes: AcceptedUsageOutcome[] = [];
      const makeSweep = () => createAuthoritativeCostRedriveSweep({
        appDb: f.app.db,
        notifier: createHubStuckChargeNotifier(ownerDb()),
        log: { warn: () => {}, info: () => {} },
        telemetry: { count: ({ outcome }) => { outcomes.push(outcome); } },
        maxAttempts: 3,
        staleAfterMs: 0,
        now: () => new Date(Date.now() + 1_000),
        redrive: countingRedrive,
      });
      const sweep = makeSweep();
      for (let tick = 0; tick < 6; tick += 1) await sweep.sweepOrganization(ORG);
      expect(redriveCalls).toBe(3);
      expect(await count("notifications", `source_type = '${STUCK_CHARGE_HUB_SOURCE_TYPE}' AND source_id = '${receipt!.id}'`)).toBe(1);
      expect(outcomes.filter((o) => o === "redrive_exhausted")).toHaveLength(1);

      // A "restarted" process: a fresh sweep (fresh in-memory counters) must not retry or re-raise.
      const restarted = makeSweep();
      for (let tick = 0; tick < 3; tick += 1) await restarted.sweepOrganization(ORG);
      expect(redriveCalls).toBe(3);
      expect(await count("notifications", `source_type = '${STUCK_CHARGE_HUB_SOURCE_TYPE}'`)).toBe(1);
      expect((await receiptFor(fence, u.eventId))?.status).toBe("pending");
    });
  },
);

// -------------------------------------------------------------------------------------------
// The PRODUCTION composition: the real poll → ack → ingest path registers pricing with no switch.

function wireEvent(offer: LeaseOfferV1, seq: number, eventType: string, payload: Record<string, unknown>) {
  const base = {
    protocolVersion: 1,
    eventId: randomUUID(),
    organizationId: ORG,
    companyId: COMPANY,
    workerId: WORKER,
    jobId: offer.job.jobId,
    attempt: offer.job.attempt,
    leaseId: offer.leaseId,
    fenceToken: offer.fenceToken,
    seq,
    occurredAt: new Date().toISOString(),
    extensions: [] as unknown[],
    eventType,
    payload,
  };
  return { ...base, eventDigest: sha256(canonicalEventDigestInputV1(base as never)) };
}

function batchRequest(offer: LeaseOfferV1, events: Record<string, unknown>[]): EventUploadOperationRequestV1 {
  return {
    protocolVersion: 1,
    correlationId: randomUUID(),
    issuedAt: new Date().toISOString(),
    nonce: `ev-${randomUUID()}`,
    audience: "worker_run",
    idempotencyKey: randomUUID(),
    body: {
      protocolVersion: 1, organizationId: ORG, companyId: COMPANY, workerId: WORKER,
      jobId: offer.job.jobId, attempt: offer.job.attempt, leaseId: offer.leaseId,
      fenceToken: offer.fenceToken, events,
    },
  } as unknown as EventUploadOperationRequestV1;
}

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "JOB-016 production ingest composition (embedded PG)",
  () => {
    it("[acc 1 / acc 8 target] the REAL ingest prices a handed-off run: exactly one cost row with cost > 0 and one applied receipt", async () => {
      const f = guard();
      const { offer } = await f.activateLease(51);
      const outcomes: AcceptedUsageOutcome[] = [];
      const ingest = createJobEventIngestService({
        appDb: f.app.db,
        acceptedUsageTelemetry: { count: ({ outcome }) => { outcomes.push(outcome); } },
      });
      const events = [
        wireEvent(offer, 1, "attempt_started", { sandboxId: "sbx-j016" }),
        wireEvent(offer, 2, "usage", { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0, runtimeMillis: 42 }),
        wireEvent(offer, 3, "terminal", { status: "succeeded", exitCode: 0, errorCode: null, errorMessage: null }),
      ];
      const response = await ingest.ingest({ auth: auth("j016-ev-1"), request: batchRequest(offer, events) });
      expect(response.ack.status).toBe("accepted");
      expect(response.ack.acceptedThroughSeq).toBe(3);
      const rows = await f.admin`SELECT id, cost_cents FROM cost_events WHERE company_id = ${COMPANY}`;
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.cost_cents)).toBeGreaterThan(0);
      expect(await count("job_projection_receipts",
        `projection_kind = 'authoritative_cost' AND status = 'applied' AND target_aggregate_id = '${rows[0]!.id}'`)).toBe(1);
      expect(outcomes).toContain("priced");
      expect(outcomes).not.toContain("terminal_without_usage");
    });

    it("[Codex P2] a committed breach through the REAL ingest emits budget.exhausted exactly once, AFTER commit", async () => {
      const f = guard();
      const { offer } = await f.activateLease(53);
      await seedCompanyHardStop(COMPANY, 1);
      clearBudgetHooks();
      const seen: { scope: BudgetEnforcementScope; costRowsVisible: Promise<number> }[] = [];
      // The listener reads the ledger on a SEPARATE connection: a pre-commit emit would see 0.
      onBudgetExhausted((scope) => { seen.push({ scope, costRowsVisible: count("cost_events", "true") }); });
      try {
        const ingest = createJobEventIngestService({ appDb: f.app.db });
        const events = [
          wireEvent(offer, 1, "attempt_started", { sandboxId: "sbx-j016c" }),
          wireEvent(offer, 2, "usage", { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0, runtimeMillis: 1 }),
        ];
        const response = await ingest.ingest({ auth: auth("j016-ev-3"), request: batchRequest(offer, events) });
        expect(response.ack.status).toBe("accepted");
        expect(seen.map((entry) => entry.scope)).toEqual([
          { companyId: COMPANY, scopeType: "company", scopeId: COMPANY },
        ]);
        expect(await seen[0]!.costRowsVisible).toBe(1);
      } finally {
        clearBudgetHooks();
      }
    });

    it("[acc 4] a terminal with NO usage event emits the classified terminal_without_usage signal (log + count)", async () => {
      const f = guard();
      const { offer, seeded } = await f.activateLease(52);
      const outcomes: AcceptedUsageOutcome[] = [];
      const warn = vi.spyOn(logger, "warn");
      try {
        const ingest = createJobEventIngestService({
          appDb: f.app.db,
          acceptedUsageTelemetry: { count: ({ outcome }) => { outcomes.push(outcome); } },
        });
        const events = [
          wireEvent(offer, 1, "attempt_started", { sandboxId: "sbx-j016b" }),
          wireEvent(offer, 2, "terminal", { status: "succeeded", exitCode: 0, errorCode: null, errorMessage: null }),
        ];
        const response = await ingest.ingest({ auth: auth("j016-ev-2"), request: batchRequest(offer, events) });
        expect(response.ack.status).toBe("accepted");
        expect(outcomes).toEqual(["terminal_without_usage"]);
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({
            classification: "terminal_without_usage",
            organizationId: ORG, companyId: COMPANY, jobId: offer.job.jobId,
            attemptId: seeded.attemptId, terminalStatus: "succeeded", sourceKind: "one_shot",
          }),
          expect.any(String),
        );
        expect(await count("cost_events", "true")).toBe(0);
      } finally {
        warn.mockRestore();
      }
    });
  },
);

// =================================================================================================
// JOB-017 — the audit and output bridges registered on the SAME E3-D-ACC seam.
// Decisions: E3-D-AUDIT-SET (the named audited mutations), E3-D-OUTPUT-MAP (what an accepted
// output event projects to), E3-D-TERMINAL-WINNER (projectTerminalWinner retired), all in
// docs/replatform/epics/E3-job-control/decisions.md. Everything below runs the REAL repository
// `acceptEvent` (or the REAL poll -> ack -> ingest path) under a REAL fence.
// =================================================================================================

async function seedIssue(companyId: string, title = "JOB-017 task"): Promise<string> {
  const id = randomUUID();
  await guard().admin`INSERT INTO issues (id, company_id, title) VALUES (${id}, ${companyId}, ${title})`;
  return id;
}

function taskSourceFor(agentId: string, issueId: string): SubmitJobSource {
  return { kind: "task_run", runId: randomUUID(), issueId, assigneeAgentId: agentId };
}

/** A COMMITTED job_artifacts row for this attempt — the control plane's fenced-commit record. */
async function seedCommittedArtifact(fence: ActiveFenceRequest, identifier: string, kind = "workspace_patch"): Promise<string> {
  const id = randomUUID();
  await guard().admin`INSERT INTO job_artifacts
    (id, organization_id, job_id, identifier, kind, attempt, status, version_number, lease_id, fence_token)
    VALUES (${id}, ${fence.organizationId}, ${fence.jobId}, ${identifier}, ${kind}, ${fence.attemptNumber},
      'committed', 1, ${fence.leaseId}, ${fence.fence})`;
  return id;
}

const startedEv = (fence: ActiveFenceRequest, seq: number) =>
  acceptInput(fence, seq, "attempt_started", { sandboxId: `sbx-${seq}` });
const artifactEv = (fence: ActiveFenceRequest, seq: number, artifactId: string, kind = "workspace_patch") =>
  acceptInput(fence, seq, "artifact_prepared", { artifactId, kind });
const logEv = (fence: ActiveFenceRequest, seq: number) =>
  acceptInput(fence, seq, "log", { stream: "stdout", level: "info", message: "observation only" });

/**
 * Drive the REAL `acceptEvent` with the registrations the PRODUCTION ingest builds (pricing +
 * audit on every batch; output decided per batch by `resolveAcceptedOutputProjector`, inside the
 * same tenant transaction). `mutate` lets a test wrap a registration (the injected-failure cases).
 */
async function acceptWithBridges(
  fence: ActiveFenceRequest,
  events: AcceptEventInput[],
  opts: { mutate?: (p: AcceptedEventProjector) => AcceptedEventProjector } = {},
) {
  const prepared: string[] = [];
  const result = await runInTenant(guard().app.db, fence.organizationId, async (repos, tx) => {
    const projectors: AcceptedEventProjector[] = [
      createAcceptedUsagePricingProjector(),
      createAcceptedActivityAuditProjector({ onPreparedActivity: (id) => { prepared.push(id); } }),
    ];
    const output = await resolveAcceptedOutputProjector(tx, fence, events);
    if (output) projectors.push(output);
    return repos.jobControl.acceptEvent({
      ...fence,
      batch: { events, acceptedEventProjectors: opts.mutate ? projectors.map(opts.mutate) : projectors },
    });
  });
  return { result, prepared };
}

async function resetBridgeRows(): Promise<void> {
  const f = guard();
  await f.admin`DELETE FROM task_outputs`;
  await f.admin`DELETE FROM activity_log`;
  await f.admin`DELETE FROM issue_comments`;
  await f.admin`DELETE FROM job_artifacts`;
  await f.admin`DELETE FROM internal_agent_runs`;
  await f.admin`DELETE FROM issues`;
}

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "CLI-018 founder reads accepted distributed output content (embedded PG)", () => {
    beforeEach(async () => { if (fixture) await resetBridgeRows(); });

    async function projected(tenant = TENANT_A, bytes = Buffer.from("founder result bytes"),
      options: { kind?: "workspace_patch" | "other" | "browser_cookie_state" | "browser_storage_state"; contentType?: string; crew?: boolean; browser?: boolean; late?: boolean; redrive?: boolean } = {}) {
      const kind = options.kind ?? "workspace_patch";
      const contentType = options.contentType ?? "text/plain";
      const issueId = await seedIssue(tenant.companyId);
      const agentId = tenant === TENANT_A ? AGENT_A : AGENT_B;
      const crewRunId = randomUUID();
      const parent = options.browser ? await seedLeasedAttempt(tenant, taskSourceFor(agentId, issueId)) : null;
      const fence = await seedLeasedAttempt(tenant, options.browser
        ? { kind: "browser_request", browserRequestId: crewRunId, parentJobId: parent!.jobId }
        : options.crew
        ? { kind: "crew_run", crewRunId }
        : taskSourceFor(agentId, issueId));
      if (parent) {
        const preparation = { parentLeaseId: parent.leaseId, parentJobId: parent.jobId, parentAttemptId: parent.attemptId,
          targetId: parent.targetId, targetAuthorityKey: parent.targetAuthorityKey, targetGeneration: parent.targetGeneration,
          profileHash: parent.profileHash, providerConstraintHash: parent.providerConstraintHash };
        await guard().admin`UPDATE jobs SET source_identity = ${crewRunId}, policy_snapshot = policy_snapshot || ${guard().admin.json({ browserPreparation: preparation })} WHERE id = ${fence.jobId}`;
      }
      if (options.crew || options.browser) {
        await guard().admin`INSERT INTO internal_agent_runs
          (id, company_id, agent_id, trigger_type, trigger_source, related_entity_type, related_entity_id,
           execution_owner, distributed_job_id, distributed_attempt_id)
          VALUES (${crewRunId}, ${tenant.companyId}, ${agentId}, 'event', ${options.browser ? 'browser_request' : 'task'}, 'task', ${issueId},
            'distributed', ${fence.jobId}, ${fence.attemptId})`;
      }
      if (options.late) {
        await guard().admin`UPDATE internal_agent_runs SET status = 'completed' WHERE id = ${crewRunId}`;
      }
      const identifier = randomUUID();
      const objectKey = expectedAttemptObjectPrefix({ organizationId: tenant.organizationId, jobId: fence.jobId, attempt: 1 }) + "founder.txt";
      const digest = createHash("sha256").update(bytes).digest("hex");
      const committed = await runInTenant(guard().app.db, tenant.organizationId, (repos) => repos.jobControl.commitArtifactVersion({
        ...fence, identifier, objectKey, contentType, kind, sensitivity: "sensitive",
        retention: "standard", declaredSizeBytes: bytes.length, actualSizeBytes: bytes.length,
        declaredSha256: digest, actualSha256: digest, prefixValid: true, tenantValid: true,
      }));
      const events = [artifactEv(fence, 1, identifier, kind), terminal(fence, 2)];
      const accepted = await acceptWithBridges(fence, events, options.redrive ? {
        mutate: (projector) => projector.projectionKind !== "output_projection" ? projector : {
          ...projector, apply: async (ctx) => { await projector.apply(ctx); throw new Error("output savepoint rollback"); },
        },
      } : {});
      if (options.redrive) {
        expect(accepted.result.acceptedEventProjections?.find((p) => p.projectionKind === "output_projection")?.outcome).toBe("pending");
        expect(await count("task_outputs", `issue_id = '${issueId}'`)).toBe(0);
        const [receipt] = await guard().admin`SELECT id FROM job_projection_receipts WHERE job_id = ${fence.jobId} AND projection_kind = 'output_projection'`;
        expect(await redrivePendingProjection(guard().app.db, { organizationId: tenant.organizationId, receiptId: receipt!.id })).toMatchObject({ status: "redriven" });
        expect(await redrivePendingProjection(guard().app.db, { organizationId: tenant.organizationId, receiptId: receipt!.id })).toEqual({ status: "not_pending" });
      } else {
        expect(accepted.result.acceptedEventProjections?.find((p) => p.projectionKind === "output_projection")?.outcome).toBe("applied");
      }
      const [output] = await guard().admin`SELECT id FROM task_outputs WHERE external_id = ${committed.id}`;
      const storage: StorageProvider = {
        id: "s3", putObject: vi.fn(), deleteObject: vi.fn(),
        headObject: vi.fn(async () => ({ exists: true, contentLength: bytes.length, checksumSha256: digest, etag: "pinned" })),
        getObject: vi.fn(async () => ({ stream: Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]), contentLength: bytes.length, etag: "pinned" })),
      };
      const reader = createTaskOutputContentService({ appDb: guard().app.db, storage });
      return { issueId, crewRunId, fence, artifactId: committed.id, outputId: output!.id as string, storage, reader, bytes, objectKey };
    }

    function appFor(reader: ReturnType<typeof createTaskOutputContentService>, companyId = COMPANY) {
      const app = express();
      app.use((req, _res, next) => { req.actor = { type: "board", source: "session", userId: USER_A, companyIds: [companyId] }; next(); });
      app.use("/api", taskOutputRoutes(guard().app.db, reader));
      app.use((error: { status?: number; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(error.status ?? 500).json({ error: error.message ?? "Internal Server Error" });
      });
      return app;
    }

    it("projects browser child evidence to its durable task and exposes the authorized content link", async () => {
      const p = await projected(TENANT_A, Buffer.from("browser screenshot evidence"), { browser: true, kind: "other" });
      const [output] = await guard().admin`SELECT issue_id FROM task_outputs WHERE id = ${p.outputId}`;
      expect(output.issue_id).toBe(p.issueId);
      const operations = createJobOperationsService({ appDb: guard().app.db, operatorDb: guard().app.db });
      expect((await operations.getJobDetail(ORG, COMPANY, p.fence.jobId))?.artifacts.find(a => a.id === p.artifactId)).toMatchObject({ outputId: p.outputId });
      const response = await request(appFor(p.reader)).get(`/api/task-outputs/${p.outputId}/content`);
      expect(response.status).toBe(200); expect(response.text).toBe("browser screenshot evidence");
    });

    it.each(["browser_cookie_state", "browser_storage_state"] as const)("refuses an otherwise valid committed %s output", async kind => {
      const p = await projected(TENANT_A, Buffer.from("restricted session state"), { browser: true, kind });
      await expect(p.reader.openContent(p.outputId, COMPANY)).rejects.toMatchObject({ status: 404 });
      expect(p.storage.getObject).not.toHaveBeenCalled();
      const operations = createJobOperationsService({ appDb: guard().app.db, operatorDb: guard().app.db });
      expect((await operations.getJobDetail(ORG, COMPANY, p.fence.jobId))?.artifacts.find(a => a.id === p.artifactId)).not.toHaveProperty("outputId");
    });

    it.each(["foreign_task", "foreign_company", "wrong_job", "owner", "trigger", "receipt", "receipt_digest", "output_task", "output_artifact", "pending", "quarantine", "expired", "cookie"])("refuses browser evidence content and links after %s corruption", async (kind) => {
      const p = await projected(TENANT_A, Buffer.from("browser evidence"), { browser: true, kind: "other" });
      const db = guard().admin;
      if (kind === "foreign_task") await db`UPDATE internal_agent_runs SET related_entity_id = ${await seedIssue(COMPANY_SIBLING)} WHERE id = ${p.crewRunId}`;
      if (kind === "foreign_company") await db`UPDATE internal_agent_runs SET company_id = ${COMPANY_SIBLING} WHERE id = ${p.crewRunId}`;
      if (kind === "wrong_job") await db`UPDATE internal_agent_runs SET distributed_job_id = NULL WHERE id = ${p.crewRunId}`;
      if (kind === "owner") await db`UPDATE internal_agent_runs SET execution_owner = 'legacy' WHERE id = ${p.crewRunId}`;
      if (kind === "trigger") await db`UPDATE internal_agent_runs SET trigger_source = 'task' WHERE id = ${p.crewRunId}`;
      if (kind === "receipt") await db`UPDATE job_projection_receipts SET status = 'pending', applied_at = NULL WHERE job_id = ${p.fence.jobId} AND projection_kind = 'output_projection'`;
      if (kind === "receipt_digest") await db`UPDATE job_projection_receipts SET source_digest = ${"f".repeat(64)} WHERE job_id = ${p.fence.jobId} AND projection_kind = 'output_projection'`;
      if (kind === "output_task") await db`UPDATE task_outputs SET issue_id = ${await seedIssue(COMPANY)} WHERE id = ${p.outputId}`;
      if (kind === "output_artifact") await db`UPDATE task_outputs SET external_id = ${randomUUID()} WHERE id = ${p.outputId}`;
      if (kind === "pending") await db`UPDATE job_artifacts SET status = 'granted' WHERE id = ${p.artifactId}`;
      if (kind === "quarantine") await db`UPDATE job_artifacts SET apply_status = 'conflict_quarantined' WHERE id = ${p.artifactId}`;
      if (kind === "expired") await db`UPDATE job_artifacts SET expires_at = now() - interval '1 minute' WHERE id = ${p.artifactId}`;
      if (kind === "cookie") await db`UPDATE job_artifacts SET kind = 'browser_cookie_state' WHERE id = ${p.artifactId}`;
      await expect(p.reader.openContent(p.outputId, COMPANY)).rejects.toMatchObject({ status: 404 });
      const operations = createJobOperationsService({ appDb: guard().app.db, operatorDb: guard().app.db });
      expect((await operations.getJobDetail(ORG, COMPANY, p.fence.jobId))?.artifacts.find(a => a.id === p.artifactId)).not.toHaveProperty("outputId");
    });

    it("delivers crew JSON output to its durable task and downloads it after terminal", async () => {
      const bytes = Buffer.from('{"result":"crew output"}');
      const p = await projected(TENANT_A, bytes, { crew: true, kind: "other", contentType: "application/json" });
      const [row] = await guard().admin`SELECT issue_id, created_by_agent_id, created_by_run_id FROM task_outputs WHERE id = ${p.outputId}`;
      expect(row).toMatchObject({ issue_id: p.issueId, created_by_agent_id: AGENT_A, created_by_run_id: null });
      const response = await request(appFor(p.reader)).get(`/api/task-outputs/${p.outputId}/content`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ result: "crew output" });
      expect(await count("task_outputs", `external_id = '${p.artifactId}'`)).toBe(1);
    });

    it.each(["foreign_task", "foreign_agent", "job", "owner", "entity_type"])("rejects crew content with invalid durable binding: %s", async (binding) => {
      const p = await projected(TENANT_A, Buffer.from("crew"), { crew: true });
      if (binding === "foreign_task") {
        const foreignIssueId = await seedIssue(COMPANY_B);
        await guard().admin`UPDATE internal_agent_runs SET related_entity_id = ${foreignIssueId} WHERE id = ${p.crewRunId}`;
      }
      if (binding === "foreign_agent") await guard().admin`UPDATE internal_agent_runs SET agent_id = ${AGENT_B} WHERE id = ${p.crewRunId}`;
      if (binding === "job") await guard().admin`UPDATE internal_agent_runs SET distributed_job_id = ${randomUUID()} WHERE id = ${p.crewRunId}`;
      if (binding === "owner") await guard().admin`UPDATE internal_agent_runs SET execution_owner = 'legacy' WHERE id = ${p.crewRunId}`;
      if (binding === "entity_type") await guard().admin`UPDATE internal_agent_runs SET related_entity_type = 'discussion' WHERE id = ${p.crewRunId}`;
      const response = await request(appFor(p.reader)).get(`/api/task-outputs/${p.outputId}/content`);
      expect(response.status).toBe(404);
      expect(p.storage.getObject).not.toHaveBeenCalled();
    });

    it("isolates two crew tenants and keeps earlier output readable after an attempt retry", async () => {
      const a = await projected(TENANT_A, Buffer.from("tenant A"), { crew: true });
      const b = await projected(TENANT_B, Buffer.from("tenant B"), { crew: true });
      await guard().admin`UPDATE internal_agent_runs SET distributed_attempt_id = ${randomUUID()} WHERE id = ${a.crewRunId}`;
      await guard().admin`UPDATE task_outputs SET metadata = ${guard().admin.json({ crewRunId: b.crewRunId, objectKey: b.objectKey })} WHERE id = ${a.outputId}`;
      expect((await request(appFor(a.reader)).get(`/api/task-outputs/${a.outputId}/content`)).text).toBe("tenant A");
      expect((await request(appFor(b.reader, COMPANY_B)).get(`/api/task-outputs/${b.outputId}/content`)).text).toBe("tenant B");
      const forbidden = await request(appFor(a.reader)).get(`/api/task-outputs/${b.outputId}/content`);
      expect([403, 404]).toContain(forbidden.status);
    });

    it.each([false, true])("delivers output for a finished crew run, including projection recovery (redrive=%s)", async (redrive) => {
      const p = await projected(TENANT_A, Buffer.from("late output"), { crew: true, late: true, redrive });
      expect(await count("task_outputs", `issue_id = '${p.issueId}'`)).toBe(1);
      const response = await request(appFor(p.reader)).get(`/api/task-outputs/${p.outputId}/content`);
      expect(response.status).toBe(200);
      expect(response.text).toBe("late output");
    });

    it("recovers a late crew file into the same Discussion entry through separate owner and tenant pools", async () => {
      const p = await projected(TENANT_A, Buffer.from("late discussion file"), { crew: true, late: true, redrive: true });
      const threadId = randomUUID();
      await guard().admin`INSERT INTO discussions (id, company_id, created_by) VALUES (${threadId}, ${COMPANY}, ${USER_A})`;
      await guard().admin`UPDATE issues SET source_discussion_id = ${threadId} WHERE id = ${p.issueId}`;
      const delivery = { db: ownerDb(), companyId: COMPANY, issueId: p.issueId, runId: p.crewRunId!, agentId: AGENT_A };
      await deliverCrewRunResult(delivery, { synthesize: async (input) => (await synthesizeThreadDeliveryRefs(input)).filter((ref) => ref.kind === "task") });
      const [before] = await guard().admin`SELECT id FROM discussion_entries WHERE discussion_id = ${threadId}`;
      expect(before).toBeDefined();
      const recovery = createCrewResultRecovery({ ownerDb: ownerDb(), appDb: guard().app.db });
      await recovery.tick();
      // Restart resets the cursor; durable state and parent serialization retain one entry.
      await createCrewResultRecovery({ ownerDb: ownerDb(), appDb: guard().app.db }).tick();
      const entries = await guard().admin`SELECT id, output_refs FROM discussion_entries WHERE discussion_id = ${threadId}`;
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(before.id);
      expect(entries[0].output_refs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "output", id: p.outputId })]));
      const [thread] = await guard().admin`SELECT entry_count, entry_seq FROM discussions WHERE id = ${threadId}`;
      expect(thread).toMatchObject({ entry_count: 1, entry_seq: 1 });
      const [audit] = await guard().admin`SELECT count(*)::int AS n FROM activity_log WHERE entity_id = ${before.id} AND action = 'discussion.entry.results_refreshed'`;
      expect(audit.n).toBe(1);
      expect((await request(appFor(p.reader)).get(`/api/task-outputs/${p.outputId}/content`)).text).toBe("late discussion file");
    });

    it("keeps an output pending until the durable crew handoff binding is available", async () => {
      const issueId = await seedIssue(COMPANY);
      const crewRunId = randomUUID();
      const fence = await seedLeasedAttempt(TENANT_A, { kind: "crew_run", crewRunId });
      const identifier = randomUUID();
      await seedCommittedArtifact(fence, identifier);
      const { result } = await acceptWithBridges(fence, [artifactEv(fence, 1, identifier), terminal(fence, 2)]);
      expect(result.acceptedEventProjections?.find((p) => p.projectionKind === "output_projection")).toMatchObject({ outcome: "pending" });
      expect(await count("task_outputs", "true")).toBe(0);
      await guard().admin`INSERT INTO internal_agent_runs
        (id, company_id, agent_id, trigger_type, trigger_source, related_entity_type, related_entity_id,
         execution_owner, distributed_job_id, distributed_attempt_id)
        VALUES (${crewRunId}, ${COMPANY}, ${AGENT_A}, 'event', 'task', 'task', ${issueId},
          'distributed', ${fence.jobId}, ${fence.attemptId})`;
      const [receipt] = await guard().admin`SELECT id FROM job_projection_receipts WHERE job_id = ${fence.jobId} AND projection_kind = 'output_projection'`;
      expect(await redrivePendingProjection(guard().app.db, { organizationId: ORG, receiptId: receipt!.id })).toMatchObject({ status: "redriven" });
      expect(await count("task_outputs", `issue_id = '${issueId}'`)).toBe(1);
    });

    it("streams the committed bytes after terminal, expired lease and organization rollout-off, ignoring mutable metadata and URL", async () => {
      const p = await projected();
      await guard().admin`UPDATE leases SET status = 'expired', ack_deadline = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE id = ${p.fence.leaseId}`;
      await guard().admin`UPDATE task_outputs SET url = 'https://untrusted.invalid/stolen', metadata = ${guard().admin.json({ organizationId: ORG_B, objectKey: "foreign", quarantined: false })} WHERE id = ${p.outputId}`;
      vi.stubEnv("AOA_DISTRIBUTED_EXECUTION_ROLLOUT", "{}");
      const res = await request(appFor(p.reader)).get(`/api/task-outputs/${p.outputId}/content`);
      vi.unstubAllEnvs();
      expect(res.status).toBe(200);
      expect(res.text).toBe(p.bytes.toString());
      const [artifact] = await guard().admin`SELECT identifier FROM job_artifacts WHERE id = ${p.artifactId}`;
      expect(res.headers["content-disposition"]).toContain(`filename="${artifact!.identifier}"`);
      expect(res.headers["cache-control"]).toBe("private, no-store");
      expect(p.storage.getObject).toHaveBeenCalledWith({ objectKey: p.objectKey });
      const [audit] = await guard().admin`SELECT actor_id, action, details FROM activity_log WHERE action = 'task_output.content_read'`;
      expect(audit).toMatchObject({ actor_id: USER_A, action: "task_output.content_read", details: { artifactId: p.artifactId, jobId: p.fence.jobId, attempt: 1 } });
      expect(await count("job_attempts", `id = '${p.fence.attemptId}' AND status = 'succeeded'`)).toBe(1);
    });

    it("projects the composed worker's other artifact kind and downloads byte-exact useful-work JSON", async () => {
      const result = { companyId: COMPANY, referenceTaskId: randomUUID(), referenceTitle: "M1b reference café ∆" };
      const bytes = Buffer.from(JSON.stringify(result, null, 2) + "\n", "utf8");
      const p = await projected(TENANT_A, bytes, { kind: "other", contentType: "application/json" });
      const [artifact] = await guard().admin`SELECT kind, content_type, size_bytes, sha256 FROM job_artifacts WHERE id = ${p.artifactId}`;
      expect(artifact).toMatchObject({ kind: "other", content_type: "application/json",
        sha256: createHash("sha256").update(bytes).digest("hex") });
      expect(Number(artifact!.size_bytes)).toBe(bytes.length);
      const [output] = await guard().admin`SELECT provider, external_id, metadata FROM task_outputs WHERE id = ${p.outputId}`;
      expect(output).toMatchObject({ provider: "aoa_distributed_job", external_id: p.artifactId,
        metadata: { artifactKind: "other", jobId: p.fence.jobId, attemptId: p.fence.attemptId } });
      const res = await request(appFor(p.reader)).get(`/api/task-outputs/${p.outputId}/content`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^application\/json(?:;|$)/);
      expect(Number(res.headers["content-length"])).toBe(bytes.length);
      expect(res.headers["content-disposition"]).toContain("attachment;");
      expect(Buffer.from(res.text, "utf8")).toEqual(bytes);
      expect(res.body).toEqual(result);
      expect(createHash("sha256").update(Buffer.from(res.text, "utf8")).digest("hex")).toBe(artifact!.sha256);
      expect(p.storage.getObject).toHaveBeenCalledWith({ objectKey: p.objectKey });
    });

    it("cannot retrieve another company's projected output even with matching forged metadata", async () => {
      const p = await projected(TENANT_B);
      const res = await request(appFor(p.reader)).get(`/api/task-outputs/${p.outputId}/content`);
      expect(res.status).toBe(404);
      await expect(p.reader.openContent(p.outputId, COMPANY)).rejects.toMatchObject({ status: 404 });
      expect(p.storage.headObject).not.toHaveBeenCalled();
    });

    it("enforces the company predicate within the same organization", async () => {
      const p = await projected();
      await expect(p.reader.openContent(p.outputId, COMPANY_SIBLING)).rejects.toMatchObject({ status: 404 });
      expect(p.storage.headObject).not.toHaveBeenCalled();
    });

    it("reads a valid empty artifact and rejects a contradictory zero-byte committed digest before storage", async () => {
      const p = await projected(TENANT_A, Buffer.alloc(0));
      const res = await request(appFor(p.reader)).get(`/api/task-outputs/${p.outputId}/content`);
      expect(res.status).toBe(200);
      expect(res.headers["content-length"]).toBe("0");
      vi.mocked(p.storage.headObject).mockClear();
      await guard().admin`UPDATE job_artifacts SET sha256 = ${"0".repeat(64)} WHERE id = ${p.artifactId}`;
      await expect(p.reader.openContent(p.outputId, COMPANY)).rejects.toMatchObject({ status: 404 });
      expect(p.storage.headObject).not.toHaveBeenCalled();
    });

    it("requires a real applied projection receipt, not a copied task-output row", async () => {
      const p = await projected();
      const forgedId = randomUUID();
      const otherIssueId = await seedIssue(COMPANY);
      await guard().admin`INSERT INTO task_outputs (id, company_id, issue_id, type, provider, external_id, title, metadata)
        SELECT ${forgedId}, company_id, ${otherIssueId}, type, provider, external_id, title, metadata FROM task_outputs WHERE id = ${p.outputId}`;
      await expect(p.reader.openContent(forgedId, COMPANY)).rejects.toMatchObject({ status: 404 });
      expect(p.storage.headObject).not.toHaveBeenCalled();
    });

    it.each(["pending", "digest", "fence", "source_issue", "external_id", "malformed_external_id", "quarantined", "conflict_quarantined", "expired", "incomplete", "prefix"])(
      "refuses %s provenance or artifact state before storage", async (kind) => {
        const p = await projected();
        const f = guard();
        if (kind === "pending") await f.admin`UPDATE job_projection_receipts SET status = 'pending', applied_at = NULL WHERE target_aggregate_id = ${p.outputId}`;
        if (kind === "digest") await f.admin`UPDATE job_projection_receipts SET source_digest = ${"0".repeat(64)} WHERE target_aggregate_id = ${p.outputId}`;
        if (kind === "fence") await f.admin`UPDATE job_artifacts SET fence_token = 'foreign-fence' WHERE id = ${p.artifactId}`;
        if (kind === "source_issue") await f.admin`UPDATE jobs SET source_intent = ${f.admin.json(taskSourceFor(AGENT_A, randomUUID()) as never)} WHERE id = ${p.fence.jobId}`;
        if (kind === "external_id" || kind === "malformed_external_id") await f.admin`UPDATE task_outputs SET external_id = ${kind === "external_id" ? randomUUID() : "not-a-uuid"} WHERE id = ${p.outputId}`;
        if (kind === "quarantined") await f.admin`UPDATE job_artifacts SET status = 'quarantined' WHERE id = ${p.artifactId}`;
        if (kind === "conflict_quarantined") await f.admin`UPDATE job_artifacts SET apply_status = 'conflict_quarantined' WHERE id = ${p.artifactId}`;
        if (kind === "expired") await f.admin`UPDATE job_artifacts SET expires_at = now() - interval '1 second' WHERE id = ${p.artifactId}`;
        if (kind === "incomplete") await f.admin`UPDATE job_artifacts SET sha256 = NULL WHERE id = ${p.artifactId}`;
        if (kind === "prefix") await f.admin`UPDATE job_artifacts SET object_key = 'quarantine/foreign' WHERE id = ${p.artifactId}`;
        await expect(p.reader.openContent(p.outputId, COMPANY)).rejects.toMatchObject({ status: 404 });
        expect(p.storage.headObject).not.toHaveBeenCalled();
      },
    );

    it.each(["missing", "checksum", "size", "etag", "head_failure", "get_failure"])("refuses a storage %s mismatch before returning a body", async (kind) => {
      const p = await projected();
      if (kind === "missing") vi.mocked(p.storage.headObject).mockResolvedValue({ exists: false });
      if (kind === "checksum") vi.mocked(p.storage.headObject).mockResolvedValue({ exists: true, contentLength: p.bytes.length });
      if (kind === "size") vi.mocked(p.storage.headObject).mockResolvedValue({ exists: true, contentLength: p.bytes.length + 1, checksumSha256: createHash("sha256").update(p.bytes).digest("hex") });
      const stream = Readable.from([p.bytes]);
      if (kind === "etag") vi.mocked(p.storage.getObject).mockResolvedValue({ stream, contentLength: p.bytes.length, etag: "changed" });
      if (kind === "head_failure") vi.mocked(p.storage.headObject).mockRejectedValue(new Error("private provider endpoint"));
      if (kind === "get_failure") vi.mocked(p.storage.getObject).mockRejectedValue(new Error("private provider endpoint"));
      await expect(p.reader.openContent(p.outputId, COMPANY)).rejects.toMatchObject({ status: kind === "missing" ? 404 : 502 });
      if (kind === "head_failure" || kind === "get_failure") await expect(p.reader.openContent(p.outputId, COMPANY)).rejects.toThrow("Artifact storage unavailable");
      if (kind === "etag") expect(stream.destroyed).toBe(true);
      else if (kind !== "get_failure") expect(p.storage.getObject).not.toHaveBeenCalled();
    });
  },
);

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "JOB-017 audit + output bridges on the E3-D-ACC seam (embedded PG)",
  () => {
    beforeEach(async () => { if (fixture) await resetBridgeRows(); });

    it("[acc 1] each named accepted mutation (attempt_started, terminal) writes exactly ONE activity row and ONE applied activity_audit receipt, in the ingest transaction", async () => {
      const f = guard();
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const s = startedEv(fence, 1);
      const t = terminal(fence, 2);
      const { result, prepared } = await acceptWithBridges(fence, [s, t]);

      expect(result.ingest?.status).toBe("accepted");
      expect(result.acceptedEventProjections?.map((p) => [p.projectionKind, p.outcome])).toEqual([
        ["activity_audit", "applied"],
        ["activity_audit", "applied"],
      ]);
      const rows = await f.admin`SELECT id, action, company_id, entity_type, entity_id, actor_type, actor_id, run_id, details
        FROM activity_log ORDER BY action`;
      expect(rows.map((r) => r.action)).toEqual(["job.attempt_started", "job.attempt_terminal"]);
      for (const row of rows) {
        expect(row).toMatchObject({
          company_id: COMPANY, entity_type: "job", entity_id: fence.jobId,
          actor_type: "system", actor_id: `worker:${fence.workerId}`, run_id: null,
        });
        expect((row.details as Record<string, unknown>).organizationId).toBe(ORG);
        expect((row.details as Record<string, unknown>).attemptId).toBe(fence.attemptId);
      }
      const term = rows.find((r) => r.action === "job.attempt_terminal")!;
      expect((term.details as Record<string, unknown>).terminalStatus).toBe("succeeded");
      // One applied receipt per audited event, each pointing at ITS activity row.
      for (const ev of [s, t]) {
        const [receipt] = await f.admin`SELECT status, aggregate_kind, target_aggregate_id, organization_id, company_id
          FROM job_projection_receipts WHERE projection_kind = 'activity_audit'
            AND source_identity = ${`activity:${COMPANY}:${ev.eventId}`}`;
        expect(receipt).toMatchObject({ status: "applied", aggregate_kind: "activity_log", organization_id: ORG, company_id: COMPANY });
        expect(rows.map((r) => r.id)).toContain(receipt!.target_aggregate_id);
      }
      expect([...prepared].sort()).toEqual([s.eventId, t.eventId].sort());
      // The terminal was applied AFTER its audit, in the same transaction, without a throw.
      expect(await count("job_attempts", `id = '${fence.attemptId}' AND status = 'succeeded'`)).toBe(1);
    });

    it("[acc 1 replay] a replayed batch writes NO second activity row and no second receipt", async () => {
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const batch = [startedEv(fence, 1), logEv(fence, 2)];
      await acceptWithBridges(fence, batch);
      expect(await count("activity_log", "true")).toBe(1);
      const replay = await acceptWithBridges(fence, batch);
      expect(replay.result.ingest?.status).toBe("accepted");
      expect(replay.result.acceptedEventProjections ?? []).toEqual([]);
      expect(await count("activity_log", "true")).toBe(1);
      expect(await count("job_projection_receipts", "projection_kind = 'activity_audit'")).toBe(1);
    });

    it("[acc 1 rejected/stale/observation] a rejected batch, a stale fence and an observation-only event write NO activity row", async () => {
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      // (a) observation only: log/progress are not accepted product mutations.
      const obs = await acceptWithBridges(fence, [logEv(fence, 1)]);
      expect(obs.result.ingest?.status).toBe("accepted");
      expect(await count("activity_log", "true")).toBe(0);
      // (b) REJECTED: a digest mismatch rejects the whole batch before any write.
      const bad = startedEv(fence, 2);
      const rejected = await acceptWithBridges(fence, [{ ...bad, suppliedDigest: "0".repeat(64) }]);
      expect(rejected.result.ingest?.status).toBe("hash_mismatch");
      // (c) STALE: a wrong fence token is refused by the guard before any write.
      await expect(acceptWithBridges({ ...fence, fence: `${fence.fence}-stale` }, [startedEv(fence, 2)]))
        .rejects.toThrow();
      expect(await count("activity_log", "true")).toBe(0);
      expect(await count("job_projection_receipts", "projection_kind = 'activity_audit'")).toBe(0);
      // Positive control: the SAME kind of event, accepted under the live fence, IS audited.
      await acceptWithBridges(fence, [startedEv(fence, 2)]);
      expect(await count("activity_log", `action = 'job.attempt_started'`)).toBe(1);
    });

    it("[acc 2] an output event and the terminal event in ONE batch yield ONE task_outputs row with its output_projection receipt, and no attempt_terminal throw", async () => {
      const f = guard();
      const issueId = await seedIssue(COMPANY);
      const fence = await seedLeasedAttempt(TENANT_A, taskSourceFor(AGENT_A, issueId));
      const artifactIdentifier = randomUUID();
      const jobArtifactId = await seedCommittedArtifact(fence, artifactIdentifier);
      const a = artifactEv(fence, 1, artifactIdentifier);
      const t = terminal(fence, 2);
      const { result } = await acceptWithBridges(fence, [a, t]);

      expect(result.ingest?.status).toBe("accepted");
      expect(result.acceptedEventProjections?.find((p) => p.projectionKind === "output_projection")?.outcome).toBe("applied");
      const outputs = await f.admin`SELECT id, company_id, issue_id, type, provider, external_id, is_primary, created_by_agent_id, metadata
        FROM task_outputs`;
      expect(outputs).toHaveLength(1);
      expect(outputs[0]).toMatchObject({
        company_id: COMPANY, issue_id: issueId, type: "artifact", provider: "aoa_distributed_job",
        external_id: jobArtifactId, is_primary: false, created_by_agent_id: AGENT_A,
      });
      expect((outputs[0]!.metadata as Record<string, unknown>).attemptId).toBe(fence.attemptId);
      const [receipt] = await f.admin`SELECT status, aggregate_kind, target_aggregate_id, job_id, attempt_id
        FROM job_projection_receipts WHERE projection_kind = 'output_projection'
          AND source_identity = ${`output:${COMPANY}:${a.eventId}`}`;
      expect(receipt).toMatchObject({
        status: "applied", aggregate_kind: "task_outputs", target_aggregate_id: outputs[0]!.id,
        job_id: fence.jobId, attempt_id: fence.attemptId,
      });
      expect(await count("job_attempts", `id = '${fence.attemptId}' AND status = 'succeeded'`)).toBe(1);
    });

    it("[E3-D-OUTPUT-MAP] provenance is fail-closed: an announced artifact that was never COMMITTED projects nothing and leaves a surfaced pending receipt", async () => {
      const issueId = await seedIssue(COMPANY);
      const fence = await seedLeasedAttempt(TENANT_A, taskSourceFor(AGENT_A, issueId));
      const a = artifactEv(fence, 1, randomUUID());
      const { result } = await acceptWithBridges(fence, [a, terminal(fence, 2)]);
      expect(result.ingest?.status).toBe("accepted");
      expect(result.acceptedEventProjections?.find((p) => p.projectionKind === "output_projection")).toMatchObject({
        outcome: "pending", reason: "ACCEPTED_OUTPUT_ARTIFACT_NOT_COMMITTED",
      });
      expect(await count("task_outputs", "true")).toBe(0);
      expect(await count("job_projection_receipts", `projection_kind = 'output_projection' AND status = 'pending'`)).toBe(1);
      expect(await count("job_attempts", `id = '${fence.attemptId}' AND status = 'succeeded'`)).toBe(1);
    });

    it("[E3-D-OUTPUT-MAP] a source with NO task (one_shot) registers no output projection: no row and no receipt", async () => {
      const fence = await seedLeasedAttempt(TENANT_A, { kind: "one_shot", operationId: randomUUID(), operationKind: "extraction" } as SubmitJobSource);
      const identifier = randomUUID();
      await seedCommittedArtifact(fence, identifier);
      const { result } = await acceptWithBridges(fence, [artifactEv(fence, 1, identifier)]);
      expect(result.ingest?.status).toBe("accepted");
      expect(result.acceptedEventProjections ?? []).toEqual([]);
      expect(await count("task_outputs", "true")).toBe(0);
      expect(await count("job_projection_receipts", `projection_kind = 'output_projection'`)).toBe(0);
    });

    it("[acc 3] a projector failure leaves the append COMMITTED, rolls back the projector's own write, and surfaces a pending receipt (audit and output)", async () => {
      const issueId = await seedIssue(COMPANY);
      const fence = await seedLeasedAttempt(TENANT_A, taskSourceFor(AGENT_A, issueId));
      const identifier = randomUUID();
      await seedCommittedArtifact(fence, identifier);
      // Each audit/output registration WRITES its row through the real core, then throws.
      const failAfterWrite = (p: AcceptedEventProjector): AcceptedEventProjector =>
        p.projectionKind === "authoritative_cost" ? p : {
          projectionKind: p.projectionKind,
          aggregateKind: p.aggregateKind,
          sourceIdentity: (e, fe) => p.sourceIdentity(e, fe),
          apply: async (ctx) => { await p.apply(ctx); throw new Error("injected after the write"); },
        };
      const { result, prepared } = await acceptWithBridges(
        fence,
        [startedEv(fence, 1), artifactEv(fence, 2, identifier), terminal(fence, 3)],
        { mutate: failAfterWrite },
      );
      expect(result.ingest?.status).toBe("accepted");
      expect(result.ingest?.acceptedThroughSeq).toBe(3);
      expect(result.acceptedEventProjections?.map((p) => p.outcome)).toEqual(["pending", "pending", "pending"]);
      expect(await count("job_events", `attempt_id = '${fence.attemptId}'`)).toBe(3);
      expect(await count("activity_log", "true")).toBe(0);
      expect(await count("task_outputs", "true")).toBe(0);
      expect(await count("job_projection_receipts",
        `status = 'pending' AND aggregate_kind = 'job_attempts' AND target_aggregate_id = '${fence.attemptId}'`)).toBe(3);
      expect(await count("job_attempts", `id = '${fence.attemptId}' AND status = 'succeeded'`)).toBe(1);
      // The prepared events were handed over, but the ingest publishes only for `applied`.
      expect(prepared).toHaveLength(2);
    });

    it("[acc 5 / F10] two Organizations side by side: every activity row, task output and receipt carries the attempt's OWN Organization and Company, and neither tenant's reads see the other's", async () => {
      const f = guard();
      const issueA = await seedIssue(COMPANY);
      const issueB = await seedIssue(COMPANY_B);
      const fenceA = await seedLeasedAttempt(TENANT_A, taskSourceFor(AGENT_A, issueA));
      const fenceB = await seedLeasedAttempt(TENANT_B, taskSourceFor(AGENT_B, issueB));
      const idA = randomUUID();
      const idB = randomUUID();
      await seedCommittedArtifact(fenceA, idA);
      await seedCommittedArtifact(fenceB, idB);
      await acceptWithBridges(fenceA, [startedEv(fenceA, 1), artifactEv(fenceA, 2, idA), terminal(fenceA, 3)]);
      await acceptWithBridges(fenceB, [startedEv(fenceB, 1), artifactEv(fenceB, 2, idB), terminal(fenceB, 3)]);

      const activity = await f.admin`SELECT company_id, entity_id FROM activity_log`;
      expect(activity.filter((r) => r.company_id === COMPANY).map((r) => r.entity_id)).toEqual([fenceA.jobId, fenceA.jobId]);
      expect(activity.filter((r) => r.company_id === COMPANY_B).map((r) => r.entity_id)).toEqual([fenceB.jobId, fenceB.jobId]);
      const outputs = await f.admin`SELECT company_id, issue_id FROM task_outputs`;
      expect(outputs.map((r) => `${r.company_id}:${r.issue_id}`).sort())
        .toEqual([`${COMPANY}:${issueA}`, `${COMPANY_B}:${issueB}`].sort());
      const receipts = await f.admin`SELECT organization_id, company_id, job_id FROM job_projection_receipts
        WHERE projection_kind IN ('activity_audit', 'output_projection')`;
      expect(receipts).toHaveLength(6);
      for (const r of receipts) {
        expect([r.organization_id, r.company_id]).toEqual(r.job_id === fenceA.jobId ? [ORG, COMPANY] : [ORG_B, COMPANY_B]);
      }
      // Tenant READS: Organization B's tenant transaction sees none of A's receipts (forced RLS) but
      // does see its own (the same-tenant control), and A's task shows only A's output.
      const seenByB = await runInTenant(f.app.db, ORG_B, async (_repos, tx) => ({
        foreign: await tx.select({ id: jobProjectionReceipts.id }).from(jobProjectionReceipts)
          .where(eq(jobProjectionReceipts.organizationId, ORG)),
        own: await tx.select({ id: jobProjectionReceipts.id }).from(jobProjectionReceipts)
          .where(eq(jobProjectionReceipts.organizationId, ORG_B)),
      }));
      expect(seenByB.foreign).toHaveLength(0);
      expect(seenByB.own.length).toBeGreaterThanOrEqual(3);
      expect(await count("task_outputs", `issue_id = '${issueA}' AND company_id <> '${COMPANY}'`)).toBe(0);
    });

    it("[acc 5 / F10 cross-tenant denial] Organization B's job naming Organization A's task projects NOTHING into A (pending); the same job naming B's own task projects (same-tenant control)", async () => {
      const issueA = await seedIssue(COMPANY);
      const issueB = await seedIssue(COMPANY_B);
      const hostile = await seedLeasedAttempt(TENANT_B, taskSourceFor(AGENT_B, issueA));
      const idH = randomUUID();
      await seedCommittedArtifact(hostile, idH);
      const denied = await acceptWithBridges(hostile, [artifactEv(hostile, 1, idH)]);
      expect(denied.result.acceptedEventProjections?.[0]).toMatchObject({ projectionKind: "output_projection", outcome: "pending" });
      expect(await count("task_outputs", "true")).toBe(0);

      const control = await seedLeasedAttempt(TENANT_B, taskSourceFor(AGENT_B, issueB));
      const idC = randomUUID();
      await seedCommittedArtifact(control, idC);
      const allowed = await acceptWithBridges(control, [artifactEv(control, 1, idC)]);
      expect(allowed.result.acceptedEventProjections?.[0]).toMatchObject({ outcome: "applied" });
      expect(await count("task_outputs", `company_id = '${COMPANY_B}' AND issue_id = '${issueB}'`)).toBe(1);
      expect(await count("task_outputs", `company_id = '${COMPANY}'`)).toBe(0);
    });

    it("[F10] both cores refuse a Company the Organization does not own (nothing written); the same Company under its own Organization is accepted", async () => {
      const f = guard();
      const issueA = await seedIssue(COMPANY);
      const activity = {
        companyId: COMPANY, actorType: "system" as const, actorId: "t",
        action: "job.attempt_started", entityType: "job", entityId: randomUUID(),
      };
      await expect(runInTenant(f.app.db, ORG_B, (_r, tx) => recordAcceptedActivityCore({ tx }, {
        organizationId: ORG_B, companyId: COMPANY, acceptedEventId: randomUUID(), activity,
      }))).rejects.toBeInstanceOf(JobAuditBridgeTenantError);
      await expect(runInTenant(f.app.db, ORG_B, (_r, tx) => projectAcceptedOutputCore({ tx }, {
        organizationId: ORG_B, companyId: COMPANY, issueId: issueA, output: { type: "artifact", title: "x" },
      }))).rejects.toBeInstanceOf(JobOutputBridgeTenantError);
      expect(await count("activity_log", "true")).toBe(0);
      expect(await count("task_outputs", "true")).toBe(0);
      // Same-tenant control.
      await runInTenant(f.app.db, ORG, (_r, tx) => recordAcceptedActivityCore({ tx }, {
        organizationId: ORG, companyId: COMPANY, acceptedEventId: randomUUID(), activity,
      }));
      await runInTenant(f.app.db, ORG, (_r, tx) => projectAcceptedOutputCore({ tx }, {
        organizationId: ORG, companyId: COMPANY, issueId: issueA, output: { type: "artifact", title: "x" },
      }));
      expect(await count("activity_log", `company_id = '${COMPANY}'`)).toBe(1);
      expect(await count("task_outputs", `company_id = '${COMPANY}'`)).toBe(1);
    });
  },
);

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "JOB-017 production ingest composition (embedded PG)",
  () => {
    beforeEach(async () => { if (fixture) await resetBridgeRows(); });

    it("[acc 1 + acc 2 + acc 4] the REAL ingest audits start + terminal, projects the output, terminalizes the attempt itself, and writes NO run summary; activity.logged publishes only AFTER commit", async () => {
      const f = guard();
      const { offer, seeded } = await f.activateLease(71);
      const issueId = await seedIssue(COMPANY);
      await f.admin`UPDATE jobs SET source_kind = 'task_run',
        source_intent = ${f.admin.json(taskSourceFor(AGENT_A, issueId) as never)} WHERE id = ${seeded.jobId}`;
      const identifier = randomUUID();
      await f.admin`INSERT INTO job_artifacts (organization_id, job_id, identifier, kind, attempt, status, version_number)
        VALUES (${ORG}, ${seeded.jobId}, ${identifier}, 'workspace_patch', ${offer.job.attempt}, 'committed', 1)`;
      const published: Array<{ action: string; rowsVisible: Promise<number> }> = [];
      const off = subscribeCompanyLiveEvents(COMPANY, (e) => {
        if (e.type !== "activity.logged") return;
        // Read on a SEPARATE connection: a pre-commit publish would see 0 rows.
        published.push({ action: String((e.payload as { action?: unknown }).action), rowsVisible: count("activity_log", "true") });
      });
      try {
        const ingest = createJobEventIngestService({ appDb: f.app.db });
        const events = [
          wireEvent(offer, 1, "attempt_started", { sandboxId: "sbx-j017" }),
          wireEvent(offer, 2, "artifact_prepared", { artifactId: identifier, kind: "workspace_patch" }),
          wireEvent(offer, 3, "terminal", { status: "succeeded", exitCode: 0, errorCode: null, errorMessage: null }),
        ];
        const response = await ingest.ingest({ auth: auth("j017-ev-1"), request: batchRequest(offer, events) });
        expect(response.ack.status).toBe("accepted");
        expect(response.ack.acceptedThroughSeq).toBe(3);

        expect((await f.admin`SELECT action FROM activity_log ORDER BY action`).map((r) => r.action))
          .toEqual(["job.attempt_started", "job.attempt_terminal"]);
        expect(await count("job_projection_receipts", `projection_kind = 'activity_audit' AND status = 'applied'`)).toBe(2);
        expect(await count("task_outputs", `issue_id = '${issueId}' AND provider = 'aoa_distributed_job'`)).toBe(1);
        expect(await count("job_projection_receipts", `projection_kind = 'output_projection' AND status = 'applied'`)).toBe(1);
        // acc 4 — the INGEST is the single writer of terminal state; it wrote no run summary and no
        // task_terminal receipt (projectTerminalWinner is retired; the canary/crew projections own it).
        expect(await count("job_attempts", `id = '${seeded.attemptId}' AND status = 'succeeded'`)).toBe(1);
        expect(await count("job_projection_receipts", `projection_kind = 'task_terminal'`)).toBe(0);
        expect(await count("issue_comments", `issue_id = '${issueId}'`)).toBe(0);

        expect(published.map((p) => p.action).sort()).toEqual(["job.attempt_started", "job.attempt_terminal"]);
        for (const p of published) expect(await p.rowsVisible).toBe(2);
      } finally {
        off();
      }
    });

    it("[acc 1 stale] a batch presented with a stale fence token is refused and writes no activity row", async () => {
      const f = guard();
      const { offer } = await f.activateLease(72);
      const ingest = createJobEventIngestService({ appDb: f.app.db });
      const stale = { ...offer, fenceToken: `${offer.fenceToken}-stale` };
      await expect(ingest.ingest({
        auth: auth("j017-ev-2"),
        request: batchRequest(stale, [wireEvent(stale, 1, "attempt_started", { sandboxId: "sbx-stale" })]),
      })).rejects.toThrow();
      expect(await count("activity_log", "true")).toBe(0);
      // Positive control: the live fence IS audited.
      const live = await ingest.ingest({
        auth: auth("j017-ev-3"),
        request: batchRequest(offer, [wireEvent(offer, 1, "attempt_started", { sandboxId: "sbx-live" })]),
      });
      expect(live.ack.status).toBe("accepted");
      expect(await count("activity_log", `action = 'job.attempt_started'`)).toBe(1);
    });
  },
);

// =================================================================================================
// JOB-017 addendum (planning-session ruling, F2) — the E3-D-ACC (c) re-drive GENERALIZED to the
// `activity_audit` and `output_projection` receipt kinds. A pending audit or output receipt with no
// re-drive is the lost-audit class: the event is durable but its row would be permanently owed.
// =================================================================================================

/** A registration that WRITES through the real mapping, then throws — so the seam leaves a pending
 * receipt whose owed row the re-drive must produce. */
const failAfterWriteKinds = (kinds: string[]) => (p: AcceptedEventProjector): AcceptedEventProjector =>
  !kinds.includes(p.projectionKind) ? p : {
    projectionKind: p.projectionKind,
    aggregateKind: p.aggregateKind,
    sourceIdentity: (e, fe) => p.sourceIdentity(e, fe),
    apply: async (ctx) => { await p.apply(ctx); throw new Error("injected after the write"); },
  };

async function pendingReceipt(kind: string, identity: string) {
  const [row] = await guard().admin`SELECT id, status, target_aggregate_id, aggregate_kind, organization_id, company_id
    FROM job_projection_receipts WHERE projection_kind = ${kind} AND source_identity = ${identity}`;
  return row as { id: string; status: string; target_aggregate_id: string; aggregate_kind: string; organization_id: string; company_id: string } | undefined;
}

function redriveSweep(f: JobControlFixture, redrive = redrivePendingProjection) {
  return createAuthoritativeCostRedriveSweep({
    appDb: f.app.db,
    notifier: createHubStuckChargeNotifier(ownerDb()),
    log: { warn: () => {}, info: () => {} },
    maxAttempts: AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS,
    staleAfterMs: 0,
    now: () => new Date(Date.now() + 1_000),
    redrive,
  });
}

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "JOB-017 re-drive of pending activity_audit and output_projection receipts (embedded PG)",
  () => {
    beforeEach(async () => {
      if (!fixture) return;
      await resetBridgeRows();
      await fixture.admin`DELETE FROM notifications WHERE source_type = ${STUCK_CHARGE_HUB_SOURCE_TYPE}`;
    });

    it("[re-drive audit] a pending activity_audit receipt is re-driven to applied: exactly ONE activity row (the row the seam would have written), activity.logged AFTER commit, and a replay adds none", async () => {
      const f = guard();
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const t = terminal(fence, 1);
      const { result } = await acceptWithBridges(fence, [t], { mutate: failAfterWriteKinds(["activity_audit"]) });
      expect(result.acceptedEventProjections?.map((p) => p.outcome)).toEqual(["pending"]);
      expect(await count("activity_log", "true")).toBe(0);
      const receipt = await pendingReceipt("activity_audit", `activity:${COMPANY}:${t.eventId}`);
      expect(receipt?.status).toBe("pending");

      const published: Array<Promise<number>> = [];
      const off = subscribeCompanyLiveEvents(COMPANY, (e) => {
        if (e.type === "activity.logged") published.push(count("activity_log", "true"));
      });
      try {
        const redriven = await redrivePendingProjection(f.app.db, { organizationId: ORG, receiptId: receipt!.id });
        expect(redriven).toMatchObject({ status: "redriven", projectionKind: "activity_audit" });
      } finally {
        off();
      }
      const rows = await f.admin`SELECT id, action, company_id, entity_id, actor_id, details FROM activity_log`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "job.attempt_terminal", company_id: COMPANY, entity_id: fence.jobId, actor_id: `worker:${fence.workerId}`,
      });
      expect((rows[0]!.details as Record<string, unknown>).terminalStatus).toBe("succeeded");
      expect((rows[0]!.details as Record<string, unknown>).leaseId).toBe(fence.leaseId);
      const after = await pendingReceipt("activity_audit", `activity:${COMPANY}:${t.eventId}`);
      expect(after).toMatchObject({ status: "applied", aggregate_kind: "activity_log", target_aggregate_id: rows[0]!.id });
      // Published exactly once, and the listener's SEPARATE connection already saw the committed row.
      expect(published).toHaveLength(1);
      expect(await published[0]!).toBe(1);
      // A replay (a second re-drive, then the ingest re-sending the batch) adds nothing.
      expect((await redrivePendingProjection(f.app.db, { organizationId: ORG, receiptId: receipt!.id })).status).toBe("not_pending");
      await acceptWithBridges(fence, [t]).catch(() => undefined);
      expect(await count("activity_log", "true")).toBe(1);
    });

    it("[re-drive output] a pending output_projection receipt is re-driven to applied once its artifact is committed: exactly ONE task_outputs row, and a replay adds none", async () => {
      const f = guard();
      const issueId = await seedIssue(COMPANY);
      const fence = await seedLeasedAttempt(TENANT_A, taskSourceFor(AGENT_A, issueId));
      const identifier = randomUUID();
      const a = artifactEv(fence, 1, identifier);
      // Announced before its commit is visible: the seam records the projection as OWED.
      const { result } = await acceptWithBridges(fence, [a, terminal(fence, 2)]);
      expect(result.acceptedEventProjections?.find((p) => p.projectionKind === "output_projection")?.outcome).toBe("pending");
      const receipt = await pendingReceipt("output_projection", `output:${COMPANY}:${a.eventId}`);
      expect(receipt?.status).toBe("pending");
      const jobArtifactId = await seedCommittedArtifact(fence, identifier);

      const redriven = await redrivePendingProjection(f.app.db, { organizationId: ORG, receiptId: receipt!.id });
      expect(redriven).toMatchObject({ status: "redriven", projectionKind: "output_projection" });
      const outputs = await f.admin`SELECT id, company_id, issue_id, provider, external_id, is_primary FROM task_outputs`;
      expect(outputs).toHaveLength(1);
      expect(outputs[0]).toMatchObject({
        company_id: COMPANY, issue_id: issueId, provider: "aoa_distributed_job", external_id: jobArtifactId, is_primary: false,
      });
      expect(await pendingReceipt("output_projection", `output:${COMPANY}:${a.eventId}`))
        .toMatchObject({ status: "applied", aggregate_kind: "task_outputs", target_aggregate_id: outputs[0]!.id });
      expect((await redrivePendingProjection(f.app.db, { organizationId: ORG, receiptId: receipt!.id })).status).toBe("not_pending");
      expect(await count("task_outputs", "true")).toBe(1);
    });

    it("[re-drive via the sweeper] the job-control sweep re-drives BOTH kinds with the same bound constant", async () => {
      const f = guard();
      const issueId = await seedIssue(COMPANY);
      const fence = await seedLeasedAttempt(TENANT_A, taskSourceFor(AGENT_A, issueId));
      const identifier = randomUUID();
      await acceptWithBridges(fence, [startedEv(fence, 1), artifactEv(fence, 2, identifier)], {
        mutate: failAfterWriteKinds(["activity_audit"]),
      });
      expect(await count("job_projection_receipts", `status = 'pending'`)).toBe(2);
      await seedCommittedArtifact(fence, identifier);
      const result = await redriveSweep(f).sweepOrganization(ORG);
      expect(result).toMatchObject({ redriven: 2, failed: 0, notified: 0 });
      expect(await count("job_projection_receipts", `status = 'pending'`)).toBe(0);
      expect(await count("activity_log", "true")).toBe(1);
      expect(await count("task_outputs", "true")).toBe(1);
    });

    it("[bound, output] a PERSISTENT output failure (the artifact is never committed) stops at the bound and raises EXACTLY ONE Inbox item, durably", async () => {
      const f = guard();
      const issueId = await seedIssue(COMPANY);
      const fence = await seedLeasedAttempt(TENANT_A, taskSourceFor(AGENT_A, issueId));
      const a = artifactEv(fence, 1, randomUUID());
      await acceptWithBridges(fence, [a]);
      const receipt = await pendingReceipt("output_projection", `output:${COMPANY}:${a.eventId}`);
      expect(receipt?.status).toBe("pending");
      let calls = 0;
      const counting: typeof redrivePendingProjection = async (db, input) => { calls += 1; return redrivePendingProjection(db, input); };
      const sweep = redriveSweep(f, counting);
      for (let tick = 0; tick < AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS + 3; tick += 1) await sweep.sweepOrganization(ORG);
      expect(calls).toBe(AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS);
      expect(await count("notifications", `source_type = '${STUCK_CHARGE_HUB_SOURCE_TYPE}' AND source_id = '${receipt!.id}'`)).toBe(1);
      const restarted = redriveSweep(f, counting);
      for (let tick = 0; tick < 3; tick += 1) await restarted.sweepOrganization(ORG);
      expect(calls).toBe(AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS);
      expect(await count("notifications", `source_type = '${STUCK_CHARGE_HUB_SOURCE_TYPE}'`)).toBe(1);
      expect(await count("task_outputs", "true")).toBe(0);
    });

    it("[bound, audit] a PERSISTENT audit failure stops at the bound and raises EXACTLY ONE Inbox item, durably", async () => {
      const f = guard();
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      // A pending audit receipt that can never apply: it names a stored event outside the named
      // set (a `log` observation), so every re-drive refuses it.
      const l = logEv(fence, 1);
      await acceptWithBridges(fence, [l]);
      await f.admin`INSERT INTO job_projection_receipts
        (organization_id, company_id, projection_kind, source_identity, source_digest, job_id, attempt_id, source_fence, status, target_aggregate_id, aggregate_kind, applied_at)
        VALUES (${ORG}, ${COMPANY}, 'activity_audit', ${`activity:${COMPANY}:${l.eventId}`}, ${l.recomputedDigest},
          ${fence.jobId}, ${fence.attemptId}, ${fence.fence}, 'pending', ${fence.attemptId}, 'job_attempts', NULL)`;
      const receipt = await pendingReceipt("activity_audit", `activity:${COMPANY}:${l.eventId}`);
      let calls = 0;
      const counting: typeof redrivePendingProjection = async (db, input) => { calls += 1; return redrivePendingProjection(db, input); };
      const sweep = redriveSweep(f, counting);
      for (let tick = 0; tick < AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS + 3; tick += 1) await sweep.sweepOrganization(ORG);
      expect(calls).toBe(AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS);
      expect(await count("notifications", `source_type = '${STUCK_CHARGE_HUB_SOURCE_TYPE}' AND source_id = '${receipt!.id}'`)).toBe(1);
      const restarted = redriveSweep(f, counting);
      for (let tick = 0; tick < 3; tick += 1) await restarted.sweepOrganization(ORG);
      expect(calls).toBe(AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS);
      expect(await count("notifications", `source_type = '${STUCK_CHARGE_HUB_SOURCE_TYPE}'`)).toBe(1);
      expect(await count("activity_log", "true")).toBe(0);
    });

    it("[re-drive F10] two Organizations: each Organization's sweep re-drives ONLY its own receipts, and every re-driven row lands in the receipt's own Organization and Company", async () => {
      const f = guard();
      const issueA = await seedIssue(COMPANY);
      const issueB = await seedIssue(COMPANY_B);
      const fenceA = await seedLeasedAttempt(TENANT_A, taskSourceFor(AGENT_A, issueA));
      const fenceB = await seedLeasedAttempt(TENANT_B, taskSourceFor(AGENT_B, issueB));
      const idA = randomUUID();
      const idB = randomUUID();
      await acceptWithBridges(fenceA, [startedEv(fenceA, 1), artifactEv(fenceA, 2, idA)], { mutate: failAfterWriteKinds(["activity_audit"]) });
      await acceptWithBridges(fenceB, [startedEv(fenceB, 1), artifactEv(fenceB, 2, idB)], { mutate: failAfterWriteKinds(["activity_audit"]) });
      await seedCommittedArtifact(fenceA, idA);
      await seedCommittedArtifact(fenceB, idB);
      expect(await count("job_projection_receipts", `status = 'pending'`)).toBe(4);

      // Organization B's sweep first: A's receipts are invisible to it (forced RLS) and stay pending.
      expect(await redriveSweep(f).sweepOrganization(ORG_B)).toMatchObject({ redriven: 2 });
      expect(await count("job_projection_receipts", `status = 'pending' AND organization_id = '${ORG}'`)).toBe(2);
      expect(await count("activity_log", `company_id = '${COMPANY}'`)).toBe(0);
      expect(await count("task_outputs", `company_id = '${COMPANY}'`)).toBe(0);
      // Same-tenant control: A's own sweep re-drives A's.
      expect(await redriveSweep(f).sweepOrganization(ORG)).toMatchObject({ redriven: 2 });
      expect(await count("job_projection_receipts", `status = 'pending'`)).toBe(0);
      const activity = await f.admin`SELECT company_id, entity_id FROM activity_log`;
      expect(activity.map((r) => `${r.company_id}:${r.entity_id}`).sort())
        .toEqual([`${COMPANY}:${fenceA.jobId}`, `${COMPANY_B}:${fenceB.jobId}`].sort());
      const outputs = await f.admin`SELECT company_id, issue_id FROM task_outputs`;
      expect(outputs.map((r) => `${r.company_id}:${r.issue_id}`).sort())
        .toEqual([`${COMPANY}:${issueA}`, `${COMPANY_B}:${issueB}`].sort());
    });
  },
);

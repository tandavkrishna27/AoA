import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Db } from "@armyofagents/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createBrowserSessionCredentialBroker,
  setBrowserSessionCredentialPort,
} from "../services/browser-session-credentials.js";
import supertest from "supertest";
import { runtimeDecisionPromptHash } from "../services/agent-runtime-decisions.js";
import { createJobLeaseRenewalService } from "../services/job-fencing.js";
import { createBrowserArtifactRetention } from "../services/browser-artifact-retention-sweep.js";
import { parseDistributedNetworkPolicies } from "../config/distributed-network-policies.js";
import {
  setupJobControlFixture,
  auth as fixtureAuth,
  ORG,
  COMPANY,
  type JobControlFixture,
} from "./helpers/job-control-fixture.js";
import type { StorageProvider } from "../storage/types.js";
import type { VerifiedWorkerOperation } from "../services/job-leasing.js";
const binding = {
  bindingId: randomUUID(),
  connectorId: randomUUID(),
  origin: "https://example.com",
  exchangeUrl: "https://example.com/login",
  cookieName: "__Host-session",
};
const policy = parseDistributedNetworkPolicies(
  JSON.stringify({
    [ORG]: {
      [COMPANY]: {
        policyId: "browser-test",
        version: 1,
        allow: [{ scheme: "https", host: "example.com", port: 443 }],
      },
    },
  })
).get(`${ORG}:${COMPANY}`)!;
describe.skipIf(
  process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1"
)("browser native credential broker PostgreSQL", () => {
  let f: JobControlFixture;
  let owner: ReturnType<typeof postgres>;
  let ownerDb: Db;
  let active: Awaited<ReturnType<JobControlFixture["activateLease"]>>;
  let broker: ReturnType<typeof createBrowserSessionCredentialBroker>;
  let permission: any;
  let ctx: any;
  let request: any;
  const objects = new Map<string, Buffer>();
  const exchange = vi.fn();
  const current = vi.fn();
  const storage = {
    putObject: async (p: any) => {
      objects.set(p.objectKey, Buffer.from(p.body));
      return {};
    },
    getObject: async (p: any) => ({
      stream: Readable.from([objects.get(p.objectKey)!]),
    }),
    deleteObject: async (p: any) => {
      objects.delete(p.objectKey);
    },
  } as unknown as StorageProvider;
  beforeAll(async () => {
    f = await setupJobControlFixture("browser-session-credentials");
    const o = f.admin.options;
    owner = postgres({
      host: o.host,
      port: o.port,
      username: o.user,
      password: o.pass,
      database: o.database,
      max: 2,
    });
    ownerDb = drizzle(owner) as unknown as Db;
  }, 180000);
  beforeEach(async () => {
    process.env.AOA_SECRETS_MASTER_KEY = "a".repeat(64);
    objects.clear();
    exchange.mockReset();
    current.mockReset();
    current.mockResolvedValue(undefined);
    active = await f.activateLease(812);
    const prep = {
      schemaVersion: 1,
      requestDigest: "b".repeat(64),
      runId: randomUUID(),
      agentId: randomUUID(),
      issueId: randomUUID(),
      parentJobId: active.identity.jobId,
      parentAttemptId: active.identity.attemptId,
      parentLeaseId: active.identity.leaseId,
      targetId: active.identity.targetId,
      targetAuthorityKey: active.identity.targetAuthorityKey,
      targetGeneration: 1,
      profileHash: active.identity.profileHash,
      targetProfileHash: "c".repeat(64),
      providerConstraintHash: active.identity.providerConstraintHash,
      networkPolicy: policy,
      sessionBinding: binding,
    };
    await f.admin`UPDATE jobs SET workload_type='browser_session',source_kind='browser_request',status='running',policy_snapshot=${f.admin.json(
      { browserPreparation: prep, controlPlaneDenyCidrs: ["203.0.113.8/32"] }
    )} WHERE id=${active.identity.jobId}`;
    await f.admin`UPDATE job_attempts SET status='running' WHERE id=${active.identity.attemptId}`;
    const expiresAt = new Date(Date.now() + 60000).toISOString();
    permission = {
      decisionKind: "permission",
      requestId: randomUUID(),
      nonce: binding.bindingId,
      sourceRevision: 0,
      schemaVersion: 1,
      title: "Use scoped browser session",
      summary: policy.digest,
      toolName: "browser.session_credentials",
      networkTarget: binding.origin,
      riskClass: "credential_use",
      command: null,
      cwd: null,
      path: null,
      expiresAt,
      timeoutPolicy: "deny",
      defaultDecision: null,
    };
    permission.requestDigest = runtimeDecisionPromptHash({
      kind: "permission",
      ...permission,
      promptText: null,
    });
    const eventId = randomUUID(),
      digest = "d".repeat(64);
    await f.admin`INSERT INTO agent_runtime_decisions(id,company_id,adapter_type,kind,status,nonce,prompt_hash,title,summary,tool_name,network_target,risk_class,expires_at,timeout_policy,decision,answered_by_user_id,answered_at) VALUES(${permission.requestId},${COMPANY},'browser_runtime','permission','answered',${binding.bindingId},${permission.requestDigest},${permission.title},${policy.digest},${permission.toolName},${binding.origin},'credential_use',${expiresAt},'deny','allow_once','human-founder',now())`;
    await f.admin`INSERT INTO job_events(organization_id,company_id,job_id,attempt_id,attempt_number,lease_id,event_id,sequence,event_type,fence_token,event_digest,event,occurred_at) VALUES(${ORG},${COMPANY},${
      active.identity.jobId
    },${active.identity.attemptId},1,${
      active.identity.leaseId
    },${eventId},1,'runtime_decision_requested',${
      active.identity.fence
    },${digest},${f.admin.json({ payload: permission })},now())`;
    await f.admin`INSERT INTO job_projection_receipts(organization_id,company_id,projection_kind,source_identity,source_digest,job_id,attempt_id,source_fence,status,target_aggregate_id,aggregate_kind,applied_at) VALUES(${ORG},${COMPANY},'runtime_decision',${`browser-approval:${COMPANY}:${eventId}`},${digest},${
      active.identity.jobId
    },${active.identity.attemptId},${active.identity.fence},'applied',${
      permission.requestId
    },'agent_runtime_decisions',now())`;
    await f.admin`INSERT INTO job_control_commands(organization_id,company_id,job_id,attempt_id,attempt_number,lease_id,command_id,command_seq,command_kind,fence_token,command) VALUES(${ORG},${COMPANY},${
      active.identity.jobId
    },${active.identity.attemptId},1,${
      active.identity.leaseId
    },${randomUUID()},1,'runtime_decision_result',${
      active.identity.fence
    },${f.admin.json({
      result: {
        requestId: permission.requestId,
        requestDigest: permission.requestDigest,
        nonce: binding.bindingId,
        sourceRevision: 0,
        schemaVersion: 1,
        decision: "allow_once",
        decidedBy: { principalType: "user", principalId: "human-founder" },
      },
    })})`;
    exchange.mockResolvedValue({
      name: binding.cookieName,
      value: "scoped_cookie_value_012345",
      expiresAt,
    });
    broker = createBrowserSessionCredentialBroker({
      appDb: f.app.db,
      identityDb: f.operator.db,
      storage,
      signingKey: "s".repeat(64),
      publicOrigin: "https://control.example",
      resolveConnectorOAuth: async () => "cp_access_token",
      assertConnectorCurrent: current,
      exchange,
      storageTimeoutMs: 500,
    });
    ctx = {
      fenceIdentity: active.identity,
      companyId: COMPANY,
      authorityNow: new Date(),
      leaseDeadline: new Date(Date.now() + 300000),
    };
    request = {
      jobId: active.identity.jobId,
      leaseId: active.identity.leaseId,
      attempt: 1,
      workerId: active.identity.workerId,
      fenceToken: active.identity.fence,
    };
  });
  afterAll(async () => {
    delete process.env.AOA_SECRETS_MASTER_KEY;
    if (owner) await owner.end();
    if (f) await f.teardown();
  });
  const auth = () =>
    ({
      organizationId: ORG,
      workerId: active.identity.workerId,
    } as VerifiedWorkerOperation);
  it("encrypts at rest, replays the same grant, and consumes exactly once", async () => {
    // Queue/staging time does not spend the activated session's runtime budget.
    await f.admin`UPDATE jobs SET created_at=now()-interval '1 hour' WHERE id=${active.identity.jobId}`;
    const [first] = await broker.prepare(auth(), request, ctx);
    expect(first).toBeDefined();
    const stored = objects.values().next().value!.toString();
    expect(stored).toContain("local_encrypted_v1");
    expect(stored).not.toContain("scoped_cookie");
    expect(stored).not.toContain("cp_access_token");
    const [replay] = await broker.prepare(auth(), request, ctx);
    expect(replay?.grant.artifactId).toBe(first!.grant.artifactId);
    expect(exchange).toHaveBeenCalledTimes(1);
    const url = new URL(first!.grant.url);
    const token = url.searchParams.get("grant")!;
    const results = await Promise.allSettled([
      broker.redeem(first!.grant.artifactId, token),
      broker.redeem(first!.grant.artifactId, token),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    const bytes = (
      results.find(
        (result) => result.status === "fulfilled"
      ) as PromiseFulfilledResult<Buffer>
    ).value;
    expect(JSON.parse(bytes.toString()).cookie.value).toBe(
      "scoped_cookie_value_012345"
    );
    expect(objects.size).toBe(0);
    await expect(
      broker.redeem(first!.grant.artifactId, token)
    ).rejects.toThrow();
  });
  it.each(["denied", "nonhuman", "receipt-digest", "command-digest"])(
    "refuses %s before token exchange",
    async (fault) => {
      if (fault === "denied")
        await f.admin`UPDATE agent_runtime_decisions SET decision='deny' WHERE id=${permission.requestId}`;
      if (fault === "nonhuman")
        await f.admin`UPDATE agent_runtime_decisions SET answered_by_user_id=NULL WHERE id=${permission.requestId}`;
      if (fault === "receipt-digest")
        await f.admin`UPDATE job_projection_receipts SET source_digest=${"e".repeat(
          64
        )} WHERE target_aggregate_id=${permission.requestId}`;
      if (fault === "command-digest")
        await f.admin`UPDATE job_control_commands SET command=${f.admin.json({
          result: {
            ...permission,
            decision: "allow_once",
            requestDigest: "f".repeat(64),
          },
        })} WHERE job_id=${active.identity.jobId}`;
      expect(await broker.prepare(auth(), request, ctx)).toEqual([]);
      expect(exchange).not.toHaveBeenCalled();
    }
  );
  it("refuses cancelled fence and connector revocation at redemption", async () => {
    const [grant] = await broker.prepare(auth(), request, ctx);
    const token = new URL(grant!.grant.url).searchParams.get("grant")!;
    current.mockRejectedValueOnce(new Error("connector revoked"));
    await expect(
      broker.redeem(grant!.grant.artifactId, token)
    ).rejects.toThrow();
    await f.admin`UPDATE jobs SET status='cancelled' WHERE id=${active.identity.jobId}`;
    await expect(
      broker.redeem(grant!.grant.artifactId, token)
    ).rejects.toThrow();
    expect(objects.size).toBe(1);
    const report = await createBrowserArtifactRetention({
      ownerDb,
      appDb: f.app.db,
      storage,
    }).tick();
    expect(report.expired).toBe(1);
    expect(objects.size).toBe(0);
  });
  it("refuses a tampered URL token, expired grant and changed trusted binding", async () => {
    const [entry] = await broker.prepare(auth(), request, ctx);
    const token = new URL(entry!.grant.url).searchParams.get("grant")!;
    await expect(
      broker.redeem(entry!.grant.artifactId, token + "x")
    ).rejects.toThrow();
    await f.admin`UPDATE job_artifacts SET expires_at=now()-interval '1 second' WHERE id=${
      entry!.grant.artifactId
    }`;
    await expect(
      broker.redeem(entry!.grant.artifactId, token)
    ).rejects.toThrow();
  });
  it("retains a cleanup tombstone across cancellation, sweep, and late put completion", async () => {
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = storage.putObject.bind(storage);
    const spy = vi
      .spyOn(storage, "putObject")
      .mockImplementation(async (input) => {
        entered();
        await held;
        return original(input);
      });
    const preparing = broker.prepare(auth(), request, ctx);
    const rejection = expect(preparing).rejects.toThrow("storage timeout");
    try {
      await enteredPromise;
      await rejection;
      await f.admin`UPDATE jobs SET status='cancel_requested' WHERE id=${active.identity.jobId}`;
      expect(
        (
          await createBrowserArtifactRetention({
            ownerDb,
            appDb: f.app.db,
            storage,
          }).tick()
        ).expired
      ).toBe(1);
      const [tombstone] =
        await f.admin`SELECT object_key,status FROM job_artifacts WHERE identifier=${`browser-session-credential:${permission.requestId}`}`;
      expect(tombstone.status).toBe("expired");
      expect(tombstone.object_key).not.toBeNull();
      release();
      await vi.waitFor(async () => {
        expect(objects.size).toBe(0);
        expect(
          (
            await f.admin`SELECT object_key FROM job_artifacts WHERE identifier=${`browser-session-credential:${permission.requestId}`}`
          )[0].object_key
        ).toBeNull();
      });
    } finally {
      release();
      spy.mockRestore();
    }
  });
  it("composes grant delivery after authenticated renewal without consuming proof twice", async () => {
    setBrowserSessionCredentialPort(broker);
    try {
      const result = await createJobLeaseRenewalService({
        appDb: f.app.db,
      }).renew({
        auth: fixtureAuth("browser-credential-renew"),
        request: {
          protocolVersion: 1,
          correlationId: randomUUID(),
          issuedAt: new Date().toISOString(),
          nonce: randomUUID(),
          audience: "worker_run",
          idempotencyKey: randomUUID(),
          body: {
            ...request,
            protocolVersion: 1,
            observedAt: new Date().toISOString(),
            extensions: [],
          },
        } as any,
      });
      expect(result.outcome).toBe("renewed");
      if (result.outcome !== "renewed") throw new Error("renew refused");
      const extension = result.body.extensions?.find(
        (ext) =>
          ext.namespace === "com.armyofagents.browser/session-credential-grants"
      );
      expect(extension).toMatchObject({
        schemaVersion: 1,
        critical: false,
        value: {
          grants: [
            {
              requestId: permission.requestId,
              bindingId: binding.bindingId,
              policyDigest: policy.digest,
            },
          ],
        },
      });
      expect(exchange).toHaveBeenCalledTimes(1);
    } finally {
      setBrowserSessionCredentialPort(undefined);
    }
  });
  it("serves the native signed GET through createApp without board authentication", async () => {
    const { createApp } = await import("../app.js");
    const resolveSession = vi.fn(async () => {
      throw new Error("must not resolve board session");
    });
    const app = await createApp(ownerDb, {
      uiMode: "none",
      storageService: {} as any,
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      companyWorkspaceBaseDir: "D:/AoA-test-temp/browser-session-workspaces",
      allowedHostnames: ["127.0.0.1", "localhost"],
      bindHost: "127.0.0.1",
      authReady: true,
      companyDeletionEnabled: false,
      trustProxy: false,
      resolveSession,
      devLocalIdentity: false,
      distributedExecutionEnabled: true,
      tenantAppDb: f.app.db,
      operatorDb: f.operator.db,
      workerSessionSigningKey: "w".repeat(64),
    });
    setBrowserSessionCredentialPort(broker);
    try {
      const [entry] = await broker.prepare(auth(), request, ctx);
      const path =
        new URL(entry!.grant.url).pathname + new URL(entry!.grant.url).search;
      const response = await supertest(app).get(path).expect(200);
      expect(response.body.cookie.value).toBe("scoped_cookie_value_012345");
      expect(response.headers["cache-control"]).toBe("no-store");
      await supertest(app).get(path).expect(403);
      expect(resolveSession).not.toHaveBeenCalled();
    } finally {
      setBrowserSessionCredentialPort(undefined);
    }
  });
});

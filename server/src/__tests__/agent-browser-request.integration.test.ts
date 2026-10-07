import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { canonicalizeJsonV1 } from "@armyofagents/worker-protocol";
import { workerHelloV1Schema } from "@armyofagents/worker-protocol";
import { type Db } from "@armyofagents/db";
import { setupJobControlFixture, ORG, COMPANY, WORKER, TARGET, workerHello, WORKER_PROFILE_HASH, sha256, type JobControlFixture } from "./helpers/job-control-fixture.js";
import { createAgentBrowserRequestService, resolveBrowserChildCredentialBinding } from "../services/agent-browser-request.js";
import { createJobPlacementService } from "../services/job-placement.js";
import { createJobReconciliationService } from "../services/job-reconciliation.js";
import { runInTenant } from "../db/tenant-context.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import { parseDistributedNetworkPolicies } from "../config/distributed-network-policies.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const AGENT = "a6000000-0000-4000-8000-0000000000a7";
const RUN = "a6000000-0000-4000-8000-0000000000a8";
const ISSUE = "a6000000-0000-4000-8000-0000000000a9";
const request = { idempotencyKey: "browser-request-one", urls: ["https://example.com/docs"], options: { maxSessionSeconds: 120 } };
const policy = parseDistributedNetworkPolicies(JSON.stringify({ [ORG]: { [COMPANY]: { policyId: "approved-parent-egress", version: 1, allow: [{ scheme: "https", host: "example.com", port: 443 }] } } })).get(`${ORG}:${COMPANY}`)!;
const actor = { companyId: COMPANY, agentId: AGENT, runId: RUN };
let fixture: JobControlFixture;
let originalTarget: Record<string, unknown>;
let ownerDb: Db;
let ownerClient: ReturnType<typeof postgres>;
let storageRoot: string;
let parent: Awaited<ReturnType<JobControlFixture["activateLease"]>>;

function service(enabled = true) {
  const placement = createJobPlacementService({ appDb: fixture.app.db, operatorDb: fixture.operator.db, deploymentMode: "local_trusted", deploymentEnabled: true,
    resolveOrganizationPolicy: () => ({ enabled: true, mode: "active" }), resolveWorkloadPolicy: () => true,
    resolveCredentialBinding: (input) => resolveBrowserChildCredentialBinding(fixture.app.db, fixture.operator.db, input) });
  return createAgentBrowserRequestService({ appDb: fixture.app.db, identityDb: ownerDb, registryDb: fixture.operator.db,
    storage: createLocalDiskStorageProvider(storageRoot), enabled: async () => enabled, place: (input) => placement.place(input) });
}

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")("agent browser producer on serving PostgreSQL roles", () => {
  beforeAll(async () => {
    fixture = await setupJobControlFixture("browser-agent-producer");
    const options = fixture.admin.options;
    ownerClient = postgres({ host: options.host, port: options.port, username: options.user, password: options.pass, database: options.database, max: 2 });
    ownerDb = drizzle(ownerClient) as unknown as Db;
    storageRoot = await mkdtemp(join(tmpdir(), "aoa-browser-producer-objects-"));
    const [target] = await fixture.admin`SELECT registered_profile FROM execution_targets WHERE id=${TARGET}`;
    originalTarget = target.registered_profile as Record<string, unknown>;
    await fixture.admin`INSERT INTO agents(id,company_id,name,kind,status,adapter_type) VALUES(${AGENT},${COMPANY},'Browser requester','org','idle','claude_local')`;
  }, 180_000);
  beforeEach(async () => {
    process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED = "true";
    await fixture.resetRuntimeRows();
    await fixture.admin`DELETE FROM issues WHERE id=${ISSUE}`;
    await fixture.admin`DELETE FROM heartbeat_runs WHERE id=${RUN}`;
    await fixture.admin`DELETE FROM internal_agent_runs WHERE trigger_source='browser_request'`;
    await fixture.admin`UPDATE organizations SET concurrency_cap=10 WHERE id=${ORG}`;
    await fixture.admin`UPDATE execution_targets SET registered_profile=${fixture.admin.json(originalTarget)}, registered_profile_hash=${sha256(canonicalizeJsonV1(originalTarget))} WHERE id=${TARGET}`;
    await fixture.admin`UPDATE workers SET profile_snapshot=${fixture.admin.json(workerHello())}, profile_hash=${WORKER_PROFILE_HASH}, status='active', last_seen_at=now() WHERE id=${WORKER}`;
    parent = await fixture.activateLease(710);
    const hello = { ...workerHello(), reportedCapabilities: ["workload.batch", "workload.browser_session", "sandbox.process_isolated", "sandbox.filtered_egress"], capacity: { ...workerHello().capacity, browserSessionSlots: 2 } };
    expect(workerHelloV1Schema.safeParse(hello)).toMatchObject({success:true});
    const profile = { ...originalTarget, capabilityCeiling: hello.reportedCapabilities };
    const profileHash = sha256(JSON.stringify(hello));
    await fixture.admin`UPDATE workers SET profile_snapshot=${fixture.admin.json(hello)},profile_hash=${profileHash} WHERE id=${WORKER}`;
    await fixture.admin`UPDATE execution_targets SET registered_profile=${fixture.admin.json(profile)},registered_profile_hash=${sha256(canonicalizeJsonV1(profile))} WHERE id=${TARGET}`;
    await fixture.admin`UPDATE leases SET profile_hash=${profileHash} WHERE id=${parent.identity.leaseId}`;
    parent.identity.profileHash = profileHash;
    await fixture.admin`INSERT INTO heartbeat_runs(id,company_id,agent_id,status,execution_owner,distributed_job_id,distributed_attempt_id) VALUES(${RUN},${COMPANY},${AGENT},'running','distributed',${parent.seeded.jobId},${parent.seeded.attemptId})`;
    await fixture.admin`INSERT INTO issues(id,company_id,title,status,assignee_agent_id,checkout_run_id,execution_run_id) VALUES(${ISSUE},${COMPANY},'Active browser task','in_progress',${AGENT},${RUN},${RUN})`;
    await fixture.admin`UPDATE jobs SET status='running',source_kind='task_run',source_identity=${RUN},source_intent=${fixture.admin.json({kind:'task_run',runId:RUN,issueId:ISSUE,assigneeAgentId:AGENT})},executor_principal_id=${AGENT},policy_snapshot=${fixture.admin.json({networkPolicy:policy,controlPlaneDenyCidrs:["203.0.113.8/32"]})} WHERE id=${parent.seeded.jobId}`;
    await fixture.admin`UPDATE job_attempts SET status='running' WHERE id=${parent.seeded.attemptId}`;
  });
  afterAll(async () => {
    delete process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED;
    if (ownerClient) await ownerClient.end();
    if (fixture) await fixture.teardown();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  it("binds the real run/task/parent and stages complete trusted inputs before placement", async () => {
    const result = await service().request(actor, request);
    expect(result).toMatchObject({ status: "queued", replayed: false });
    const [job] = await fixture.admin`SELECT source_intent,policy_snapshot,requirements FROM jobs WHERE id=${result.jobId}`;
    expect(job.source_intent).toEqual({kind:'browser_request',browserRequestId:result.browserRequestId,parentJobId:parent.seeded.jobId});
    expect(job.policy_snapshot.browserPreparation).toMatchObject({runId:RUN,agentId:AGENT,issueId:ISSUE,parentLeaseId:parent.identity.leaseId,networkPolicy:policy});
    const staged = await fixture.admin`SELECT content_type,kind FROM job_artifacts WHERE job_id=${result.jobId}`;
    expect(staged).toHaveLength(3);
    expect(staged.every((row) => row.kind === "staged_input")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/credential|endpoint|cdp|fence|https:/i);
    expect((await service().request(actor, request)).jobId).toBe(result.jobId);
    await expect(service().request(actor, {...request,urls:["https://example.com/other"]})).rejects.toMatchObject({status:409});
  });
  it.each(["missing-run","wrong-agent","no-task","terminal-parent","missing-policy","missing-control-plane","wrong-task","missing-capability","expired-fence","cross-company"])("fails closed for %s", async (fault) => {
    let callActor = { ...actor };
    if (fault === "missing-run") callActor.runId = randomUUID();
    if (fault === "wrong-agent") callActor.agentId = randomUUID();
    if (fault === "cross-company") callActor.companyId = randomUUID();
    if (fault === "no-task") await fixture.admin`UPDATE issues SET status='done' WHERE id=${ISSUE}`;
    if (fault === "terminal-parent") await fixture.admin`UPDATE jobs SET status='cancelled' WHERE id=${parent.seeded.jobId}`;
    if (fault === "missing-policy") await fixture.admin`UPDATE jobs SET policy_snapshot='{}' WHERE id=${parent.seeded.jobId}`;
    if (fault === "missing-control-plane") await fixture.admin`UPDATE jobs SET policy_snapshot=${fixture.admin.json({networkPolicy:policy})} WHERE id=${parent.seeded.jobId}`;
    if (fault === "wrong-task") await fixture.admin`UPDATE jobs SET source_intent=${fixture.admin.json({kind:'task_run',runId:RUN,issueId:randomUUID(),assigneeAgentId:AGENT})} WHERE id=${parent.seeded.jobId}`;
    if (fault === "missing-capability") await fixture.admin`UPDATE workers SET profile_snapshot=${fixture.admin.json(workerHello())} WHERE id=${WORKER}`;
    if (fault === "expired-fence") await fixture.admin`UPDATE leases SET ack_deadline=now()-interval '2 seconds',expires_at=now()-interval '1 second' WHERE id=${parent.identity.leaseId}`;
    await expect(service().request(callActor, request)).rejects.toThrow();
    const [row] = await fixture.admin`SELECT count(*)::int AS n FROM jobs WHERE source_kind='browser_request'`;
    expect(row.n).toBe(0);
  });
  it("refuses unavailable concurrency without leaving a synthetic request row", async () => {
    await fixture.admin`UPDATE organizations SET concurrency_cap=0 WHERE id=${ORG}`;
    await expect(service().request(actor, request)).rejects.toMatchObject({status:429});
    const [row] = await fixture.admin`SELECT count(*)::int AS n FROM internal_agent_runs WHERE trigger_source='browser_request'`;
    expect(row.n).toBe(0);
  });
  it("refuses disabled rollout before preparing a request", async () => {
    await expect(service(false).request(actor, request)).rejects.toMatchObject({status:503});
  });
  it("parent cancellation durably cancels its pending browser child", async () => {
    const result = await service().request(actor, request);
    await createJobReconciliationService({appDb:fixture.app.db}).requestCancellation({organizationId:ORG,companyId:COMPANY,jobId:parent.seeded.jobId,reason:'user_cancel',graceful:false});
    const [job] = await fixture.admin`SELECT status FROM jobs WHERE id=${result.jobId}`;
    expect(job.status).toBe("cancelled");
    expect((await fixture.admin`SELECT status FROM internal_agent_runs WHERE id=${result.browserRequestId}`)[0].status).toBe("cancelled");
  });
  it("parent completion closes pending browser children", async () => {
    const result = await service().request(actor, request);
    await runInTenant(fixture.app.db, ORG, async (repos) => repos.jobControl.completeAttempt({...parent.identity,terminalStatus:'succeeded'}));
    expect((await fixture.admin`SELECT status FROM jobs WHERE id=${result.jobId}`)[0].status).toBe("cancelled");
  });
  it("every active browser fence refuses an expired parent even before reaping", async () => {
    const result = await service().request(actor, request);
    const leaseId=randomUUID(), fence=randomUUID();
    await fixture.admin`INSERT INTO leases(id,organization_id,company_id,job_id,attempt_id,attempt_number,worker_id,target_id,target_authority_key,target_generation,profile_hash,provider_constraint_hash,status,fence,ack_deadline,expires_at,activated_at)
      SELECT ${leaseId},organization_id,company_id,${result.jobId},${result.attemptId},1,worker_id,target_id,target_authority_key,target_generation,profile_hash,provider_constraint_hash,'active',${fence},ack_deadline,expires_at,activated_at FROM leases WHERE id=${parent.identity.leaseId}`;
    await fixture.admin`UPDATE job_attempts SET status='running' WHERE id=${result.attemptId}`;
    const childIdentity={...parent.identity,jobId:result.jobId,attemptId:result.attemptId,attemptNumber:1,leaseId,fence};
    await runInTenant(fixture.app.db,ORG,(repos)=>repos.jobControl.lockActiveFence(childIdentity));
    await fixture.admin`UPDATE leases SET ack_deadline=now()-interval '2 seconds',expires_at=now()-interval '1 second' WHERE id=${parent.identity.leaseId}`;
    await expect(runInTenant(fixture.app.db,ORG,(repos)=>repos.jobControl.lockActiveFence(childIdentity))).rejects.toMatchObject({code:"stale_fence"});
  });
});

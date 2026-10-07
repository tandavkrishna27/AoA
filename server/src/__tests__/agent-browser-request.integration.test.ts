import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { canonicalizeJsonV1 } from "@armyofagents/worker-protocol";
import { workerHelloV1Schema } from "@armyofagents/worker-protocol";
import { type Db } from "@armyofagents/db";
import { setupJobControlFixture, ORG, COMPANY, WORKER, TARGET, workerHello, WORKER_PROFILE_HASH, sha256, type JobControlFixture } from "./helpers/job-control-fixture.js";
import { createAgentBrowserRequestService, createCommanderBrowserRequestService, resolveBrowserChildCredentialBinding } from "../services/agent-browser-request.js";
import { createJobPlacementService } from "../services/job-placement.js";
import { createJobReconciliationService } from "../services/job-reconciliation.js";
import { runInTenant } from "../db/tenant-context.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import { submitJobWithinTenant } from "../services/job-submission.js";
import { loadCommanderJobAuthority } from "../services/commander-job-authority.js";
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

function serviceInput(enabled = true) {
  const placement = createJobPlacementService({ appDb: fixture.app.db, operatorDb: fixture.operator.db, deploymentMode: "local_trusted", deploymentEnabled: true,
    resolveOrganizationPolicy: () => ({ enabled: true, mode: "active" }), resolveWorkloadPolicy: () => true,
    resolveCredentialBinding: (input) => resolveBrowserChildCredentialBinding(fixture.app.db, fixture.operator.db, input) });
  return { appDb: fixture.app.db, identityDb: ownerDb, registryDb: fixture.operator.db,
    storage: createLocalDiskStorageProvider(storageRoot), enabled: async () => enabled, place: (input: Parameters<typeof placement.place>[0]) => placement.place(input) };
}
function service(enabled = true) { return createAgentBrowserRequestService(serviceInput(enabled)); }
const commanderUser = "human-browser-commander";
const conversationId = "a6000000-0000-4000-8000-0000000000b1";
async function commanderParent() {
  await fixture.admin`DELETE FROM internal_agent_messages WHERE conversation_id=${conversationId}`;
  await fixture.admin`DELETE FROM internal_agent_conversations WHERE id=${conversationId}`;
  await fixture.admin`DELETE FROM internal_agent_runs WHERE id=${RUN}`;
  await fixture.admin`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES(${commanderUser},'Commander browser fixture','commander-browser@example.test',true,now(),now()) ON CONFLICT(id) DO NOTHING`;
  await fixture.admin`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES(${ORG},${commanderUser},'member','active') ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active'`;
  await fixture.admin`INSERT INTO company_memberships(company_id,principal_type,principal_id,status) VALUES(${COMPANY},'user',${commanderUser},'active') ON CONFLICT(company_id,principal_type,principal_id) DO UPDATE SET status='active'`;
  await fixture.admin`INSERT INTO internal_agent_conversations(id,company_id,user_id,status) VALUES(${conversationId},${COMPANY},${commanderUser},'active')`;
  await fixture.admin`INSERT INTO internal_agent_runs(id,company_id,user_id,agent_id,trigger_type,trigger_source,status,provider,execution_owner,distributed_job_id,distributed_attempt_id) VALUES(${RUN},${COMPANY},${commanderUser},NULL,'conversation','conversation','running','openai','distributed',${parent.seeded.jobId},${parent.seeded.attemptId})`;
  await fixture.admin`INSERT INTO internal_agent_messages(id,conversation_id,role,content,run_id) VALUES(${randomUUID()},${conversationId},'user','Browse fixture',${RUN})`;
  await fixture.admin`INSERT INTO internal_agent_config(company_id,enabled_capabilities) VALUES(${COMPANY},${fixture.admin.json(['browser_use'])}) ON CONFLICT(company_id) DO UPDATE SET enabled_capabilities=EXCLUDED.enabled_capabilities`;
  await fixture.admin`UPDATE jobs SET source_kind='commander_turn',source_identity=${RUN},source_intent=${fixture.admin.json({kind:'commander_turn',internalAgentRunId:RUN,conversationId})},requester_principal_kind='team_member',requester_principal_id=${commanderUser},authenticated_principal_kind='user',authenticated_principal_id=${commanderUser},executor_principal_kind='sandbox',executor_principal_id=${RUN} WHERE id=${parent.seeded.jobId}`;
  return { companyId: COMPANY, userId: commanderUser, turnId: RUN, conversationId };
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
    await fixture.admin`UPDATE execution_targets SET device_generation=1,registered_profile=${fixture.admin.json(originalTarget)}, registered_profile_hash=${sha256(canonicalizeJsonV1(originalTarget))} WHERE id=${TARGET}`;
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
  it("admits the human-owned Commander parent with no synthetic agent or task", async () => {
    const actor = await commanderParent();
    const result = await createCommanderBrowserRequestService(serviceInput()).request(actor, request);
    const [job] = await fixture.admin`SELECT policy_snapshot,requester_principal_kind,requester_principal_id FROM jobs WHERE id=${result.jobId}`;
    expect(job).toMatchObject({requester_principal_kind:'team_member',requester_principal_id:commanderUser});
    expect(job.policy_snapshot.browserPreparation).toMatchObject({schemaVersion:2,principalKind:'commander',agentId:null,issueId:null,userId:commanderUser,conversationId,runId:RUN,networkPolicy:policy,parentLeaseId:parent.identity.leaseId});
    expect((await fixture.admin`SELECT agent_id,user_id FROM internal_agent_runs WHERE id=${result.browserRequestId}`)[0]).toEqual({agent_id:null,user_id:commanderUser});
    expect(JSON.stringify(result)).not.toMatch(/credential|endpoint|cdp|fence|https:/i);
  });
  it("reads an actual user-submitted Commander parent and refuses spoofed principal scope", async () => {
    await commanderParent();
    const submitted = await runInTenant(fixture.app.db, ORG, (repos, tx) => submitJobWithinTenant(repos, {
      organizationId: ORG, companyId: COMPANY, principal: { kind: "user", id: commanderUser, role: "team_member" },
      command: { idempotencyKey: "actual-commander-parent", source: { kind: "commander_turn", internalAgentRunId: RUN, conversationId }, input: {} },
    }, tx));
    expect(await loadCommanderJobAuthority(ownerDb, { companyId: COMPANY, jobId: submitted.jobId })).toMatchObject({ userId: commanderUser, turnId: RUN, conversationId });
    await fixture.admin`UPDATE jobs SET authenticated_principal_kind='agent' WHERE id=${submitted.jobId}`;
    expect(await loadCommanderJobAuthority(ownerDb, { companyId: COMPANY, jobId: submitted.jobId })).toBeNull();
    await fixture.admin`UPDATE jobs SET authenticated_principal_kind='user',requester_principal_kind='system' WHERE id=${submitted.jobId}`;
    expect(await loadCommanderJobAuthority(ownerDb, { companyId: COMPANY, jobId: submitted.jobId })).toBeNull();
  });
  it.each(['wrong-turn','wrong-user','wrong-conversation','removed-membership','disabled-capability','expired-parent','credentials','policy-ceiling','target-generation','missing-worker-capability','spoofed-principal'])('refuses Commander %s', async (fault) => {
    const actor = await commanderParent();
    if(fault==='wrong-turn')actor.turnId=randomUUID();
    if(fault==='wrong-user')actor.userId='other-human';
    if(fault==='wrong-conversation')actor.conversationId=randomUUID();
    if(fault==='removed-membership')await fixture.admin`UPDATE company_memberships SET status='inactive' WHERE company_id=${COMPANY} AND principal_id=${commanderUser}`;
    if(fault==='disabled-capability')await fixture.admin`UPDATE internal_agent_config SET enabled_capabilities='[]' WHERE company_id=${COMPANY}`;
    if(fault==='expired-parent')await fixture.admin`UPDATE leases SET ack_deadline=now()-interval '2 seconds',expires_at=now()-interval '1 second' WHERE id=${parent.identity.leaseId}`;
    if(fault==='target-generation')await fixture.admin`UPDATE execution_targets SET device_generation=device_generation+1 WHERE id=${TARGET}`;
    if(fault==='missing-worker-capability')await fixture.admin`UPDATE workers SET profile_snapshot=${fixture.admin.json(workerHello())} WHERE id=${WORKER}`;
    if(fault==='spoofed-principal')await fixture.admin`UPDATE jobs SET authenticated_principal_kind='agent' WHERE id=${parent.seeded.jobId}`;
    await expect(createCommanderBrowserRequestService(serviceInput()).request(actor,{...request,...(fault==='policy-ceiling'?{urls:['https://unapproved.example/']}:{ }),...(fault==='credentials'?{sessionBindingId:randomUUID()}:{})})).rejects.toThrow();
    expect((await fixture.admin`SELECT count(*)::int AS n FROM jobs WHERE source_kind='browser_request'`)[0].n).toBe(0);
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

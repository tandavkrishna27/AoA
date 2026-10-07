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
import { setBrowserSessionCredentialPort } from "../services/browser-session-credentials.js";
import { parseDistributedNetworkPolicies } from "../config/distributed-network-policies.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import supertest from "supertest";
import { vi } from "vitest";
import { createCommanderRunJwt } from "../agent-auth-jwt.js";
import { actorMiddleware } from "../middleware/auth.js";
import { mcpServerRoutes } from "../mcp/server.js";
import { setCommanderBrowserRequestPort } from "../services/agent-browser-request.js";
import { createBrowserSessionCredentialBroker } from "../services/browser-session-credentials.js";
import { assertBrowserConnectorCurrent } from "../services/browser-connector-oauth.js";
import { createAcceptedBrowserApprovalProjector } from "../services/job-accepted-browser-approval.js";
import { runtimeDecisionPromptHash } from "../services/agent-runtime-decisions.js";
import { jobApprovalBridge } from "../services/job-approval-bridge.js";
import { createJobOperationsService } from "../services/job-operations.js";
import { auth as workerAuth, pollRequest, ackRequest } from "./helpers/job-control-fixture.js";
import { runStagedBrowserJourney } from "./helpers/browser-journey-guest.js";
import { createBrowserApprovalController } from "../../../packages/worker-daemon/src/supervisor/browser-approval.js";
import { exchangeBrowserSessionCookie } from "../services/browser-session-cookie-exchange.js";
import type { executePinnedRequest } from "../services/outbound-url-guard.js";
import { expectedAttemptObjectPrefix,artifactCommitOperationRequestV1Schema } from "@armyofagents/worker-protocol";
import { createArtifactCommitService } from "../services/artifact-commit.js";
import { createJobLeaseRenewalService } from "../services/job-fencing.js";
import { readControlCommandDelivery } from "../../../packages/worker-daemon/src/lease/control-commands.js";
import type { BrowserSessionCredentialGrant } from "../services/browser-session-credentials.js";
import { leaseRenewOperationRequestV1Schema } from "@armyofagents/worker-protocol";

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
  await fixture.admin`DELETE FROM heartbeat_runs WHERE id=${RUN}`;
  await fixture.admin`DELETE FROM internal_agent_messages WHERE conversation_id=${conversationId}`;
  await fixture.admin`DELETE FROM internal_agent_conversations WHERE id=${conversationId}`;
  await fixture.admin`DELETE FROM internal_agent_runs WHERE id=${RUN}`;
  await fixture.admin`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES(${commanderUser},'Commander browser fixture','commander-browser@example.test',true,now(),now()) ON CONFLICT(id) DO NOTHING`;
  await fixture.admin`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES(${ORG},${commanderUser},'member','active') ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active',role='member'`;
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
    setBrowserSessionCredentialPort(undefined);
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

  for(const runGuest of [false,true]) it.skipIf(runGuest && process.env.AOA_RUN_BROWSER_TESTS!=='1')(`carries a signed reserved browser request through real placement, owner approval and encrypted one-use issuance (guest=${runGuest})`, async () => {
    const actor = await commanderParent();
    const binding = { bindingId: randomUUID(), connectorId: randomUUID(), origin: "https://mcp.notion.com", exchangeUrl: "https://mcp.notion.com/login", cookieName: "__Host-session" };
    await fixture.admin`UPDATE organization_memberships SET role='owner' WHERE organization_id=${ORG} AND user_id=${commanderUser}`;
    await fixture.admin`UPDATE company_memberships SET membership_role='owner' WHERE company_id=${COMPANY} AND principal_id=${commanderUser}`;
    await fixture.admin`UPDATE jobs SET requester_principal_kind='founder' WHERE id=${parent.identity.jobId}`;
    const networkPolicy = parseDistributedNetworkPolicies(JSON.stringify({ [ORG]: { [COMPANY]: { policyId: "journey", version: 1, allow: [{ scheme: "https", host: "mcp.notion.com", port: 443 }] } } })).get(`${ORG}:${COMPANY}`)!;
    await fixture.admin`UPDATE companies SET mcp_enabled=true WHERE id=${COMPANY}`;
    await fixture.admin`DELETE FROM company_mcp_connectors WHERE company_id=${COMPANY} AND server_name='journey-notion'`;
    await fixture.admin`INSERT INTO company_mcp_connectors(id,company_id,server_name,display_name,transport,url,source,catalog_entry_id,oauth_policy_version,secret_ref,status) VALUES(${binding.connectorId},${COMPANY},'journey-notion','Keyless journey','http','https://mcp.notion.com/mcp','catalog','notion-hosted',1,${`mcp:oauth:${binding.connectorId}`},'active')`;
    await fixture.admin`UPDATE jobs SET policy_snapshot=${fixture.admin.json({networkPolicy,controlPlaneDenyCidrs:['203.0.113.8/32'],browserSessionBindings:[binding]})} WHERE id=${parent.seeded.jobId}`;
    vi.stubEnv("AOA_AGENT_JWT_SECRET", "journey-signed-turn-secret");
    vi.stubEnv("AOA_SECRETS_MASTER_KEY", "a".repeat(64));
    vi.stubEnv("AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED", "per-organization");
    vi.stubEnv("AOA_DISTRIBUTED_EXECUTION_ROLLOUT", JSON.stringify({ organizations:{ [ORG]: { mode: "active", workloads:['*'], tools: true } } }));
    const storage = createLocalDiskStorageProvider(storageRoot);
    let issuerDispatch:typeof executePinnedRequest;
    // Only the external issuer response is keyless. Both OAuth resolution and
    // exchange retain the real tenant, connector and current parent checks.
    const broker = createBrowserSessionCredentialBroker({ appDb:fixture.app.db,identityDb:ownerDb,storage,signingKey:'s'.repeat(64),publicOrigin:'https://control.example',
      assertConnectorCurrent: scope => assertBrowserConnectorCurrent(ownerDb,scope),
      resolveConnectorOAuth: async scope => { await scope.assertAuthorityCurrent!(); await assertBrowserConnectorCurrent(ownerDb,scope); return 'keyless_cp_access_token'; },
      exchange: async input => runGuest ? exchangeBrowserSessionCookie(input,{resolveAddresses:async host=>{expect(host).toBe('mcp.notion.com');return ['93.184.216.34'];},dispatch:(...args)=>issuerDispatch(...args)}) : ({name:input.binding.cookieName,value:'keyless_session_cookie_012345',expiresAt:input.expiresAt.toISOString()}) });
    setBrowserSessionCredentialPort(broker);
    setCommanderBrowserRequestPort(createCommanderBrowserRequestService(serviceInput()));
    try {
      const app = express(); app.use(express.json());
      app.use(actorMiddleware(ownerDb,{deploymentMode:'authenticated',resolveSession:async()=>null}));
      app.use('/api',mcpServerRoutes(ownerDb));
      const token = createCommanderRunJwt({...actor,userRole:'founder'})!;
      const call = (method:string,params:unknown) => supertest(app).post(`/api/companies/${COMPANY}/browser-mcp`).set('Authorization',`Bearer ${token}`).set('x-aoa-run-id',randomUUID()).send({jsonrpc:'2.0',id:1,method,params});
      const list = await call('tools/list',{});
      expect(list.status,JSON.stringify(list.body)).toBe(200); expect(list.body.result.tools.map((t:any)=>t.name)).toEqual(['request_browser_session']);
      const result = await call('tools/call',{name:'request_browser_session',arguments:{idempotencyKey:'signed-keyless-journey',sessionBindingId:binding.bindingId,urls:[`${binding.origin}/dashboard`],options:{maxSessionSeconds:120,recordVideo:true}}});
      expect(result.status).toBe(200); expect(result.body.error).toBeUndefined();
      const [child] = await fixture.admin`SELECT id,source_intent,policy_snapshot FROM jobs WHERE source_kind='browser_request'`;
      expect(child).toBeDefined();
      expect(child.policy_snapshot.browserPreparation).toMatchObject({schemaVersion:2,userId:commanderUser,runId:RUN,agentId:null,issueId:null,parentJobId:parent.identity.jobId,sessionBinding:binding});
      const [attempt] = await fixture.admin`SELECT id FROM job_attempts WHERE job_id=${child.id}`;
      const auth = {...workerAuth('journey'),profileHash:parent.identity.profileHash};
      const poll = pollRequest('journey-poll'); poll.capacity.browserSessionSlots=2;
      const offered = await fixture.leasing.poll({auth,request:poll});
      expect(offered.outcome).toBe('offer'); if(offered.outcome!=='offer')throw new Error('missing child offer');
      expect(offered.body.job.jobId).toBe(child.id);
      expect((await fixture.leasing.ack({auth:{...auth,proofId:'journey-ack'},request:ackRequest(offered.body)})).outcome).toBe('acknowledged');
      const fence = {...parent.identity,jobId:child.id,attemptId:attempt.id,leaseId:offered.body.leaseId,fence:offered.body.fenceToken,attemptNumber:1};
      const permission = {decisionKind:'permission' as const,requestId:randomUUID(),nonce:binding.bindingId,sourceRevision:0,schemaVersion:1,title:'Use scoped browser session',summary:networkPolicy.digest,toolName:'browser.session_credentials',networkTarget:binding.origin,riskClass:'credential_use',command:null,cwd:null,path:null,expiresAt:new Date(Date.now()+60000).toISOString(),timeoutPolicy:'deny' as const,defaultDecision:null};
      const bridge=jobApprovalBridge(fixture.app.db);
      const leaseRequest={jobId:child.id,leaseId:fence.leaseId,attempt:1,workerId:WORKER,fenceToken:fence.fence};
      let approvedRequestId=permission.requestId;
      let videoArtifactId:string|undefined;
      if(!runGuest) {
      const payload = {...permission,requestDigest:runtimeDecisionPromptHash({kind:'permission',...permission,promptText:null})};
      const eventId=randomUUID(),digest=sha256(canonicalizeJsonV1(payload));
      let projectionError:unknown; const projector=createAcceptedBrowserApprovalProjector(); const apply=projector.apply; projector.apply=async input=>{try{return await apply(input);}catch(error){projectionError=error;throw error;}};
      await runInTenant(fixture.app.db,ORG,repos=>repos.jobControl.acceptEvent({...fence,batch:{events:[{eventId,sequence:1,eventType:'runtime_decision_requested',fenceToken:fence.fence,suppliedDigest:digest,recomputedDigest:digest,occurredAt:new Date(),payload:{eventId,eventType:'runtime_decision_requested',seq:1,payload},terminalStatus:null,serviceProjection:null}],acceptedEventProjectors:[projector]}}));
      const receipts=await fixture.admin`SELECT * FROM job_projection_receipts WHERE job_id=${child.id}`;
      expect(receipts,String(projectionError)).toEqual(expect.arrayContaining([expect.objectContaining({status:'applied',target_aggregate_id:permission.requestId})]));
      await bridge.resolveGovernedDecision({source:child.source_intent,actor:{companyId:COMPANY,kind:'user',id:commanderUser,userRole:'team_member'},fence,idempotencyKey:randomUUID(),runtimeDecision:{decisionId:permission.requestId,nonce:permission.nonce,expectedSourceRevision:0,kind:'permission',decision:'allow_once',actorUserId:commanderUser,answerIdempotencyKey:randomUUID()}});
      const [native] = await fixture.admin`SELECT status,answered_by_user_id FROM agent_runtime_decisions WHERE id=${permission.requestId}`;
      expect(native).toMatchObject({status:'answered',answered_by_user_id:commanderUser});
      const [entry]=await broker.prepare(auth,leaseRequest,{fenceIdentity:fence,companyId:COMPANY,authorityNow:new Date(),leaseDeadline:new Date(Date.now()+300000)});
      expect(entry).toBeDefined();
      const [artifact]=await fixture.admin`SELECT object_key FROM job_artifacts WHERE id=${entry.grant.artifactId}`;
      const object=await storage.getObject({companyId:COMPANY,objectKey:artifact.object_key});
      const parts:Buffer[]=[]; for await(const chunk of object.stream)parts.push(Buffer.from(chunk));
      expect(Buffer.concat(parts).toString()).not.toMatch(/keyless_cp_access_token|keyless_session_cookie_012345/);
      const grant=new URL(entry.grant.url).searchParams.get('grant')!;
      const delivered=JSON.parse((await broker.redeem(entry.grant.artifactId,grant)).toString());
      expect(delivered).toMatchObject({requestId:permission.requestId,bindingId:binding.bindingId,policyDigest:networkPolicy.digest,origin:binding.origin,cookie:{name:binding.cookieName,value:'keyless_session_cookie_012345'}});
      await expect(broker.redeem(entry.grant.artifactId,grant)).rejects.toThrow();
      }
      if(runGuest) {
        const guestRoot=await mkdtemp(join(tmpdir(),'commander-guest-journey-'));
        let deliverFile:(directory:string,id:string,body:unknown)=>Promise<void>;
        let renewedGrants:BrowserSessionCredentialGrant[]=[];
        let sequence=0;
        const controller=createBrowserApprovalController({identity:{organizationId:ORG,companyId:COMPANY,workerId:WORKER,jobId:child.id,attempt:1,leaseId:fence.leaseId,fenceToken:fence.fence},deadlineAt:Date.now()+120000,now:Date.now,scrubText:text=>text,
          credentialBinding:{bindingId:binding.bindingId,origin:binding.origin,policyDigest:networkPolicy.digest},
          emit:async request=>{
            if(request.toolName==='browser.session_credentials')approvedRequestId=request.requestId;
            const id=randomUUID(),hash=sha256(canonicalizeJsonV1(request));
            const accepted=await runInTenant(fixture.app.db,ORG,repos=>repos.jobControl.acceptEvent({...fence,batch:{events:[{eventId:id,sequence:++sequence,eventType:'runtime_decision_requested',fenceToken:fence.fence,suppliedDigest:hash,recomputedDigest:hash,occurredAt:new Date(),payload:{eventId:id,eventType:'runtime_decision_requested',seq:sequence,payload:request},terminalStatus:null,serviceProjection:null}],acceptedEventProjectors:[createAcceptedBrowserApprovalProjector()]}}));
            expect(accepted.acceptedEventProjections?.[0]?.outcome).toBe('applied');
            await bridge.resolveGovernedDecision({source:child.source_intent,actor:{companyId:COMPANY,kind:'user',id:commanderUser,userRole:'founder'},fence,idempotencyKey:randomUUID(),runtimeDecision:{decisionId:request.requestId,nonce:request.nonce,expectedSourceRevision:0,kind:'permission',decision:'allow_once',actorUserId:commanderUser,answerIdempotencyKey:randomUUID()}});
          },
          deliver:response=>deliverFile('/home/user/.aoa/browser-approvals',response.requestId,response),
          deliverCredential:async request=>{
            const scoped=renewedGrants.find(item=>item.requestId===request.requestId);expect(scoped).toBeDefined();
            const token=new URL(scoped!.grant.url).searchParams.get('grant')!;
            const bytes=await broker.redeem(scoped!.grant.artifactId,token);
            await deliverFile('/home/user/.aoa/browser-session-credentials',request.requestId,JSON.parse(bytes.toString()));
            await expect(broker.redeem(scoped!.grant.artifactId,token)).rejects.toThrow();
          },
        });
        try {
          const artifacts=await fixture.admin`SELECT content_type,object_key FROM job_artifacts WHERE job_id=${child.id} AND kind='staged_input'`;
          const guest=await runStagedBrowserJourney({root:guestRoot,companyId:COMPANY,storage,artifacts:artifacts as unknown as Array<{content_type:string;object_key:string}>,cookieValue:'keyless_session_cookie_012345',onIssuer:dispatch=>{issuerDispatch=dispatch;},onIntent:async(message,deliver)=>{
            deliverFile=deliver;
            const request=message.type==='session_credentials_requested'?await controller.requestCredentials(message):await controller.request(message);
            const renewed=await createJobLeaseRenewalService({appDb:fixture.app.db}).renew({auth:{...auth,proofId:`journey-renew-${request.requestId}`},request:leaseRenewOperationRequestV1Schema.parse({protocolVersion:1,correlationId:randomUUID(),issuedAt:new Date().toISOString(),nonce:randomUUID(),audience:'worker_run',idempotencyKey:randomUUID(),body:{...leaseRequest,protocolVersion:1,observedAt:new Date().toISOString(),extensions:[]}})});
            expect(renewed.outcome).toBe('renewed');if(renewed.outcome!=='renewed')throw new Error('renewal refused');
            const extension=renewed.body.extensions?.find(ext=>ext.namespace==='com.armyofagents.browser/session-credential-grants');
            renewedGrants=extension?(extension.value as unknown as {grants:BrowserSessionCredentialGrant[]}).grants:[];
            const delivery=readControlCommandDelivery(renewed.body.extensions);
            const command=delivery?.commands.find(value=>value.commandId===request.requestId);
            expect(command).toBeDefined();await controller.apply(command);
            if(message.type==='session_credentials_requested')controller.consumeCredential(request.requestId);
          }});
          expect(guest.authenticatedNavigations).toBe(1);
          expect(guest.events.filter(event=>event.type==='session_credentials_requested')).toHaveLength(1);
          expect(guest.events.find(event=>event.type==='session_completed'),guest.output).toMatchObject({savedDownloads:expect.arrayContaining([expect.stringContaining('session-video.webm')])});
          const bytes=await readFile(join(guest.mount,'aoa-output','session-video.webm'));expect(bytes.length).toBeGreaterThan(0);
          const objectKey=expectedAttemptObjectPrefix({organizationId:ORG,jobId:child.id,attempt:1})+'session-video.webm';
          await storage.putObject({objectKey,body:bytes,contentType:'video/webm',contentLength:bytes.length});
          const identifier=randomUUID();
          // The local fixture store supplies a checksum computed from actual
          // stored bytes; production local_disk has no transfer/checksum proof.
          const verifiedStorage={...storage,headObject:async(input:{objectKey:string})=>{const metadata=await storage.headObject(input),object=await storage.getObject(input),parts:Buffer[]=[];for await(const chunk of object.stream)parts.push(Buffer.from(chunk));return {...metadata,checksumSha256:sha256(Buffer.concat(parts))};}};
          const committed=await createArtifactCommitService({appDb:fixture.app.db,storage:verifiedStorage}).commit({auth:{...auth,proofId:'journey-video'},request:artifactCommitOperationRequestV1Schema.parse({protocolVersion:1,correlationId:randomUUID(),issuedAt:new Date().toISOString(),nonce:randomUUID(),audience:'worker_run',idempotencyKey:randomUUID(),body:{protocolVersion:1,workerId:WORKER,jobId:child.id,attempt:1,leaseId:fence.leaseId,fenceToken:fence.fence,manifest:{protocolVersion:1,organizationId:ORG,companyId:COMPANY,jobId:child.id,attempt:1,artifactId:identifier,kind:'browser_video',sensitivity:'restricted',retention:'run',objectKey,sizeBytes:bytes.length,sha256:sha256(bytes),contentType:'video/webm',createdAt:new Date().toISOString()}}})});
          expect(committed.outcome,JSON.stringify(committed)).toBe('committed');
          if(committed.outcome==='committed')videoArtifactId=(await fixture.admin`SELECT id FROM job_artifacts WHERE job_id=${child.id} AND identifier=${committed.artifactId}`)[0].id;
        } finally {controller.close();await rm(guestRoot,{recursive:true,force:true});}
      }
      const detail=await createJobOperationsService({appDb:fixture.app.db,operatorDb:fixture.operator.db}).getJobDetail(ORG,COMPANY,child.id);
      expect(detail?.runtimeDecisions).toEqual(expect.arrayContaining([expect.objectContaining({id:approvedRequestId,status:'answered'})]));
      expect(JSON.stringify(detail)).not.toMatch(/keyless_cp_access_token|keyless_session_cookie_012345|grant=/);
      if(videoArtifactId)expect(detail?.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({id:videoArtifactId,kind:'browser_video',status:'committed',expiresAt:expect.any(Date)})]));
      await createJobReconciliationService({appDb:fixture.app.db}).requestCancellation({organizationId:ORG,companyId:COMPANY,jobId:parent.identity.jobId,reason:'user_cancel',graceful:false});
      await expect(broker.prepare(auth,leaseRequest,{fenceIdentity:fence,companyId:COMPANY,authorityNow:new Date(),leaseDeadline:new Date(Date.now()+300000)})).rejects.toThrow();
      expect((await fixture.admin`SELECT status FROM jobs WHERE id=${child.id}`)[0].status).toBe('cancel_requested');
      expect((await fixture.admin`SELECT count(*)::int AS n FROM job_control_commands WHERE job_id=${child.id} AND command_kind='cancel'`)[0].n).toBe(1);
      expect((await fixture.admin`SELECT count(*)::int AS n FROM job_artifacts WHERE job_id=${child.id} AND kind='staged_input' AND status='pending'`)[0].n).toBe(0);
      expect((await fixture.admin`SELECT count(*)::int AS n FROM job_artifacts WHERE job_id=${child.id} AND kind='browser_cookie_state' AND (status='pending' OR object_key IS NOT NULL)`)[0].n).toBe(0);
    } finally { setCommanderBrowserRequestPort(undefined);setBrowserSessionCredentialPort(undefined);vi.unstubAllEnvs(); }
  },120000);

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
  it("stages only the immutable human session binding under real company connector authority", async () => {
    const actor = await commanderParent(), connectorId = randomUUID(), bindingId = randomUUID();
    const binding = { bindingId,connectorId,origin:'https://mcp.notion.com',exchangeUrl:'https://mcp.notion.com/login',cookieName:'__Host-session' };
    const scopedPolicy = parseDistributedNetworkPolicies(JSON.stringify({[ORG]:{[COMPANY]:{policyId:'human-session',version:1,allow:[{scheme:'https',host:'mcp.notion.com',port:443}]}}})).get(`${ORG}:${COMPANY}`)!;
    await fixture.admin`DELETE FROM company_mcp_connectors WHERE company_id=${COMPANY} AND catalog_entry_id='notion-hosted'`;
    await fixture.admin`INSERT INTO company_mcp_connectors(id,company_id,server_name,display_name,transport,url,source,catalog_entry_id,oauth_policy_version,secret_ref,status) VALUES(${connectorId},${COMPANY},'human-notion','Human fixture','http','https://mcp.notion.com/mcp','catalog','notion-hosted',1,${`mcp:oauth:${connectorId}`},'active')`;
    await fixture.admin`UPDATE jobs SET policy_snapshot=${fixture.admin.json({networkPolicy:scopedPolicy,controlPlaneDenyCidrs:['203.0.113.8/32'],browserSessionBindings:[binding]})} WHERE id=${parent.seeded.jobId}`;
    setBrowserSessionCredentialPort({assertReady:async()=>{},prepare:async()=>[],redeem:async()=>{throw new Error('not used by producer fixture');}});
    try {
      const result = await createCommanderBrowserRequestService(serviceInput()).request(actor,{...request,sessionBindingId:bindingId,urls:[binding.origin]});
      const [job] = await fixture.admin`SELECT policy_snapshot FROM jobs WHERE id=${result.jobId}`;
      expect(job.policy_snapshot.browserPreparation).toMatchObject({schemaVersion:2,userId:actor.userId,agentId:null,sessionBinding:binding,networkPolicy:scopedPolicy});
      expect(JSON.stringify(job.policy_snapshot)).not.toMatch(/refresh_token|access_token|cookie_value|cdp/i);
      await expect(createCommanderBrowserRequestService(serviceInput()).request(actor,{...request,idempotencyKey:'trace-refused',sessionBindingId:bindingId,urls:[binding.origin],options:{recordTrace:true}})).rejects.toThrow();
      await expect(createCommanderBrowserRequestService(serviceInput()).request(actor,{...request,idempotencyKey:'foreign-binding',sessionBindingId:randomUUID(),urls:[binding.origin]})).rejects.toThrow();
    } finally { setBrowserSessionCredentialPort(undefined); }
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

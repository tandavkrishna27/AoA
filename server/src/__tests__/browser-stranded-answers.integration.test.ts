import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import type {Db} from '@armyofagents/db';
import {agentRuntimeDecisionService} from '../services/agent-runtime-decisions.js';
import {setupJobControlFixture,ORG,COMPANY,type JobControlFixture} from './helpers/job-control-fixture.js';

describe.skipIf(process.platform==='win32'&&process.env.AOA_RUN_WIN_INTEGRATION!=='1')('distributed stranded native answers PostgreSQL',()=>{
  let owner:ReturnType<typeof postgres>;let f:JobControlFixture,db:Db,active:Awaited<ReturnType<JobControlFixture['activateLease']>>,decisionId:string;
  const audit=vi.fn(),emit=vi.fn(),reconcile=vi.fn();
  const service=()=>agentRuntimeDecisionService(db,{activityLogger:audit,hubItems:{emit,reconcile} as any});
  beforeAll(async()=>{f=await setupJobControlFixture('browser-stranded-answers');const o=f.admin.options;owner=postgres({host:o.host,port:o.port,username:o.user,password:o.pass,database:o.database,max:2});db=drizzle(owner) as unknown as Db;},180000);
  afterAll(async()=>{await owner?.end();await f?.teardown();});
  beforeEach(async()=>{
    await f.admin`UPDATE organizations SET status='active' WHERE id=${ORG}`;
    await f.admin`DELETE FROM agent_runtime_decisions WHERE company_id=${COMPANY}`;
    active=await f.activateLease(71);
    await f.admin`UPDATE jobs SET workload_type='browser_session' WHERE id=${active.seeded.jobId}`;
    const svc=service();
    const {decision}=await svc.createPrompt({companyId:COMPANY,agentId:null,runId:null,adapterType:'browser_runtime',kind:'permission',nonce:randomUUID(),title:'Allow browser navigation',toolName:'browser.navigate',networkTarget:'https://example.com',riskClass:'network_egress',timeoutPolicy:'deny'});
    decisionId=decision.id;
    await svc.answerPrompt({companyId:COMPANY,decisionId,expectedSourceRevision:decision.sourceRevision,actorUserId:'human-owner',nonce:decision.nonce,kind:'permission',decision:'allow_once',idempotencyKey:randomUUID()});
    await f.admin`INSERT INTO job_projection_receipts(organization_id,company_id,projection_kind,source_identity,source_digest,job_id,attempt_id,source_fence,status,target_aggregate_id,aggregate_kind,applied_at)
      VALUES(${ORG},${COMPANY},'runtime_decision',${randomUUID()},${'a'.repeat(64)},${active.seeded.jobId},${active.seeded.attemptId},${active.offer.fenceToken},'applied',${decisionId},'agent_runtime_decisions',clock_timestamp())`;
    audit.mockClear();emit.mockClear();reconcile.mockClear();
  });
  async function sweep(expected:number){expect((await service().sweepStrandedAnswers({companyId:COMPANY,limit:10})).cancelled).toBe(expected);const [row]=await f.admin`SELECT status,decision,answered_by_user_id FROM agent_runtime_decisions WHERE id=${decisionId}`;expect(row.status).toBe(expected?'cancelled':'answered');expect(row.decision).toBe('allow_once');expect(row.answered_by_user_id).toBe('human-owner');if(expected){expect(audit).toHaveBeenCalledWith(expect.objectContaining({action:'runtime_decision.cancelled'}));expect(reconcile).toHaveBeenCalledWith(COMPANY,{sourceType:'runtime_decision',sourceId:decisionId});expect((await service().sweepStrandedAnswers({limit:10})).cancelled).toBe(0);}}
  it('preserves a live null-runId distributed decision',async()=>{await sweep(0);});
  it.each(['succeeded','failed','cancelled','expired'])('cancels an answered own terminal attempt %s',async status=>{await f.admin`UPDATE job_attempts SET status=${status} WHERE id=${active.seeded.attemptId}`;await sweep(1);});
  it.each(['expired','revoked','released'])('cancels a lost lease %s',async status=>{await f.admin`UPDATE leases SET status=${status} WHERE id=${active.offer.leaseId}`;await sweep(1);});
  it('cancels an expired active fence',async()=>{await f.admin`UPDATE leases SET ack_deadline=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=${active.offer.leaseId}`;await sweep(1);});
  it('cancels a stale receipt fence while another fence is active',async()=>{await f.admin`UPDATE job_projection_receipts SET source_fence='stale' WHERE target_aggregate_id=${decisionId}`;await sweep(1);});
  it('cancels relay_failed and closes its projected item',async()=>{await service().markRelayFailed({companyId:COMPANY,decisionId,relayError:'delivery failed'});await f.admin`UPDATE job_attempts SET status='failed' WHERE id=${active.seeded.attemptId}`;expect((await service().sweepStrandedAnswers({limit:10})).cancelled).toBe(1);expect(reconcile).toHaveBeenCalled();});
  it('does not use an untrusted receipt kind',async()=>{await f.admin`UPDATE job_projection_receipts SET aggregate_kind='approvals' WHERE target_aggregate_id=${decisionId}`;await f.admin`UPDATE job_attempts SET status='failed' WHERE id=${active.seeded.attemptId}`;await sweep(0);});
  it('respects company scope',async()=>{await f.admin`UPDATE job_attempts SET status='failed' WHERE id=${active.seeded.attemptId}`;expect((await service().sweepStrandedAnswers({companyId:randomUUID(),limit:10})).cancelled).toBe(0);await sweep(1);});
  it('cleans terminal answers in suspended organizations',async()=>{await f.admin`UPDATE job_attempts SET status='failed' WHERE id=${active.seeded.attemptId}`;await f.admin`UPDATE organizations SET status='suspended' WHERE id=${ORG}`;await sweep(1);});
  it('bounds each sweep',async()=>{await f.admin`UPDATE job_attempts SET status='failed' WHERE id=${active.seeded.attemptId}`;expect(await service().sweepStrandedAnswers({limit:0})).toEqual({cancelled:0,processed:0});await sweep(1);});
  it('rechecks a restored current lease atomically after candidate selection',async()=>{
    await f.admin`UPDATE leases SET ack_deadline=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=${active.offer.leaseId}`;
    let restored=false;
    // Pause only execution of the native UPDATE. Both candidate selection and
    // guarded cancellation remain real PostgreSQL queries; the competing
    // transaction completes renewal of the exact lease before UPDATE runs.
    // This is a scheduling seam, not permission for renewing an expired lease.
    const racedDb=new Proxy(db,{get(target,key){
      if(key!=='update')return Reflect.get(target,key);
      return (...args:any[])=>{
        return {set:(patch:any)=>({where:(condition:any)=>({returning:(...fields:any[])=>{
          const query=(target.update as any)(...args).set(patch).where(condition).returning(...fields);
          return {then:async(resolve:any,reject:any)=>{
            if(!restored){restored=true;await f.admin`UPDATE leases SET expires_at=clock_timestamp()+interval '5 minutes' WHERE id=${active.offer.leaseId}`;}
            return query.then(resolve,reject);
          }};
        }})})};
      };
    }});
    expect(await agentRuntimeDecisionService(racedDb,{activityLogger:audit,hubItems:{emit,reconcile} as any}).sweepStrandedAnswers({limit:10})).toEqual({processed:1,cancelled:0});
    expect(restored).toBe(true);await sweep(0);expect(audit).not.toHaveBeenCalled();expect(reconcile).not.toHaveBeenCalled();
  });
  it('preserves a live relay_failed decision',async()=>{await service().markRelayFailed({companyId:COMPANY,decisionId,relayError:'retry delivery'});expect(await service().sweepStrandedAnswers({limit:10})).toEqual({processed:0,cancelled:0});});
  it('requires an applied receipt',async()=>{await f.admin`UPDATE job_projection_receipts SET status='pending',applied_at=NULL WHERE target_aggregate_id=${decisionId}`;await f.admin`UPDATE job_attempts SET status='failed' WHERE id=${active.seeded.attemptId}`;await sweep(0);});
  it('cleans terminal answers in archived organizations',async()=>{await f.admin`UPDATE job_attempts SET status='failed' WHERE id=${active.seeded.attemptId}`;await f.admin`UPDATE organizations SET status='archived' WHERE id=${ORG}`;await sweep(1);});
  it('never reopens an already relayed decision',async()=>{await service().markRelayed({companyId:COMPANY,decisionId});await f.admin`UPDATE job_attempts SET status='failed' WHERE id=${active.seeded.attemptId}`;expect(await service().sweepStrandedAnswers({limit:10})).toEqual({processed:0,cancelled:0});});
});

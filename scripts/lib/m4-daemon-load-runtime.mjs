// Rendered into the already-built control-plane container. No worker is simulated
// here: only HTTP submission, fixture credential setup, real placement and reads.
export function buildDaemonCampaignSource(params) {
  if(params.durationMs!==15000 || params.drainMs!==30000)throw Error('Preserve the 15s window and 30s drain deadline');
  return `const prepareDaemonCredentialFixture=${prepareDaemonCredentialFixture.toString()};
const buildDaemonLoadCommand=${buildDaemonLoadCommand.toString()};
(${runDaemonCampaign.toString()})(${JSON.stringify(params)}).catch(e=>{console.log('__M4__'+JSON.stringify({type:'fatal',code:e.code||e.name}));process.exitCode=1;});`;
}

// The standalone diagnostic process must initialize the same trusted deployment
// mode as the application before the production placement mint reads it.
export async function prepareDaemonCredentialFixture(input,deps) {
  if(!['authenticated','cloud_auth'].includes(input.deploymentMode))throw Error('Cloud fixture deployment mode required');
  deps.setDeploymentMode(input.deploymentMode);
  const target=deps.companyKeyTargetForAdapter('claude_local');
  if(!target?.secretName||target.envVar!=='ANTHROPIC_API_KEY')throw Error('Fixture provider mapping unavailable');
  const service=deps.secretService(deps.owner);
  for(const tenant of input.tenants) {
    if(!(await service.getByName(tenant.companyId,target.secretName))) {
      await service.create(tenant.companyId,{name:target.secretName,provider:'local_encrypted',value:'m4-deterministic-fixture-only'});
    }
  }
  return {mintCredentialAuthority:'company_api_key'};
}

export function buildDaemonLoadCommand(operationId,deps) {
  const invocation=deps.buildOneShotDistributedInvocation({operationId,cliTool:'claude',command:'claude',args:[],timeoutMs:240000});
  if(!invocation||deps.oneShotAdapterForWorkload(invocation.workload)!=='claude_local')throw Error('Fixture one-shot invocation cannot establish provider identity');
  return {idempotencyKey:operationId,source:{kind:'one_shot',operationKind:'readiness_probe',operationId},
    // Preserve the existing external workload runtime ceiling. The deterministic
    // provider scripts this recognized invocation; it does not run capture files.
    input:{...invocation.workload,maxRuntimeSeconds:600}};
}

async function runDaemonCampaign(P) {
  const {default:postgres}=await import('postgres');
  const {randomUUID}=await import('node:crypto');
  const {openSync,writeSync,fsyncSync}=await import('node:fs');
  const {createDb}=await import('@armyofagents/db');
  const {createDistributedExecutionRolloutSource}=await import('/cp-app/dist/config/distributed-execution-rollout-source.js');
  const {createJobPlacementService}=await import('/cp-app/dist/services/job-placement.js');
  const {resolveCanaryCredentialBinding}=await import('/cp-app/dist/services/canary-credential-binding.js');
  const {secretService,companyKeyTargetForAdapter}=await import('/cp-app/dist/services/secrets.js');
  const {setDeploymentMode}=await import('/cp-app/dist/config/deployment-mode.js');
  const {buildOneShotDistributedInvocation,oneShotAdapterForWorkload}=await import('/cp-app/dist/services/one-shot-distributed-invocation.js');
  const journal=openSync('/aoa/m4-'+P.phase+'.ndjson','ax',0o600);
  const telemetry={journalWrites:0,journalWriteMs:0,observerReadMs:0};
  const emit=value=>{const began=performance.now();const line=JSON.stringify(value)+'\n';writeSync(journal,line);fsyncSync(journal);
    telemetry.journalWrites++;telemetry.journalWriteMs+=performance.now()-began;process.stdout.write('__M4__'+line);};
  const sql=postgres(process.env.DATABASE_URL,{max:1});
  const owner=createDb(process.env.DATABASE_URL),appDb=createDb(process.env.AOA_APP_DATABASE_URL),operatorDb=createDb(process.env.AOA_OPERATOR_DATABASE_URL);
  const rollout=createDistributedExecutionRolloutSource(process.env);
  const placement=createJobPlacementService({appDb,operatorDb,deploymentEnabled:true,deploymentMode:process.env.AOA_DEPLOYMENT_MODE,
    resolveOrganizationPolicy:rollout.resolveOrganizationPolicy,resolveWorkloadPolicy:rollout.resolveWorkloadPolicy,resolveCredentialBinding:resolveCanaryCredentialBinding});
  const tenants=P.tenants.filter(t=>P.phase==='loaded'||t.tenantKey==='quiet');
  const failures=[];
  const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)));
  try {
    const allOrgIds=P.tenants.map(t=>t.organizationId);
    const [prior]=await sql`SELECT count(*)::int AS count FROM jobs WHERE organization_id=ANY(${allOrgIds}::uuid[]) AND status NOT IN ('succeeded','failed','cancelled','dead_letter')`;
    if(prior.count)throw Error('Prior scoped jobs have not drained; preserve prior verdict and rerun only after quiescence');
    const credential=await prepareDaemonCredentialFixture({deploymentMode:process.env.AOA_DEPLOYMENT_MODE,tenants:P.tenants},
      {setDeploymentMode,companyKeyTargetForAdapter,secretService,owner});
    const inventory=[];
    for(const t of P.tenants) {
      const rows=await sql`SELECT w.id AS "workerId",t.registered_profile_hash AS "profileHash",t.provider_constraint_profile AS "providerProfile",
        w.profile_snapshot AS hello FROM workers w JOIN execution_targets t ON t.id=w.execution_target_id
        WHERE t.id=${t.targetId} AND t.organization_id=${t.organizationId} AND w.status='enrolled' AND w.revoked_at IS NULL`;
      if(rows.length!==1)throw Error('Exactly one fresh enrolled worker per target required');
      t.workerId=rows[0].workerId;
      inventory.push({tenantKey:t.tenantKey,...rows[0]});
    }
    emit({type:'inventory',inventory});
    const origin=Date.now()+1000,end=origin+P.durationMs,deadline=end+P.drainMs;
    const jobs=tenants.flatMap(t=>Array.from({length:P.durationMs*t.rate/1000},(_,index)=>({intentId:randomUUID(),tenantKey:t.tenantKey,
      scheduledAtMs:index*1000/t.rate,deadlineAtMs:P.durationMs+P.drainMs,operationId:randomUUID()})));
    emit({type:'phase',phase:P.phase,originMs:origin,durationMs:P.durationMs,drainMs:P.drainMs,tenantKeys:tenants.map(t=>t.tenantKey),jobs});
    const started=jobs.map(async job=>{
      const tenant=tenants.find(t=>t.tenantKey===job.tenantKey);
      await sleep(origin+job.scheduledAtMs-Date.now());
      if(Date.now()>=end){failures.push({intentId:job.intentId,stage:'arrival_late'});return;}
      const requestId=randomUUID(),began=performance.now(),startedAtMs=Date.now()-origin;
      job.submittedAtMs=startedAtMs;
      const command=buildDaemonLoadCommand(job.operationId,{buildOneShotDistributedInvocation,oneShotAdapterForWorkload});
      command.idempotencyKey=job.intentId;
      emit({type:'start',requestId,tenantKey:job.tenantKey,kind:'submit',startedAtMs,deadlineAtMs:startedAtMs+10000});
      let status=0,outcome='transport_error',body;
      try {
        const response=await fetch('http://control-plane:3100/api/organizations/'+tenant.organizationId+'/companies/'+tenant.companyId+'/jobs',{
          method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+tenant.token},signal:AbortSignal.timeout(10000),
          body:JSON.stringify(command)});
        status=response.status;body=await response.json();outcome='response';
      }catch(error){outcome=['TimeoutError','AbortError'].includes(error?.name)?'timeout':'transport_error';}
      finally{emit({type:'finish',requestId,status,outcome,completedAtMs:Date.now()-origin,latencyMs:performance.now()-began});}
      if(status!==201||!body?.jobId||!body?.attemptId){failures.push({intentId:job.intentId,stage:'submit',status});return;}
      job.jobId=body.jobId;job.attemptId=body.attemptId;
      emit({type:'submitted',intentId:job.intentId,jobId:job.jobId,attemptId:job.attemptId,submittedAtMs:job.submittedAtMs});
      try {
        const began=performance.now();
        const decision=await placement.place({organizationId:tenant.organizationId,companyId:tenant.companyId,jobId:job.jobId,
          attemptId:job.attemptId,now:new Date(),maxHeartbeatAgeMs:120000,mintCredentialAuthority:credential.mintCredentialAuthority});
        emit({type:'placement',intentId:job.intentId,durationMs:performance.now()-began,
          disposition:decision.disposition,reasonCode:decision.reasonCode});
      }catch(error){failures.push({intentId:job.intentId,stage:'placement',code:error.code||error.name});}
    });
    // Every arrival is independent of prior response/terminal time. A serialized
    // producer would silently reduce the unchanged 2/s and 20/s offered load.
    let observerFailed=false;
    while(Date.now()<=deadline) {
      const ids=jobs.filter(j=>j.jobId).map(j=>j.jobId);
      if(ids.length) {
        const began=performance.now();
        const rows=await sql`SELECT j.id AS "jobId",j.status AS "jobStatus",a.status AS "attemptStatus",a.placement_target_id AS "targetId",
          (SELECT min(extract(epoch from (r.created_at-j.created_at))*1000) FROM worker_operation_receipts r
            WHERE r.organization_id=j.organization_id AND r.job_id=j.id AND r.operation='lease_ack') AS "queueToAckMs",
          (SELECT array_agg(DISTINCT e.event->>'workerId') FROM job_events e WHERE e.organization_id=j.organization_id AND e.job_id=j.id) AS "eventWorkers",
          (SELECT array_agg(DISTINCT l.worker_id::text) FROM leases l WHERE l.organization_id=j.organization_id AND l.job_id=j.id) AS "leaseWorkers"
          FROM jobs j JOIN job_attempts a ON a.job_id=j.id AND a.organization_id=j.organization_id AND a.attempt_number=1
          WHERE j.id=ANY(${ids}::uuid[]) AND j.organization_id=ANY(${allOrgIds}::uuid[])`;
        const observedAtMs=Date.now()-origin;
        telemetry.observerReadMs+=performance.now()-began;
        // A slow read finishing after the deadline cannot retroactively pass.
        if(Date.now()<=deadline)for(const row of rows){
          const job=jobs.find(j=>j.jobId===row.jobId);
          const tenant=tenants.find(t=>t.tenantKey===job.tenantKey);
          if((row.targetId && row.targetId!==tenant.targetId)||[...(row.eventWorkers??[]),...(row.leaseWorkers??[])].some(id=>id!==tenant.workerId)) {
            failures.push({intentId:job.intentId,stage:'actor_or_target_mismatch'});
          }
          job.jobStatus=row.jobStatus;job.attemptStatus=row.attemptStatus;
          if(row.queueToAckMs!==null)job.queueToAckMs=Number(row.queueToAckMs);
          if(row.jobStatus==='succeeded'&&job.jobCompletedAtMs===undefined)job.jobCompletedAtMs=observedAtMs;
          if(row.attemptStatus==='succeeded'&&job.attemptCompletedAtMs===undefined)job.attemptCompletedAtMs=observedAtMs;
        }
        emit({type:'observation',atMs:observedAtMs,readMs:performance.now()-began,rows});
      }
      await sleep(Math.min(250,Math.max(0,deadline-Date.now())));
    }
    await Promise.allSettled(started);
    emit({type:'result',phase:P.phase,jobs,failures,observerFailed,telemetry,observedUntilMs:Date.now()-origin,deadlineAtMs:P.durationMs+P.drainMs});
  }finally{await Promise.all([sql.end({timeout:5}),owner.$client.end({timeout:5}),appDb.$client.end({timeout:5}),operatorDb.$client.end({timeout:5})]);}
}

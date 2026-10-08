// Short, control-plane-only diagnostic. The harness plays workers; no provider
// executes a job. Queue seeding is not an API submit-latency measurement.
export function buildLocalLoadSource(params, proofSource) {
  if (!Number.isSafeInteger(params.durationMs) || params.durationMs < 1000 || params.durationMs > 60000
    || !Array.isArray(params.workers) || !params.workers.length || params.workers.length > 20
    || params.workers.some(w => !Number.isSafeInteger(w.rate) || w.rate < 1 || w.rate > 100
      || !Array.isArray(w.jobIds) || !w.jobIds.length || w.jobIds.length > 6000)) throw Error('Load must be bounded');
  for (const key of ['tenantKey','orgId','targetId','workerId']) {
    if (new Set(params.workers.map(w=>w[key])).size !== params.workers.length) throw Error('duplicate tenant identity');
  }
  return `${proofSource}\n(${runLoad.toString()})(${JSON.stringify(params)}).catch(e=>report({ok:false,errorCode:String(e.code||e.name)}));`;
}

async function runLoad(P) {
  const {default: postgres} = await import('postgres');
  const {canonicalEventDigestInputV1} = await import('@armyofagents/worker-protocol');
  const sql = postgres(process.env.DATABASE_URL,{max:1});
  const requests=[], completions=[], failures=[];
  let active=0, peakActive=0;
  const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)));
  let start;
  const base='http://control-plane:3100/api/worker-control';
  async function request(w,kind,url,body) {
    const text=JSON.stringify(body);
    const headers=deviceProofHeaders({method:'POST',url,bodyString:text,correlationId:body.correlationId,
      privateKeyPem:w.privateKeyPem,publicKeyDer:w.publicKeyDer});
    headers['content-type']='application/json'; headers.authorization='Bearer '+w.session;
    const began=performance.now(), startedAtMs=Date.now()-start; let status=0;
    try {
      const response=await fetch(url,{method:'POST',headers,body:text,signal:AbortSignal.timeout(10000)});
      status=response.status; const body=await response.json(); return {status,body};
    } catch { return {status,body:null}; }
    finally { requests.push({tenantKey:w.tenantKey,kind,status,startedAtMs,completedAtMs:Date.now()-start,latencyMs:performance.now()-began}); }
  }
  function envelope(audience,body) {
    return {protocolVersion:1,correlationId:randomUUID(),issuedAt:new Date().toISOString(),
      nonce:randomBytes(16).toString('base64url'),audience,...body};
  }
  try {
    const schedule=P.workers.flatMap(w=>w.jobIds.map((id,n)=>({id,orgId:w.orgId,offset:n*1000/w.rate})));
    // One database-selected origin for every tenant, after client-side setup.
    // RETURNING makes the generator use the exact same origin as availability.
    const scheduled=await sql`WITH origin AS MATERIALIZED (SELECT clock_timestamp()+interval '1500 milliseconds' AS at)
      UPDATE jobs j SET available_at=origin.at+v.offset_ms*interval '1 millisecond'
      FROM origin, unnest(${schedule.map(x=>x.id)}::uuid[],${schedule.map(x=>x.orgId)}::uuid[],${schedule.map(x=>x.offset)}::double precision[]) AS v(id,org_id,offset_ms)
      WHERE j.id=v.id AND j.organization_id=v.org_id
      RETURNING extract(epoch from origin.at)*1000 AS origin_ms`;
    if(scheduled.length!==schedule.length)throw Error('incomplete scoped schedule');
    start=Number(scheduled[0].origin_ms);
    if(Date.now()>=start)throw Error('schedule setup exceeded start margin');
    await sleep(start-Date.now());
    await Promise.all(P.workers.flatMap(w=>Array.from({length:w.tenantKey==='noisy'?10:1},(_,stream)=>(async()=>{
      const streams=w.tenantKey==='noisy'?10:1;
      for(let index=stream;index<w.jobIds.length;index+=streams) {
        const due=start+index*1000/w.rate; await sleep(due-Date.now()+2);
        if(Date.now()>start+P.durationMs+10000){failures.push({tenantKey:w.tenantKey,stage:'deadline'});break;}
        let polled;
        for(let retry=0;retry<4;retry++) {
          polled=await request(w,'poll',base+'/poll',envelope('worker_poll',{
            workerId:w.workerId,targetId:w.targetId,deviceGeneration:1,
            capacity:{batchSlots:64,browserSessionSlots:0,serviceSlots:0,freeCpuMillis:2000,freeMemoryMiB:4096,freeDiskMiB:8192}}));
          if(polled.status===200 && polled.body?.outcome==='offer')break;
          const delay=polled.body?.retryAfterMs;
          if(polled.status!==200 && polled.status!==429 && polled.status!==503)break;
          await sleep(Number.isSafeInteger(delay)&&delay>=0?Math.min(delay,10000):25);
        }
        const offer=polled?.body?.body;
        if(polled?.status!==200 || polled.body.outcome!=='offer' || !offer){failures.push({tenantKey:w.tenantKey,stage:'poll'});continue;}
        const jobId=offer.job.jobId;
        const jobIndex=w.jobIds.indexOf(jobId);
        if(jobIndex<0)throw Error('foreign job offered');
        const acked=await request(w,'leaseAck',base+'/leases/'+offer.leaseId+'/ack',envelope('worker_run',{
          idempotencyKey:randomUUID(),body:{protocolVersion:1,workerId:w.workerId,jobId,attempt:offer.job.attempt,
            leaseId:offer.leaseId,fenceToken:offer.fenceToken,ackedAt:new Date().toISOString()}}));
        if(acked.status!==200 || acked.body?.outcome!=='acknowledged'){failures.push({tenantKey:w.tenantKey,stage:'leaseAck'});continue;}
        active++;peakActive=Math.max(peakActive,active);
        const queueToAckMs=Math.max(0,Date.now()-(start+jobIndex*1000/w.rate));
        const identity={protocolVersion:1,organizationId:w.orgId,companyId:w.companyId,workerId:w.workerId,
          jobId,attempt:offer.job.attempt,leaseId:offer.leaseId,fenceToken:offer.fenceToken};
        const events=[{eventType:'attempt_started',payload:{sandboxId:'harness-only-'+randomUUID()}},
          {eventType:'terminal',payload:{status:'succeeded',exitCode:0,errorCode:null,errorMessage:null}}]
          .map((event,i)=>{const value={...identity,eventId:randomUUID(),seq:i+1,occurredAt:new Date().toISOString(),extensions:[],...event};
            return {...value,eventDigest:sha256hex(canonicalEventDigestInputV1(value))};});
        const uploaded=await request(w,'events',base+'/events',envelope('worker_run',{idempotencyKey:randomUUID(),
          body:{...identity,events}}));
        if(uploaded.status===200 && uploaded.body?.ack?.status==='accepted') {
          active--;completions.push({tenantKey:w.tenantKey,jobId,completedAtMs:Date.now()-start,queueToAckMs});
        } else failures.push({tenantKey:w.tenantKey,stage:'events'});
      }
    })())));
    await sleep(start+P.durationMs-Date.now());
    const orgIds=P.workers.map(w=>w.orgId);
    const [durable]=await sql`SELECT count(*) FILTER (WHERE status='succeeded')::int AS succeeded,
      count(*)::int AS total FROM job_attempts WHERE organization_id=ANY(${orgIds}::uuid[])`;
    report({ok:true,durationMs:P.durationMs,elapsedMs:Date.now()-start,tenantKeys:P.workers.map(w=>w.tenantKey),
      requests,completions,failures,peakActive,unresolvedActive:active,durable});
  } finally {await sql.end({timeout:5});}
}

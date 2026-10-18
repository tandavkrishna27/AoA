// Opt-in diagnostic preload only; never imported by a production boot root.
// The append+fsync start barrier precedes fetch, so death before finally is visible.
import {openSync,writeSync,fsyncSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

export function installFetchProbe({file,tenantKey,fetchImpl=globalThis.fetch,deadlineMs=10000,clock=Date.now}) {
  if(!file || !['quiet','noisy'].includes(tenantKey) || !Number.isSafeInteger(deadlineMs) || deadlineMs<=0)throw Error('Invalid diagnostic probe configuration');
  const fd=openSync(file,'ax',0o600);
  const emit=value=>{const began=performance.now();writeSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);return performance.now()-began;};
  const bootId=randomUUID();
  emit({type:'boot',bootId,tenantKey,atMs:clock(),deadlineMs});
  return async function measuredFetch(input,init) {
    let pathname;
    try{pathname=new URL(typeof input==='string'||input instanceof URL?input:input.url).pathname;}catch{return fetchImpl(input,init);}
    const kind=pathname.endsWith('/poll')?'poll':pathname.endsWith('/events')?'events':
      /\/leases\/[^/]+\/ack$/.test(pathname)?'leaseAck':/\/leases\/[^/]+\/renew$/.test(pathname)?'renew':
      pathname==='/op/execute'?'providerExecute':pathname==='/op/create'?'providerCreate':pathname==='/op/destroy'?'providerDestroy':null;
    if(!kind)return fetchImpl(input,init);
    const requestId=randomUUID(),startedAtMs=clock(),began=performance.now();
    const startWriteMs=emit({type:'start',requestId,bootId,tenantKey,kind,startedAtMs,deadlineAtMs:startedAtMs+deadlineMs});
    let status=0,outcome='transport_error',cloneWaitMs=0;
    try {
      const response=await fetchImpl(input,init);status=response.status;
      const cloneBegan=performance.now();
      // This intentionally changes response availability: retain and report the
      // clone wait; never subtract it or mistake it for provider service time.
      await response.clone().arrayBuffer();cloneWaitMs=performance.now()-cloneBegan;
      outcome='response';return response;
    }catch(error){outcome=['TimeoutError','AbortError'].includes(error?.name)?'timeout':'transport_error';throw error;}
    finally {
      const cpu=process.cpuUsage();
      const completedAtMs=clock(),latencyMs=performance.now()-began;
      const writeBegan=performance.now();
      emit({type:'finish',requestId,bootId,status,outcome,completedAtMs,latencyMs,cloneWaitMs,startWriteMs});
      const usage=process.cpuUsage(cpu);
      emit({type:'overhead',requestId,telemetryWriteMs:performance.now()-writeBegan,
        observerCpuMs:(usage.user+usage.system)/1000});
    }
  };
}

if(process.env.AOA_M4_PROBE_LOG)globalThis.fetch=installFetchProbe({file:process.env.AOA_M4_PROBE_LOG,
  tenantKey:process.env.AOA_M4_PROBE_TENANT,deadlineMs:Number(process.env.AOA_M4_PROBE_DEADLINE_MS||10000)});

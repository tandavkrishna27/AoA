// Opt-in disposable D1 project only. This is not the full D5 load campaign.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {newRaceScenarioIds,seedRaceScenario,buildRaceWorkerHello,enroll,stampWorkersLiveness,
  runLocalControlPlaneLoad} from '../tests/d1/lib/e6f-harness.mjs';
import {summarizeLoadPhase,compareQuietTenants} from './lib/m4-load-measurements.mjs';

const durationMs=Number(process.env.AOA_M4_LOAD_DURATION_MS||15000);
const quietCount=Number(process.env.AOA_M4_LOAD_QUIET_TENANTS||1);
const quietRate=Number(process.env.AOA_M4_LOAD_QUIET_RATE||2);
assert.equal(process.env.AOA_D1_LIVE,'1','Explicit AOA_D1_LIVE=1 required');
assert.match(process.env.AOA_E6F_COMPOSE_PROJECT||'',/^aoa-m4-load-[a-z0-9-]+$/,'Owned disposable load project required');
assert.ok(Number.isSafeInteger(durationMs)&&durationMs>=1000&&durationMs<=60000,'Duration must be 1–60 seconds');
assert.ok(Number.isSafeInteger(quietCount)&&quietCount>=1&&quietCount<=19,'1–19 quiet tenants required');
assert.ok(Number.isSafeInteger(quietRate)&&quietRate>=1&&quietRate<=10,'Quiet rate must be 1–10/s');
const output=path.resolve(process.env.AOA_M4_LOAD_OUTPUT||path.join(process.env.TEMP||'/tmp','aoa-m4-load',randomUUID()));
mkdirSync(output,{recursive:true});
function result(step,label){assert.equal(step.status,0,label+' transport');assert.ok(step.result,label+' result');return step.result;}
async function phase(noisy){
  const workers=[];
  const specs=[...Array.from({length:quietCount},(_,i)=>({tenantKey:'quiet-'+i,rate:quietRate})),
    ...(noisy?[{tenantKey:'noisy',rate:quietRate*10}]:[])];
  for(const spec of specs){
    const ids=newRaceScenarioIds({targetCount:1}),target=ids.targets[0];
    const jobs=Array.from({length:Math.ceil(durationMs*spec.rate/1000)},()=>({jobId:randomUUID(),attemptId:randomUUID(),targetIndex:0}));
    const seeded=result(seedRaceScenario({...ids,jobs,capacityCeiling:64}),'seed');assert.equal(seeded.ok,true,'seed accepted');
    const enrolled=result(enroll({code:target.code.code,hello:buildRaceWorkerHello({workerId:target.workerId,targetId:target.targetId,batchSlots:64}),deviceKey:target.deviceKey}),'enroll');
    assert.equal(enrolled.status,200,'enrollment accepted');assert.ok(enrolled.session,'session required');
    workers.push({...spec,orgId:ids.orgId,companyId:ids.companyId,workerId:target.workerId,targetId:target.targetId,
      session:enrolled.session,...target.deviceKey,jobIds:jobs.map(j=>j.jobId)});
  }
  result(stampWorkersLiveness(workers.map(w=>({workerId:w.workerId,targetId:w.targetId}))),'liveness');
  const raw=result(await runLocalControlPlaneLoad({durationMs,workers}),'load');assert.equal(raw.ok,true,'load runtime');
  writeFileSync(path.join(output,noisy?'loaded-raw.json':'baseline-raw.json'),JSON.stringify(raw,null,2));
  return {raw,summary:summarizeLoadPhase(raw)};
}
const baseline=await phase(false);
const loaded=await phase(true);
const fairness=compareQuietTenants(baseline.summary,loaded.summary,Array.from({length:quietCount},(_,i)=>'quiet-'+i));
const healthy=[baseline,loaded].every(({raw,summary})=>raw.failures.length===0&&raw.unresolvedActive===0
  &&raw.durable.succeeded===raw.completions.length&&summary.transportErrors===0
  &&summary.http5xxRate!==null&&summary.http5xxRate<=0.001
  &&summary.pollP95Ms!==null&&summary.pollP95Ms<=1000
  &&summary.eventAckP95Ms!==null&&summary.eventAckP95Ms<=500);
const report={result:healthy&&fairness.every(f=>f.passed)?'PASS':'FAIL',scope:'short local control-plane attempt-terminal diagnostic; harness simulates workers',
  durationMs,quietCount,quietRate,noisyRate:quietRate*10,queueAvailabilityRatio:10,baseline:baseline.summary,loaded:loaded.summary,fairness,
  peakActiveLeases:loaded.raw.peakActive,fullD5Satisfied:false,
  limits:['Durable attempt terminals measured, not end-to-end job/task completion',
    'Request latency/error cohort uses starts within the fixed window, including their late responses; drain starts counted separately',
    'SQL-seeded scheduled queue, not API submission; submit latency unmeasured',
    'no provider or worker-daemon execution in this driver','separate generator container shares the same desktop resources',
    'not the 60-minute floor plus 15-minute churn, 100-active-lease floor or independent failure domains'],output};
writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));if(report.result!=='PASS')process.exitCode=1;

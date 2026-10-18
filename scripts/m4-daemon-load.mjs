// Opt-in bounded engineering diagnostic. See docs/replatform/m4-daemon-load-runbook.md.
import {readFileSync,writeFileSync,mkdirSync,openSync,writeSync,fsyncSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {prepareDaemonFixture} from './lib/m4-daemon-load-fixture.mjs';
import {buildDaemonCampaignSource} from './lib/m4-daemon-load-runtime.mjs';
import {summarizeLoadPhase,compareQuietTenants} from './lib/m4-load-measurements.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const parseLines=text=>text.trim()?text.trim().split(/\r?\n/).map(JSON.parse):[];
const writeJson=(file,value)=>writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});

export function assembleDaemonPhase(records,workerRecords) {
  const phase=records.find(r=>r.type==='phase'),result=records.find(r=>r.type==='result');
  if(!phase||!result||records.some(r=>r.type==='fatal'))throw Error('Campaign incomplete; raw journals retained');
  const requestStarts=records.filter(r=>r.type==='start'),requests=records.filter(r=>r.type==='finish');
  const coverage=[];
  for(const tenantKey of phase.tenantKeys) {
    const samples=workerRecords[tenantKey];
    if(!samples || !samples.some(r=>r.type==='boot'&&r.tenantKey===tenantKey&&r.atMs<phase.originMs))throw Error('Missing pre-start worker telemetry');
    const selected=samples.filter(r=>r.type==='start'&&r.startedAtMs>=phase.originMs&&r.startedAtMs<phase.originMs+result.observedUntilMs);
    const ids=new Set(selected.map(r=>r.requestId));
    const overhead=new Map(samples.filter(r=>r.type==='overhead').map(r=>[r.requestId,r]));
    requestStarts.push(...selected.map(r=>({...r,startedAtMs:r.startedAtMs-phase.originMs,deadlineAtMs:r.deadlineAtMs-phase.originMs})));
    requests.push(...samples.filter(r=>r.type==='finish'&&ids.has(r.requestId)).map(r=>({...r,...overhead.get(r.requestId),
      telemetryWriteMs:(overhead.get(r.requestId)?.telemetryWriteMs??0)+r.startWriteMs,completedAtMs:r.completedAtMs-phase.originMs})));
    coverage.push({tenantKey,boots:samples.filter(r=>r.type==='boot').length,starts:selected.length});
  }
  const raw={...phase,...result,requests,requestStarts,completions:[],coverage};
  return {raw,summary:summarizeLoadPhase(raw)};
}

export function boundedDaemonVerdict(raw,summary) {
  const measured=summary.requestAccountingComplete && summary.totalRequests>0 && summary.censoredRequests===0 && summary.timeoutRequests===0
    && summary.transportErrors===0 && summary.http5xxRate!==null && summary.http5xxRate<=0.001
    && summary.submitP95Ms!==null && summary.submitP95Ms<=750 && summary.pollP95Ms!==null && summary.pollP95Ms<=1000
    && summary.eventAckP95Ms!==null && summary.eventAckP95Ms<=500;
  return measured && raw.failures.length===0 && Object.values(summary.tenants).every(t=>t.jobs.scheduled>0 && t.jobs.deadlineMisses===0);
}

async function main() {
  const [mode,directoryArg,phaseArg]=process.argv.slice(2),directory=path.resolve(directoryArg||'');
  if(!directoryArg||!['prepare','run','compare'].includes(mode))throw Error('Usage: node scripts/m4-daemon-load.mjs prepare|run|compare ABSOLUTE_FIXTURE_DIR [baseline|loaded]');
  if(mode==='prepare'){prepareDaemonFixture(directory);console.log(JSON.stringify({prepared:true,directory,privateManifest:'manifest.private.json',fullD5Satisfied:false}));return;}
  if(mode==='compare') {
    const baseline=JSON.parse(readFileSync(path.join(directory,'baseline.report.json'),'utf8'));
    const loaded=JSON.parse(readFileSync(path.join(directory,'loaded.report.json'),'utf8'));
    if(JSON.stringify(baseline.inventory)!==JSON.stringify(loaded.inventory))throw Error('Profile/worker inventory changed between phases');
    const fairness=compareQuietTenants(baseline.summary,loaded.summary,['quiet']);
    const report={result:baseline.result==='PASS'&&loaded.result==='PASS'&&fairness.every(f=>f.passed)?'PASS':'FAIL',fairness,
      baseline:baseline.summary,loaded:loaded.summary,fullD5Satisfied:false,scope:loaded.scope,limits:loaded.limits};
    writeJson(path.join(directory,'comparison.report.json'),report);console.log(JSON.stringify(report));if(report.result!=='PASS')process.exitCode=1;return;
  }
  if(process.env.AOA_D1_LIVE!=='1'||!/^aoa-m4-daemon-[a-z0-9-]+$/.test(process.env.AOA_E6F_COMPOSE_PROJECT||''))throw Error('AOA_D1_LIVE=1 and owned aoa-m4-daemon-* project required');
  if(!['baseline','loaded'].includes(phaseArg))throw Error('Explicit baseline or loaded phase required');
  const manifest=JSON.parse(readFileSync(path.join(directory,'manifest.private.json'),'utf8'));
  if(manifest.durationMs!==15000||manifest.drainMs!==30000||manifest.tenants.length!==2||manifest.tenants[0].rate!==2||manifest.tenants[1].rate!==20)throw Error('Unchanged fixed 2/s, 20/s and deadlines required');
  const args=['compose','--project-name',process.env.AOA_E6F_COMPOSE_PROJECT,'--env-file',path.join(directory,'fixture.env'),'-f',path.join(repo,'docker-compose.d1.yml'),'-f',path.join(directory,'compose.json')];
  const records=[],fd=openSync(path.join(directory,phaseArg+'.stream.ndjson'),'ax',0o600);
  const child=spawn('docker',[...args,'exec','-T','control-plane','node','--input-type=module'],{cwd:repo,stdio:['pipe','pipe','pipe']});
  let pending='',stderr='';
  const capture=line=>{if(!line.startsWith('__M4__'))return;const record=JSON.parse(line.slice(6));records.push(record);writeSync(fd,JSON.stringify(record)+'\n');fsyncSync(fd);};
  child.stdout.on('data',chunk=>{pending+=chunk;let index;while((index=pending.indexOf('\n'))>=0){capture(pending.slice(0,index));pending=pending.slice(index+1);}});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-8000);});
  child.stdin.end(buildDaemonCampaignSource({...manifest,phase:phaseArg}));
  const timer=setTimeout(()=>child.kill(),120000);
  const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});clearTimeout(timer);if(pending)capture(pending);
  for(const t of manifest.tenants)stderr=stderr.replaceAll(t.token,'[redacted]');
  writeJson(path.join(directory,phaseArg+'.exit.json'),{status,stderr});
  const workers={};
  for(const t of manifest.tenants) {
    const fetched=spawnSync('docker',[...args,'exec','-T',t.service,'cat','/worker/m4-requests.ndjson'],{encoding:'utf8',timeout:15000,maxBuffer:32*1024*1024});
    if(fetched.status!==0)throw Error('Worker telemetry unavailable; retain scoped volumes and stream journal');
    writeFileSync(path.join(directory,phaseArg+'.'+t.tenantKey+'.ndjson'),fetched.stdout,{flag:'wx',mode:0o600});workers[t.tenantKey]=parseLines(fetched.stdout);
  }
  const journal=spawnSync('docker',[...args,'exec','-T','control-plane','cat','/aoa/m4-'+phaseArg+'.ndjson'],{encoding:'utf8',timeout:15000,maxBuffer:32*1024*1024});
  if(journal.status!==0)throw Error('Control-plane journal unavailable; cannot reconstruct complete cohort');
  writeFileSync(path.join(directory,phaseArg+'.durable.ndjson'),journal.stdout,{flag:'wx',mode:0o600});
  const {raw,summary}=assembleDaemonPhase(parseLines(journal.stdout),workers);
  const report={result:status===0&&boundedDaemonVerdict(raw,summary)?'PASS':'FAIL',scope:manifest.scope,summary,
    inventory:records.find(r=>r.type==='inventory')?.inventory,fullD5Satisfied:false,
    limits:['15s load + 30s immutable drain; two organizations, one control plane, same host',
      'Deterministic provider fixture, no paid provider; fixture-only company secret handle',
      'Direct production placement service after authenticated API submit; no SQL job/attempt/placement writes',
      'Queue-to-ACK uses DB receipt transaction timestamp minus job creation; not response/commit timing',
      'Job/attempt completion uses first durable read observed before deadline (250ms sampling); no later rescue',
      'Provider wire latency includes network and instrumentation; provider service duration remains unmeasured',
      'Pool wait, SQL execution, authority-lock spans and event-ingestion service spans require separate profiling before a product fix',
      'Sync journal and clone-response observer overhead retained; matched uninstrumented calibration not yet measured']};
  writeJson(path.join(directory,phaseArg+'.raw.json'),raw);writeJson(path.join(directory,phaseArg+'.report.json'),report);
  console.log(JSON.stringify(report));if(report.result!=='PASS')process.exitCode=1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});

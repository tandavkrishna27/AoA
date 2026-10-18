import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('fresh fixture renders separate identities, unchanged ceilings and real daemon boot roots',async()=>{
  const {prepareDaemonFixture}=await import('../m4-daemon-load-fixture.mjs');
  const dir=mkdtempSync(path.join(tmpdir(),'m4-fixture-'));
  try {
    const manifest=prepareDaemonFixture(dir);
    const overlay=JSON.parse(readFileSync(path.join(dir,'compose.json'),'utf8'));
    assert.notEqual(manifest.tenants[0].organizationId,manifest.tenants[1].organizationId);
    assert.equal(manifest.durationMs,15000);assert.equal(manifest.drainMs,30000);
    for(const name of ['worker-a','worker-b']) {
      const worker=overlay.services[name];
      assert.ok(worker.command.includes('/worker-net-app/dist/bin/networked-host.js'));
      assert.equal(worker.environment.AOA_WORKER_CONCURRENCY_BATCH,'1');
      assert.equal(worker.environment.AOA_WORKER_DISPATCH_ENABLED,'1');
      assert.equal(worker.environment.AOA_WORKER_PROVIDER_URL,'http://fake-provider:8082');
    }
    assert.equal(overlay.services['fake-provider'].environment.AOA_FAKE_PROVIDER_CTL_ALLOW,'worker-a,worker-b,test-runner');
    assert.ok(!JSON.stringify(overlay.services['fake-provider'].volumes).includes('signing-key.pem'));
    const seed=readFileSync(path.join(dir,'seed.mjs'),'utf8');
    assert.ok(!/INSERT INTO (jobs|job_attempts|leases)\b/.test(seed));
    assert.ok(!seed.includes('maxConcurrentOperations:'));
    assert.notEqual(manifest.tenants[0].token,manifest.tenants[1].token);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('runtime source parses and uses actual HTTP submit plus production placement instead of SQL placement',async()=>{
  const {buildDaemonCampaignSource}=await import('../m4-daemon-load-runtime.mjs');
  const {Script}=await import('node:vm');
  const source=buildDaemonCampaignSource({phase:'baseline',durationMs:15000,drainMs:30000,tenants:[]});
  new Script(`(async()=>{${source}})()`);
  assert.ok(source.includes('/companies/'));
  assert.ok(source.includes('createJobPlacementService'));
  assert.ok(!/INSERT INTO (jobs|job_attempts|leases)\b/.test(source));
});

test('assembler joins lost worker starts and refuses a missing daemon journal',async()=>{
  const {assembleDaemonPhase}=await import('../../m4-daemon-load.mjs');
  const records=[{type:'phase',originMs:10000,durationMs:15000,tenantKeys:['quiet'],jobs:[]},
    {type:'result',jobs:[],failures:[],observedUntilMs:45000}];
  const samples=[{type:'boot',tenantKey:'quiet',atMs:9999},{type:'start',requestId:'lost',tenantKey:'quiet',kind:'poll',startedAtMs:10001,deadlineAtMs:20001}];
  const {summary}=assembleDaemonPhase(records,{quiet:samples});
  assert.equal(summary.totalRequests,1);assert.equal(summary.censoredRequests,1);
  assert.throws(()=>assembleDaemonPhase(records,{}),/telemetry/);
});

test('assembler freezes job schedule/deadlines and refuses missing or duplicated job evidence',async()=>{
  const {assembleDaemonPhase}=await import('../../m4-daemon-load.mjs');
  const job={intentId:'a',tenantKey:'quiet',scheduledAtMs:0,deadlineAtMs:45000};
  const phase={type:'phase',originMs:10000,durationMs:15000,tenantKeys:['quiet'],jobs:[job]};
  const result={type:'result',jobs:[{...job}],failures:[],observedUntilMs:45000};
  const workers={quiet:[{type:'boot',tenantKey:'quiet',atMs:9999}]};
  for(const jobs of [[],[{...job,deadlineAtMs:60000}],[{...job},{...job}]]) {
    assert.throws(()=>assembleDaemonPhase([phase,{...result,jobs}],workers),/job/i);
  }
});

test('a job timeout fails the bounded verdict even with successful request histograms',async()=>{
  const {boundedDaemonVerdict}=await import('../../m4-daemon-load.mjs');
  const summary={requestAccountingComplete:true,totalRequests:3,censoredRequests:0,timeoutRequests:0,transportErrors:0,http5xxRate:0,
    submitP95Ms:10,pollP95Ms:10,eventAckP95Ms:10,tenants:{quiet:{jobs:{scheduled:1,deadlineMisses:0}}}};
  assert.equal(boundedDaemonVerdict({failures:[]},summary),true);
  summary.tenants.quiet.jobs.deadlineMisses=1;
  assert.equal(boundedDaemonVerdict({failures:[]},summary),false);
});

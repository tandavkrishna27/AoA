import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,mkdirSync,symlinkSync,existsSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import path from 'node:path';
import * as credentialRuntime from '../m4-daemon-load-runtime.mjs';

const validInventory=()=>['quiet','noisy'].map((tenantKey,index)=>({tenantKey,
  workerId:`00000000-0000-4000-8000-00000000000${index+1}`,profileHash:'a'.repeat(64),
  providerProfile:{profileId:'d1-m1-spine',version:1,digest:'b'.repeat(64),maxConcurrentOperations:8,
    resourceCeiling:{cpuMillis:2000,memoryMiB:4096,diskMiB:8192}},
  hello:{protocolVersion:1,workerId:`00000000-0000-4000-8000-00000000000${index+1}`,
    targetId:`00000000-0000-4000-8000-00000000000${index+3}`,policyHash:'c'.repeat(64),capacity:{batchSlots:1}}}));
const inventoryRecord=()=>({type:'inventory',inventory:validInventory()});

test('scheduled wall-time barrier repeats an early timer wake instead of submitting before origin',async()=>{
  let clock=900; const delays=[];
  await credentialRuntime.waitUntilScheduled(1000,{now:()=>clock,sleep:async delay=>{
    delays.push(delay); clock=delays.length===1?999:clock+delay;
  }});
  assert.deepEqual(delays,[100,1]); assert.equal(clock,1000);
});

test('scheduled barrier preserves a late arrival and never backdates or extends its deadline',async()=>{
  const origin=1000,durationMs=15000; let clock=origin+durationMs+1; const delays=[];
  await credentialRuntime.waitUntilScheduled(origin,{now:()=>clock,sleep:async delay=>{delays.push(delay);}});
  const startedAtMs=clock-origin;
  assert.deepEqual(delays,[]); assert.equal(startedAtMs,15001);
  assert.equal(clock>=origin+durationMs,true,'the existing arrival_late check must still fail');
  assert.equal(startedAtMs+10000,25001,'request deadline remains based on actual start');
  clock=origin;
  await credentialRuntime.waitUntilScheduled(origin,{now:()=>clock,sleep:async delay=>{delays.push(delay);}});
  assert.deepEqual(delays,[]); assert.equal(clock-origin,0,'an on-time arrival needs no sleep or timestamp adjustment');
});

test('serialized scheduled barrier has no module-scope dependency and is passed into the campaign',async()=>{
  const {runInNewContext}=await import('node:vm');
  const isolated=runInNewContext('('+credentialRuntime.waitUntilScheduled.toString()+')');
  let clock=999; const waits=[];
  await isolated(1000,{now:()=>clock,sleep:async delay=>{waits.push(delay);clock+=delay;}});
  assert.deepEqual(waits,[1]); assert.equal(clock,1000);
  const source=credentialRuntime.buildDaemonCampaignSource({phase:'loaded',durationMs:15000,drainMs:30000,tenants:[]});
  assert.ok(source.includes('runDaemonCampaign(P,waitUntilScheduled)'));
  assert.ok(source.includes('await waitUntilScheduled(origin+job.scheduledAtMs)'));
  assert.ok(source.includes(credentialRuntime.waitUntilScheduled.toString()));
});

test('independent scheduled producers proceed while an earlier request is still pending',async()=>{
  let clock=900; const sleepers=[],starts=[]; let releaseFirst;
  const firstResponse=new Promise(resolve=>{releaseFirst=resolve;});
  const submit=scheduled=> (async()=>{
    await credentialRuntime.waitUntilScheduled(scheduled,{now:()=>clock,sleep:delay=>new Promise(resolve=>sleepers.push({delay,resolve}))});
    starts.push({scheduled,actual:clock});
    if(scheduled===1000)await firstResponse;
  })();
  const first=submit(1000),second=submit(1050);
  assert.deepEqual(sleepers.map(s=>s.delay),[100,150]);
  clock=1000;sleepers[0].resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(starts,[{scheduled:1000,actual:1000}]);
  clock=1050;sleepers[1].resolve();await second;
  assert.deepEqual(starts,[{scheduled:1000,actual:1000},{scheduled:1050,actual:1050}]);
  releaseFirst();await first;
});

test('fresh fixture renders separate identities, unchanged ceilings and real daemon boot roots',async()=>{
  const {prepareDaemonFixture}=await import('../m4-daemon-load-fixture.mjs');
  const parent=mkdtempSync(path.join(tmpdir(),'m4-fixture-')),dir=path.join(parent,'fresh');
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
    assert.match(manifest.fixtureId,/^[a-f0-9-]{36}$/);
    for(const service of ['postgres','minio','toxiproxy','migrate','control-plane','worker-a','worker-b','fake-provider','test-runner']) {
      assert.equal(overlay.services[service].labels['com.aoa.m4.fixture-id'],manifest.fixtureId);
    }
    assert.ok(overlay.services['control-plane'].volumes.some(v=>v.target==='/load/manifest.private.json'&&v.read_only));
  } finally {rmSync(parent,{recursive:true,force:true});}
});

test('historical64 preparation creates independent enrollment authority with unchanged arrivals/deadlines',async()=>{
  const {prepareDaemonFixture}=await import('../m4-daemon-load-fixture.mjs');
  const parent=mkdtempSync(path.join(tmpdir(),'m4-historical64-'));
  try {
    const first=prepareDaemonFixture(path.join(parent,'first'),{capacityProfile:'historical64'});
    const second=prepareDaemonFixture(path.join(parent,'second'),{capacityProfile:'historical64'});
    assert.equal(first.capacityProfile,'historical64');
    assert.equal(first.durationMs,15000);assert.equal(first.drainMs,30000);
    assert.deepEqual(first.tenants.map(t=>t.rate),[2,20]);
    assert.notEqual(first.fixtureId,second.fixtureId);
    const overlay=JSON.parse(readFileSync(path.join(parent,'first','compose.json'),'utf8'));
    assert.equal(overlay.services['control-plane-b'].profiles,undefined);
    for(let index=0;index<2;index++){
      const t=first.tenants[index],other=second.tenants[index];
      assert.notEqual(t.targetId,other.targetId);assert.notEqual(t.organizationId,other.organizationId);
      assert.equal(overlay.services[t.service].environment.AOA_WORKER_CONCURRENCY_BATCH,'64');
      const registered=JSON.parse(readFileSync(path.join(parent,'first',t.tenantKey+'.profile.json'),'utf8'));
      assert.ok(registered.providerConstraints.profileId.startsWith('m4-historical64-'+first.fixtureId));
      assert.notEqual(readFileSync(path.join(parent,'first',t.tenantKey+'.ticket'),'utf8'),readFileSync(path.join(parent,'second',t.tenantKey+'.ticket'),'utf8'));
    }
    assert.throws(()=>prepareDaemonFixture(path.join(parent,'invalid'),{capacityProfile:'128'}),/capacity/i);
    assert.equal(existsSync(path.join(parent,'invalid')),false);
  }finally{rmSync(parent,{recursive:true,force:true});}
});

test('selected capacity must match durable enrolled inventory, not just a preparation label',async()=>{
  const {assertDaemonCapacityInventory}=await import('../../m4-daemon-load.mjs');
  assert.doesNotThrow(()=>assertDaemonCapacityInventory(validInventory(),'default'));
  assert.throws(()=>assertDaemonCapacityInventory(validInventory(),'historical64'),/capacity|inventory/i);
  const historical=validInventory().map(row=>({...row,providerProfile:{...row.providerProfile,maxConcurrentOperations:64,
    profileId:'m4-historical64-'+row.tenantKey},hello:{...row.hello,capacity:{batchSlots:64}}}));
  assert.doesNotThrow(()=>assertDaemonCapacityInventory(historical,'historical64'));
  assert.throws(()=>assertDaemonCapacityInventory(historical,'default'),/capacity|inventory/i);
  assert.throws(()=>assertDaemonCapacityInventory(historical,'historical64','unrelated-fixture'),/capacity|inventory/i);
});

test('preparation CLI refuses unknown or incomplete selectors before writing a fixture',()=>{
  const parent=mkdtempSync(path.join(tmpdir(),'m4-cli-'));
  try {
    const script=fileURLToPath(new URL('../../m4-daemon-load.mjs',import.meta.url));
    for(const [index,args] of [['--capacity-profile'],['--capacity-profile','128'],['--capacity-profile','default','extra']].entries()) {
      const dir=path.join(parent,'fresh-'+index);
      const result=spawnSync(process.execPath,[script,'prepare',dir,...args],{encoding:'utf8'});
      assert.equal(result.status,1);assert.equal(existsSync(dir),false);
    }
  }finally{rmSync(parent,{recursive:true,force:true});}
});

test('prepare refuses relative, existing, populated and junction-ancestor paths before credentials',async()=>{
  const {prepareDaemonFixture}=await import('../m4-daemon-load-fixture.mjs');
  const parent=mkdtempSync(path.join(tmpdir(),'m4-refusal-'));
  try {
    assert.throws(()=>prepareDaemonFixture('relative-private-fixture'),/absolute/i);
    assert.throws(()=>prepareDaemonFixture(parent),/fresh|exist/i);
    mkdirSync(path.join(parent,'real'));
    symlinkSync(path.join(parent,'real'),path.join(parent,'alias'),process.platform==='win32'?'junction':'dir');
    assert.throws(()=>prepareDaemonFixture(path.join(parent,'alias','fresh')),/link|junction/i);
    assert.equal(existsSync(path.join(parent,'real','fresh','manifest.private.json')),false);
  }finally{rmSync(parent,{recursive:true,force:true});}
});

test('Windows ACL command failure refuses an empty directory before any private file write',async()=>{
  const {createPrivateFixtureDirectory}=await import('../m4-daemon-load-private-directory.mjs');
  const parent=mkdtempSync(path.join(tmpdir(),'m4-acl-refusal-')),dir=path.join(parent,'fresh');
  try {
    assert.throws(()=>createPrivateFixtureDirectory(dir,{platform:'win32',run:()=>({status:1})}),/private|ACL|identity/i);
    assert.deepEqual(readdirSync(dir),[]);
  }finally{rmSync(parent,{recursive:true,force:true});}
});

test('runtime source parses and uses actual HTTP submit plus production placement instead of SQL placement',async()=>{
  const {buildDaemonCampaignSource}=await import('../m4-daemon-load-runtime.mjs');
  const {Script}=await import('node:vm');
  const source=buildDaemonCampaignSource({phase:'baseline',durationMs:15000,drainMs:30000,tenants:[]});
  new Script(`(async()=>{${source}})()`);
  assert.ok(source.includes('/companies/'));
  assert.ok(source.includes('createJobPlacementService'));
  assert.ok(!/INSERT INTO (jobs|job_attempts|leases)\b/.test(source));
  assert.ok(!source.includes('INSERT INTO job_secret_handles'));
});

test('assembler joins lost worker starts and refuses a missing daemon journal',async()=>{
  const {assembleDaemonPhase}=await import('../../m4-daemon-load.mjs');
  const records=[inventoryRecord(),{type:'phase',originMs:10000,durationMs:15000,tenantKeys:['quiet'],jobs:[]},
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
    assert.throws(()=>assembleDaemonPhase([inventoryRecord(),phase,{...result,jobs}],workers),/job/i);
  }
});

test('durable inventory is mandatory, validated and compared against stream inventory',async()=>{
  const {assembleDaemonPhase,assertMatchingDaemonInventory}=await import('../../m4-daemon-load.mjs');
  const tail=[{type:'phase',originMs:10000,durationMs:15000,tenantKeys:['quiet'],jobs:[]},
    {type:'result',jobs:[],failures:[],observedUntilMs:45000}];
  const workers={quiet:[{type:'boot',tenantKey:'quiet',atMs:9999}]};
  for(const inventory of [undefined,[],[{}],validInventory().map(r=>({...r,profileHash:null}))]) {
    assert.throws(()=>assembleDaemonPhase(inventory?[{type:'inventory',inventory},...tail]:tail,workers),/inventory/i);
  }
  const records=[inventoryRecord(),...tail];
  const {raw}=assembleDaemonPhase(records,workers,{streamRecords:records});
  assert.deepEqual(raw.inventory,validInventory());
  assert.throws(()=>assembleDaemonPhase(records,workers,{streamRecords:tail}),/inventory/i);
  const changed=inventoryRecord();changed.inventory[0].providerProfile.maxConcurrentOperations=9;
  assert.throws(()=>assembleDaemonPhase(records,workers,{streamRecords:[changed,...tail]}),/inventory/i);
  assert.throws(()=>assertMatchingDaemonInventory(undefined,undefined),/inventory/i);
  assert.throws(()=>assertMatchingDaemonInventory(validInventory(),changed.inventory),/inventory/i);
  assert.doesNotThrow(()=>assertMatchingDaemonInventory(validInventory(),validInventory()));
});

test('project identity refuses foreign fixture labels or a different manifest bind before executing',async()=>{
  const {verifyDaemonProjectIdentity}=await import('../../m4-daemon-load.mjs');
  const fixtureId='00000000-0000-4000-8000-000000000009',project='aoa-m4-daemon-check',directory=path.resolve(tmpdir(),'m4-test-fixture');
  const manifest={fixtureId,tenants:[{service:'worker-a'},{service:'worker-b'}]};
  const containers=['control-plane','worker-a','worker-b'].map(service=>({Config:{Labels:{'com.docker.compose.project':project,
    'com.docker.compose.service':service,'com.aoa.m4.fixture-id':fixtureId}},State:{Running:true},
    Mounts:service==='control-plane'?[{Type:'bind',Source:path.join(directory,'manifest.private.json'),Destination:'/load/manifest.private.json',RW:false}]:[]}));
  assert.doesNotThrow(()=>verifyDaemonProjectIdentity(containers,manifest,directory,project));
  const foreign=structuredClone(containers);foreign[0].Config.Labels['com.aoa.m4.fixture-id']='another';
  assert.throws(()=>verifyDaemonProjectIdentity(foreign,manifest,directory,project),/fixture|project/i);
  const otherBind=structuredClone(containers);otherBind[0].Mounts[0].Source=path.join(directory,'other.private.json');
  assert.throws(()=>verifyDaemonProjectIdentity(otherBind,manifest,directory,project),/manifest|bind/i);
  assert.throws(()=>verifyDaemonProjectIdentity([],manifest,directory,project),/project|container/i);
  const historical={...manifest,capacityProfile:'historical64'};
  assert.throws(()=>verifyDaemonProjectIdentity(containers,historical,directory,project),/running/i);
  const replica=structuredClone(containers[0]);replica.Config.Labels['com.docker.compose.service']='control-plane-b';
  assert.doesNotThrow(()=>verifyDaemonProjectIdentity([...containers,replica],historical,directory,project));
});

test('a job timeout fails the bounded verdict even with successful request histograms',async()=>{
  const {boundedDaemonVerdict}=await import('../../m4-daemon-load.mjs');
  const summary={requestAccountingComplete:true,totalRequests:3,censoredRequests:0,timeoutRequests:0,transportErrors:0,http5xxRate:0,
    submitP95Ms:10,pollP95Ms:10,eventAckP95Ms:10,tenants:{quiet:{jobs:{scheduled:1,deadlineMisses:0}}}};
  assert.equal(boundedDaemonVerdict({failures:[]},summary),true);
  summary.tenants.quiet.jobs.deadlineMisses=1;
  assert.equal(boundedDaemonVerdict({failures:[]},summary),false);
});

test('credential setup initializes deployment mode and creates the catalog company key before authorizing mint',async()=>{
  const calls=[],tenants=[{companyId:'quiet-company'},{companyId:'noisy-company'}];
  const result=await credentialRuntime.prepareDaemonCredentialFixture({deploymentMode:'authenticated',tenants},{
    setDeploymentMode:mode=>calls.push(['mode',mode]),
    companyKeyTargetForAdapter:adapter=>{calls.push(['adapter',adapter]);return {secretName:'provider:fixture',envVar:'ANTHROPIC_API_KEY'};},
    secretService:()=>({getByName:async(company,name)=>{calls.push(['get',company,name]);return null;},
      create:async(company,value)=>{calls.push(['create',company,value.name]);assert.equal(value.value,'m4-deterministic-fixture-only');}}),
  });
  assert.deepEqual(calls[0],['mode','authenticated']);
  assert.deepEqual(calls.filter(c=>c[0]==='create'),[['create','quiet-company','provider:fixture'],['create','noisy-company','provider:fixture']]);
  assert.equal(result.mintCredentialAuthority,'company_api_key');
});

test('credential setup does not issue company authority after missing provider mapping or failed storage',async()=>{
  const input={deploymentMode:'authenticated',tenants:[{companyId:'company'}]};
  await assert.rejects(()=>credentialRuntime.prepareDaemonCredentialFixture(input,{setDeploymentMode:()=>{},companyKeyTargetForAdapter:()=>null}),/provider/i);
  await assert.rejects(()=>credentialRuntime.prepareDaemonCredentialFixture(input,{setDeploymentMode:()=>{},
    companyKeyTargetForAdapter:()=>({secretName:'provider:fixture',envVar:'ANTHROPIC_API_KEY'}),secretService:()=>({getByName:async()=>null,create:async()=>{throw Error('storage failed');}})}),/storage failed/);
});

const credentialServerDist=process.env.AOA_M4_SERVER_DIST||fileURLToPath(new URL('../../../server/dist',import.meta.url));
test('real one-shot builder and required placement mint accept the fixture without a manually inserted handle',
  {skip:!existsSync(path.join(credentialServerDist,'services/execution-secret-handle-mint-runner.js'))?'requires same-candidate built server dist (AOA_M4_SERVER_DIST)':false},async()=>{
  // A workspace exports TS source; the packaged image exports built JS. Register
  // the pinned workspace loader only for this real-module regression, no copies.
  const unregister=createRequire(path.join(credentialServerDist,'m4-test.cjs'))('tsx/esm/api').register({tsconfig:false});
  const load=rel=>import(pathToFileURL(path.join(credentialServerDist,rel)).href);
  let mode,previous;
  try {
    mode=await load('config/deployment-mode.js');previous=mode.getDeploymentMode();mode.setDeploymentMode('local_trusted');
    const invocations=await load('services/one-shot-distributed-invocation.js');
    const secrets=await load('services/secrets.js');
    const {mintExecutionSecretHandleForPlacement}=await load('services/execution-secret-handle-mint-runner.js');
    const operationId='01234567-1234-4234-8234-012345678901',companyId='01234567-1234-4234-8234-012345678902';
    const stored=[],inserted=[];
    const repo={loadAgentAdapterBinding:async()=>{throw Error('one-shot must not load agent');},
      insertExecutionSecretHandle:async value=>{inserted.push(value);return {handle:value.handle,minted:true};}};
    const source={kind:'one_shot',operationKind:'readiness_probe',operationId};
    const legacyInput={organizationId:'01234567-1234-4234-8234-012345678903',companyId,jobId:'01234567-1234-4234-8234-012345678904',
      executorPrincipalKind:'worker',executorPrincipalId:operationId,placementOwner:'organization_dedicated',credentialKind:null,targetGeneration:1,
      jobSource:{sourceKind:'one_shot',sourceIdentity:operationId,sourceIntent:source,
        input:{command:'claude',args:[],stdinArtifactId:null,maxRuntimeSeconds:600}}};
    assert.deepEqual(await mintExecutionSecretHandleForPlacement(repo,legacyInput),{minted:false,reason:'not_cloud_deployment'});
    mode.setDeploymentMode('authenticated');
    assert.deepEqual(await mintExecutionSecretHandleForPlacement(repo,legacyInput),{minted:false,reason:'adapter_not_v1_scope'});
    mode.setDeploymentMode('local_trusted');
    const prepared=await credentialRuntime.prepareDaemonCredentialFixture({deploymentMode:'authenticated',tenants:[{companyId}]},{
      setDeploymentMode:mode.setDeploymentMode,companyKeyTargetForAdapter:secrets.companyKeyTargetForAdapter,
      secretService:()=>({getByName:async()=>null,create:async(company,value)=>stored.push({company,...value})}),
    });
    const command=credentialRuntime.buildDaemonLoadCommand(operationId,invocations);
    assert.equal(invocations.oneShotAdapterForWorkload(command.input),'claude_local');
    assert.equal(command.input.maxRuntimeSeconds,600);
    const recognized={...legacyInput,jobSource:{...legacyInput.jobSource,sourceIntent:command.source,input:command.input}};
    assert.deepEqual(await mintExecutionSecretHandleForPlacement(repo,recognized),{minted:false,reason:'owner_authority_disagreement'});
    const outcome=await mintExecutionSecretHandleForPlacement(repo,{...recognized,credentialKind:prepared.mintCredentialAuthority});
    assert.equal(outcome.minted,true);
    assert.equal(inserted.length,1);assert.equal(stored.length,1);
    assert.equal(inserted[0].refId,stored[0].name);
    assert.equal(inserted[0].ownerPrincipalId,operationId);
    assert.equal(inserted[0].boundTargetGeneration,1);
  } finally {if(mode)mode.setDeploymentMode(previous);await unregister();}
});

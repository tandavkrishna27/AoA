// Generates private, disposable D1 engineering inputs; performs no Docker action.
import {readFileSync,writeFileSync} from 'node:fs';
import {generateKeyPairSync,randomBytes,randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPrivateFixtureDirectory} from './m4-daemon-load-private-directory.mjs';
import {engineeringCapacityProfile} from '../../docker/control-plane/seed-d1-worker-enrolment.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export function prepareDaemonFixture(directory,{capacityProfile='default'}={}) {
  const capacity=engineeringCapacityProfile(capacityProfile);
  createPrivateFixtureDirectory(directory);
  const write=(name,value)=>writeFileSync(path.join(directory,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  const template=JSON.parse(readFileSync(path.join(repo,'docker/d1/m1-spine-worker.profile.json'),'utf8'));
  const hash=createHash('sha256').update('{"policyId":"job-submission-default","sourceKind":"one_shot","version":1}').digest('hex');
  const manifest={version:1,fixtureId:randomUUID(),capacityProfile:capacity.name,durationMs:15000,drainMs:30000,requestTimeoutMs:10000,
    scope:'API submission and real networked daemons, deterministic provider fixture; not actual provider D5',
    tenants:['quiet','noisy'].map((tenantKey,index)=>({tenantKey,service:index?'worker-a':'worker-b',rate:index?20:2,
      organizationId:randomUUID(),companyId:randomUUID(),agentId:randomUUID(),targetId:randomUUID(),
      token:'aoa_'+randomBytes(32).toString('hex'),secretName:'m4-engineering-fixture',policyHash:hash}))};
  write('manifest.private.json',manifest);
  const keys=generateKeyPairSync('ed25519');
  write('signing-key.pem',keys.privateKey.export({type:'pkcs8',format:'pem'}));
  write('public-key.pem',keys.publicKey.export({type:'spki',format:'pem'}));
  write('fixture.env','AOA_D1_SPINE_SECRETS_MASTER_KEY='+randomBytes(32).toString('hex')+'\n');
  const bind=(file,target)=>({type:'bind',source:path.resolve(directory,file).replaceAll('\\','/'),target,read_only:true});
  const rollout=JSON.stringify({organizations:Object.fromEntries(manifest.tenants.map(t=>[t.organizationId,{mode:'canary',workloads:['batch']}]))});
  const common={AOA_DISTRIBUTED_EXECUTION_ROLLOUT:rollout,AOA_CONTROL_PLANE_SIGNING_KEY_FILE:'/keys/signing-key.pem',
    AOA_SECRETS_MASTER_KEY:'${AOA_D1_SPINE_SECRETS_MASTER_KEY:?generated fixture.env required}'};
  const overlay={services:{
    migrate:{entrypoint:['sh','-c','/usr/local/bin/migrate-entrypoint.sh && node /cp-app/m4-seed.mjs'],
      environment:{AOA_D1_SEED_WORKER_ENROLMENT:'0'},volumes:[bind('seed.mjs','/cp-app/m4-seed.mjs'),bind('manifest.private.json','/load/manifest.private.json')]},
    'control-plane':{environment:common,volumes:[bind('signing-key.pem','/keys/signing-key.pem'),bind('manifest.private.json','/load/manifest.private.json')]},
    'control-plane-b':{profiles:['m4-not-started'],environment:common,volumes:[bind('signing-key.pem','/keys/signing-key.pem')]},
    'test-runner':{depends_on:{'control-plane-b':{condition:'service_healthy',required:false}}},
    'fake-provider':{environment:{AOA_FAKE_PROVIDER_WIRE_PORT:'8082',AOA_FAKE_PROVIDER_CONTROL_PLANE_PUBLIC_KEY_FILE:'/keys/public-key.pem',
      AOA_FAKE_PROVIDER_CTL_ALLOW:'worker-a,worker-b,test-runner'},volumes:[bind('public-key.pem','/keys/public-key.pem')]},
  },volumes:{}};
  if(capacity.controlPlaneReplicas===2)delete overlay.services['control-plane-b'].profiles;
  for(const tenant of manifest.tenants) {
    const key=tenant.tenantKey;
    const profile={...template,targetId:tenant.targetId,organizationId:tenant.organizationId,policyHash:hash};
    if(capacity.name==='historical64')profile.providerConstraints={...template.providerConstraints,profileId:'m4-historical64-'+manifest.fixtureId+'-'+key};
    write(key+'.profile.json',profile);
    const code='aoa_enr_'+randomBytes(16).toString('base64url')+'.'+randomBytes(32).toString('base64url');
    write(key+'.ticket','aoa_tkt_'+Buffer.from(JSON.stringify({v:1,targetId:tenant.targetId,code})).toString('base64url')+'\n');
    overlay.services.migrate.volumes.push(bind(key+'.profile.json','/load/'+key+'.profile.json'),bind(key+'.ticket','/load/'+key+'.ticket'));
    overlay.services[tenant.service]={command:['node','--import','/load/probe.mjs','/worker-net-app/dist/bin/networked-host.js'],
      environment:{AOA_WORKER_TARGET_PROFILE_ID:'d1-m1-spine-worker',AOA_WORKER_KEY_STORE_MODE:'file_record',AOA_WORKER_STATE_DIR:'/worker',
        AOA_WORKER_TARGET_SCOPE:'organization',AOA_WORKER_ENROLLMENT_CODE_FILE:'/enrollment-code',AOA_WORKER_DISPATCH_ENABLED:'1',
        AOA_WORKER_EVENT_OUTBOX_PATH:'/worker/event-outbox.db',AOA_WORKER_CONCURRENCY_BATCH:String(capacity.batchSlots),
        AOA_WORKER_PROVIDER_URL:'http://fake-provider:8082',AOA_M4_PROBE_LOG:'/worker/m4-requests.ndjson',AOA_M4_PROBE_TENANT:key},
      volumes:[{type:'volume',source:'m4-'+key+'-state',target:'/worker'},bind(key+'.profile.json','/profile.json'),bind(key+'.ticket','/enrollment-code'),bind('probe.mjs','/load/probe.mjs')]};
    overlay.volumes['m4-'+key+'-state']={};
  }
  for(const service of ['postgres','minio','toxiproxy',...Object.keys(overlay.services)]) {
    overlay.services[service]??={};
    overlay.services[service].labels={'com.aoa.m4.fixture-id':manifest.fixtureId};
  }
  write('probe.mjs',readFileSync(path.join(repo,'scripts/lib/m4-daemon-fetch-probe.mjs'),'utf8'));
  write('compose.json',overlay);
  write('seed.mjs',`import postgres from 'postgres';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const P=JSON.parse(readFileSync('/load/manifest.private.json','utf8'));
const sql=postgres(process.env.DATABASE_URL,{max:1});
try {
 for(const t of P.tenants) {
  await sql\`INSERT INTO organizations(id,name,slug) VALUES(\${t.organizationId},'M4 isolated engineering fixture',\${'m4-'+t.organizationId})\`;
  await sql\`INSERT INTO companies(id,organization_id,name,issue_prefix) VALUES(\${t.companyId},\${t.organizationId},'M4 disposable',\${'M'+t.companyId.replaceAll('-','').slice(0,12).toUpperCase()})\`;
  await sql\`INSERT INTO agents(id,company_id,name,adapter_type) VALUES(\${t.agentId},\${t.companyId},'M4 synthetic engine','process')\`;
  await sql\`INSERT INTO agent_api_keys(agent_id,company_id,name,key_hash) VALUES(\${t.agentId},\${t.companyId},'M4 disposable submit',\${createHash('sha256').update(t.token).digest('hex')})\`;
  const child=spawnSync(process.execPath,['/cp-app/seed-d1-worker-enrolment.mjs'],{env:{...process.env,
   AOA_D1_SEED_WORKER_ENROLMENT:'1',AOA_D1_SEED_WORKER_CAPACITY_PROFILE:P.capacityProfile,
   AOA_D1_SEED_WORKER_PROFILE_FILE:'/load/'+t.tenantKey+'.profile.json',AOA_D1_SEED_ENROLMENT_TICKET_FILE:'/load/'+t.tenantKey+'.ticket'},encoding:'utf8'});
  if(child.status!==0)throw Error('M4 enrollment fixture seed failed');
  // Routing slug required by the production resolver, not a placement snapshot.
  await sql\`UPDATE execution_targets SET slug='aoa-canary-e2b' WHERE id=\${t.targetId} AND organization_id=\${t.organizationId}\`;
 }
} finally {await sql.end({timeout:5});}
`);
  return manifest;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Linux guarded host retains ownership after bootstrap and preserves identity across restart', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { mkdir, symlink, writeFile, link } from 'node:fs/promises';
    import { runContainerHost } from '/worker-app/dist/bin/container-host.js';
    import { provisionSlot } from '/worker-app/dist/identity/slot-binding.js';
    import { generateDeviceKey, exportDevicePrivateKeyPkcs8Der } from '/worker-app/dist/identity/device-key.js';
    const targetId='a3000000-0000-4000-8000-000000000003';
    const workerId='a3000000-0000-4000-8000-000000000005';
    await mkdir('/tmp/binding');
    await provisionSlot({bindingDir:'/tmp/binding', slotId:'desktop-1', organizationId:'a3000000-0000-4000-8000-000000000004',targetId});
    const env={AOA_WORKER_STATE_DIR:'/worker', AOA_WORKER_SLOT_BINDING_DIR:'/tmp/binding',
      AOA_WORKER_TARGET_SCOPE:'organization', AOA_WORKER_KEY_STORE_MODE:'file_record',
      AOA_WORKER_CONTROL_PLANE_URL:'https://control.example.com', AOA_WORKER_EVENT_OUTBOX_PATH:'/worker/events.db',
      AOA_WORKER_ENROLLMENT_CODE_ENV:'TICKET', TICKET:'fixture'};
    let calls=0, exits=0, heldProcess;
    const proc={once(){},exit(){exits++}};
    const bootstrap=async deps=>{
      calls++; heldProcess=deps.proc;
      const key=generateDeviceKey();
      assert.throws(()=>deps.identityStore.saveIfAbsent({v:1,workerId,targetId:'a3000000-0000-4000-8000-000000000004',deviceGeneration:1,privateKeyPkcs8Der:exportDevicePrivateKeyPkcs8Der(key)}), /target/);
      deps.identityStore.saveIfAbsent({v:1,workerId,targetId,deviceGeneration:1,privateKeyPkcs8Der:exportDevicePrivateKeyPkcs8Der(key)});
      deps.receiptStore.saveIfAbsent({v:1,workerId,targetId,deviceGeneration:1,deviceThumbprint:key.deviceThumbprint});
      await deps.onEnrollmentPersisted(); return {ok:true};
    };
    assert.equal((await runContainerHost({env,proc,bootstrap,log(){}})).ok,true);
    assert.equal((await runContainerHost({env,proc,bootstrap,log(){}})).ok,false);
    assert.equal(calls,1,'bootstrap must return without releasing runtime ownership');
    const beforeExit=exits; heldProcess.exit(0);
    for(let i=0;i<100 && exits===beforeExit;i++) await new Promise(r=>setTimeout(r,10));
    const restart=async deps=>{ heldProcess=deps.proc; assert.equal(deps.identityStore.load().workerId,workerId); await deps.onEnrollmentPersisted();return {ok:true}; };
    assert.equal((await runContainerHost({env,proc,bootstrap:restart,log(){}})).ok,true);
    heldProcess.exit(0); await new Promise(r=>setTimeout(r,50));
    assert.equal((await runContainerHost({env:{...env,AOA_WORKER_EVENT_OUTBOX_PATH:'/tmp/escape.db'},proc,bootstrap,log(){}})).ok,false);
    await symlink('/tmp/escape.db','/worker/alias.db');
    assert.equal((await runContainerHost({env:{...env,AOA_WORKER_EVENT_OUTBOX_PATH:'/worker/alias.db'},proc,bootstrap,log(){}})).ok,false);
    assert.equal(calls,1,'invalid paths must refuse before bootstrap');
    await mkdir('/worker/other-slot');
    await writeFile('/worker/hardlink.db', 'fixture'); await link('/worker/hardlink.db','/worker/other-slot/shared-recovery.db');
    assert.equal((await runContainerHost({env:{...env,AOA_WORKER_EVENT_OUTBOX_PATH:'/worker/hardlink.db'},proc,bootstrap:restart,log(){}})).ok,false,'hard-linked recovery state must refuse');
  `;
  const result = spawnSync('docker',['run','--rm','--network','none','--user','node',
    ...(process.env.AOA_WORKER_TEST_DOCKER_LABEL ? ['--label',process.env.AOA_WORKER_TEST_DOCKER_LABEL] : []),
    process.env.AOA_M4_WORKER_IMAGE ?? 'aoa-worker:m4-slots-local','node','--input-type=module','-e',script],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
});

test('Linux slot processes isolate storage, refuse duplicate ownership, and retain identity after crash and restore', () => {
  const childScript = `
    import assert from 'node:assert/strict';
    import { runContainerHost } from '/worker-app/dist/bin/container-host.js';
    import { generateDeviceKey, exportDevicePrivateKeyPkcs8Der } from '/worker-app/dist/identity/device-key.js';
    const [binding,state,targetId,workerId] = process.argv.slice(1);
    const env={AOA_WORKER_STATE_DIR:state,AOA_WORKER_SLOT_BINDING_DIR:binding,
      AOA_WORKER_TARGET_SCOPE:'organization',AOA_WORKER_KEY_STORE_MODE:'file_record',
      AOA_WORKER_CONTROL_PLANE_URL:'https://control.example.com',
      AOA_WORKER_EVENT_OUTBOX_PATH:state+'/events.db',
      AOA_WORKER_ENROLLMENT_CODE_ENV:'TICKET',TICKET:'fixture'};
    const result=await runContainerHost({env,proc:process,log:message=>console.log(message),
      bootstrap:async deps=>{
        console.log('BOOTSTRAP_REACHED');
        const prior=deps.identityStore.load();
        if (prior) {
          assert.equal(prior.targetId,targetId); assert.equal(prior.workerId,workerId);
          assert.equal(deps.receiptStore.load().workerId,workerId);
        } else {
          const key=generateDeviceKey();
          assert.equal(deps.identityStore.saveIfAbsent({v:1,workerId,targetId,deviceGeneration:1,
            privateKeyPkcs8Der:exportDevicePrivateKeyPkcs8Der(key)}),'stored');
          assert.equal(deps.receiptStore.saveIfAbsent({v:1,workerId,targetId,deviceGeneration:1,
            deviceThumbprint:key.deviceThumbprint}),'stored');
        }
        await deps.onEnrollmentPersisted();
        return {ok:true};
      }});
    if (!result.ok) process.exit(1);
    console.log('READY '+workerId);
    setInterval(()=>{},1000);
  `;
  const script = `
    import assert from 'node:assert/strict';
    import { mkdir, readFile, copyFile, rm } from 'node:fs/promises';
    import { spawn, spawnSync } from 'node:child_process';
    import { provisionSlot } from '/worker-app/dist/identity/slot-binding.js';
    const childScript=${JSON.stringify(childScript)};
    const org='a3000000-0000-4000-8000-000000000004';
    const ids=[
      ['a','a3000000-0000-4000-8000-000000000011','a3000000-0000-4000-8000-000000000021'],
      ['b','a3000000-0000-4000-8000-000000000012','a3000000-0000-4000-8000-000000000022'],
      ['c','a3000000-0000-4000-8000-000000000013','a3000000-0000-4000-8000-000000000023'],
    ];
    const paths=ids.map(([name])=>({binding:'/tmp/binding-'+name,state:'/tmp/state-'+name}));
    const args=(binding,state,index)=>[binding,state,ids[index][1],ids[index][2]];
    for(let i=0;i<ids.length;i++){
      await mkdir(paths[i].binding); await mkdir(paths[i].state);
      await provisionSlot({bindingDir:paths[i].binding,slotId:'desktop-'+ids[i][0],
        organizationId:org,targetId:ids[i][1]});
    }
    const active=new Set();
    async function start(binding,state,index){
      const child=spawn(process.execPath,['--input-type=module','-e',childScript,...args(binding,state,index)]);
      active.add(child);
      let output='';
      try {
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('worker readiness timed out: '+output)),5000);
          child.stdout.on('data',chunk=>{
            output+=chunk.toString();
            if(output.includes('READY '+ids[index][2])){clearTimeout(timer);resolve();}
          });
          child.stderr.on('data',chunk=>{output+=chunk.toString();});
          child.once('close',(code,signal)=>{clearTimeout(timer);reject(new Error('worker exited '+code+'/'+signal+': '+output));});
          child.once('error',reject);
        });
        return child;
      } catch(error){active.delete(child);child.kill('SIGKILL');throw error;}
    }
    async function crash(child){
      child.kill('SIGKILL');
      await new Promise(resolve=>child.once('close',resolve));
      active.delete(child);
    }
    function refused(binding,state,index){
      const run=spawnSync(process.execPath,['--input-type=module','-e',childScript,...args(binding,state,index)],
        {encoding:'utf8',timeout:5000});
      assert.equal(run.status,1,JSON.stringify(run));
      assert.doesNotMatch(run.stdout,/BOOTSTRAP_REACHED/,'refusal must precede bootstrap/network seam');
    }
    try {
      let a=await start(paths[0].binding,paths[0].state,0);
      refused(paths[0].binding,paths[1].state,0); // live binding already owned
      refused(paths[1].binding,paths[0].state,1); // live state already owned
      const b=await start(paths[1].binding,paths[1].state,1);
      const identityA=JSON.parse(await readFile(paths[0].state+'/identity.json','utf8'));
      const identityB=JSON.parse(await readFile(paths[1].state+'/identity.json','utf8'));
      assert.notEqual(identityA.workerId,identityB.workerId);
      assert.notEqual(identityA.targetId,identityB.targetId);
      assert.notEqual(identityA.privateKeyPkcs8B64,identityB.privateKeyPkcs8B64);
      await crash(a);
      a=await start(paths[0].binding,paths[0].state,0); // SIGKILL releases locks, no remint
      assert.deepEqual(JSON.parse(await readFile(paths[0].state+'/identity.json','utf8')),identityA);
      await crash(a);
      await copyFile(paths[0].state+'/identity.json','/tmp/identity-a-snapshot');
      await rm(paths[0].state+'/identity.json');
      refused(paths[0].binding,paths[0].state,0); // established state loss cannot remint
      await copyFile('/tmp/identity-a-snapshot',paths[0].state+'/identity.json');
      await copyFile(paths[1].state+'/identity.json',paths[0].state+'/identity.json');
      refused(paths[0].binding,paths[0].state,0); // restored worker bytes belong to another target
      await copyFile('/tmp/identity-a-snapshot',paths[0].state+'/identity.json');
      await copyFile(paths[1].state+'/slot-incarnation.json','/tmp/marker-b-snapshot');
      await copyFile(paths[0].state+'/slot-incarnation.json','/tmp/marker-a-snapshot');
      await copyFile('/tmp/marker-b-snapshot',paths[0].state+'/slot-incarnation.json');
      refused(paths[0].binding,paths[0].state,0); // restored state incarnation is wrong
      await copyFile('/tmp/marker-a-snapshot',paths[0].state+'/slot-incarnation.json');
      a=await start(paths[0].binding,paths[0].state,0);
      const replacement=await start(paths[2].binding,paths[2].state,2);
      const identityC=JSON.parse(await readFile(paths[2].state+'/identity.json','utf8'));
      assert.notEqual(identityC.targetId,identityA.targetId);
      assert.notEqual(identityC.workerId,identityA.workerId);
      await crash(replacement); await crash(a);
      refused(paths[0].binding,paths[2].state,0); // old binding cannot take replacement state even after release
      const replacementRestart=await start(paths[2].binding,paths[2].state,2);
      assert.deepEqual(JSON.parse(await readFile(paths[2].state+'/identity.json','utf8')),identityC);
      await crash(replacementRestart); await crash(b);
    } finally { for(const child of active) child.kill('SIGKILL'); }
  `;
  const result = spawnSync('docker',['run','--rm','--network','none','--user','node',
    ...(process.env.AOA_WORKER_TEST_DOCKER_LABEL ? ['--label',process.env.AOA_WORKER_TEST_DOCKER_LABEL] : []),
    process.env.AOA_M4_WORKER_IMAGE ?? 'aoa-worker:m4-slots-local','node','--input-type=module','-e',script],
    {encoding:'utf8',timeout:45000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
});

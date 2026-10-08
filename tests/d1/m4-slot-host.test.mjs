import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Linux guarded host retains ownership after bootstrap and preserves identity across restart', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { mkdir, symlink } from 'node:fs/promises';
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
  `;
  const result = spawnSync('docker',['run','--rm','--network','none','--user','node',
    process.env.AOA_M4_WORKER_IMAGE ?? 'aoa-worker:m4-slots-local','node','--input-type=module','-e',script],{encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
});

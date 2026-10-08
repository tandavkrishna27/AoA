// Runs the real compiled ownership helper in a disposable, networkless Linux container.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Linux slot lock: contention, aliases, crash release and unavailable holder', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { mkdir, symlink, unlink, readFile } from 'node:fs/promises';
    import { spawn } from 'node:child_process';
    import { acquireSlotOwnership } from '/worker-app/dist/identity/slot-ownership.js';
    import { provisionSlot, prepareSlot } from '/worker-app/dist/identity/slot-binding.js';
    await mkdir('/tmp/state'); await mkdir('/tmp/binding');
    await symlink('/tmp/state', '/tmp/alias');
    const owner = await acquireSlotOwnership(['/tmp/state', '/tmp/binding']);
    await assert.rejects(acquireSlotOwnership(['/tmp/alias']), /owned/);
    await owner.release(); await owner.release();
    const next = await acquireSlotOwnership(['/tmp/state']); await next.release();
    await assert.rejects(acquireSlotOwnership(['/tmp/state'], { executable: '/missing-flock' }), /holder/);
    const child = spawn(process.execPath, ['--input-type=module', '-e',
      "import { acquireSlotOwnership } from '/worker-app/dist/identity/slot-ownership.js'; await acquireSlotOwnership(['/tmp/state']); console.log('READY'); setInterval(()=>{},1000)"]);
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
    child.kill('SIGKILL'); await new Promise(resolve => child.once('close', resolve));
    let recovered;
    for (let i=0; i<100; i++) { try { recovered = await acquireSlotOwnership(['/tmp/state']); break; } catch { await new Promise(r=>setTimeout(r,20)); } }
    assert.ok(recovered, 'parent crash must release kernel ownership'); await recovered.release();
    await unlink('/tmp/state/.aoa-slot.lock');
    await symlink('/tmp/other', '/tmp/state/.aoa-slot.lock');
    await assert.rejects(acquireSlotOwnership(['/tmp/state']));
    await unlink('/tmp/state/.aoa-slot.lock');
    const monitored = await acquireSlotOwnership(['/tmp/state']);
    const children = (await readFile('/proc/self/task/'+process.pid+'/children', 'utf8')).trim().split(/\\s+/);
    const commands = await Promise.all(children.filter(Boolean).map(async pid => [pid, await readFile('/proc/'+pid+'/cmdline', 'utf8').catch(()=> '')]));
    const holderPid = commands.find(([, command]) => command.startsWith('cat'))?.[0];
    assert.ok(holderPid, JSON.stringify(commands));
    process.kill(Number(holderPid), 'SIGKILL');
    const loss = await Promise.race([monitored.lost, new Promise((_, reject)=>setTimeout(()=>reject(new Error('loss not reported')),2000))]);
    assert.match(loss.message, /holder exited/); await monitored.release();
    await mkdir('/tmp/a'); await mkdir('/tmp/z');
    const last = await acquireSlotOwnership(['/tmp/z']);
    await assert.rejects(acquireSlotOwnership(['/tmp/a', '/tmp/z']), /owned/);
    const first = await acquireSlotOwnership(['/tmp/a']); await first.release(); await last.release();
    await mkdir('/tmp/records'); await mkdir('/tmp/data');
    await provisionSlot({ bindingDir:'/tmp/records', slotId:'desktop-1', organizationId:'a3000000-0000-4000-8000-000000000004', targetId:'a3000000-0000-4000-8000-000000000003' });
    const prepared = await prepareSlot({bindingDir:'/tmp/records', stateDir:'/tmp/data'}); prepared.validateIdentity(null,null);
    const replay = await prepareSlot({bindingDir:'/tmp/records', stateDir:'/tmp/data'});
    assert.throws(()=>replay.validateIdentity(null,null), /missing/);
  `;
  const result = spawnSync('docker', ['run', '--rm', '--network', 'none', '--user', 'node', '--entrypoint', 'node',
    process.env.AOA_M4_WORKER_IMAGE ?? 'aoa-worker:m4-slots-local', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
});

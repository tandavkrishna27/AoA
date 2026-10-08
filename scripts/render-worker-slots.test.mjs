import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkerSlotInventory, renderWorkerSlots, evaluateWorkerSlotInvariants } from './lib/worker-slot-inventory.mjs';

const sample = () => ({ v: 1, min: 1, max: 8, workerImage: 'example.invalid/aoa-worker@sha256:'+'a'.repeat(64),
  controlPlaneUrl: 'https://aoa.example.com', providerUrl: 'https://provider.example.com', slots: [{
    slotId: 'desktop-1', organizationId: 'a3000000-0000-4000-8000-000000000004', targetId: 'a3000000-0000-4000-8000-000000000003',
    bindingDir: '/srv/aoa/bindings/desktop-1', volumeName: 'aoa-desktop-1-state', enrollmentSecret: 'aoa-desktop-1-ticket', failureDomain: 'desktop',
  }] });

test('renders guarded single-replica slots with separate external custody', () => {
  const inventory = sample(); const result = JSON.parse(renderWorkerSlots(validateWorkerSlotInventory(inventory)));
  const worker = result.services['desktop-1'];
  assert.equal(worker.deploy.replicas, 1);
  assert.equal(worker.deploy.update_config.order, 'stop-first');
  assert.equal(worker.environment.AOA_WORKER_SLOT_BINDING_DIR, '/slot-binding');
  assert.equal(worker.environment.AOA_WORKER_DISPATCH_ENABLED, '0');
  assert.equal(result.volumes['aoa-desktop-1-state'].external, true);
  assert.equal(result.secrets['aoa-desktop-1-ticket'].file, '/srv/aoa/bindings/desktop-1/enrollment.ticket');
  assert.equal(worker.volumes[1].bind.create_host_path, false);
  assert.equal(renderWorkerSlots(inventory), renderWorkerSlots(inventory));
});
for (const key of ['slotId', 'targetId', 'bindingDir', 'volumeName', 'enrollmentSecret']) {
  test(`rejects duplicate ${key}`, () => { const inventory = sample(); inventory.slots.push({ ...inventory.slots[0], slotId:'desktop-2', targetId:'a3000000-0000-4000-8000-000000000006', bindingDir:'/srv/aoa/bindings/desktop-2', volumeName:'aoa-desktop-2-state', enrollmentSecret:'aoa-desktop-2-ticket' });
    inventory.slots[1][key] = inventory.slots[0][key];
    assert.throws(() => renderWorkerSlots(inventory), /duplicate/);
  });
}
test('rejects invalid bounds, secret interpolation and unknown fields', () => {
  assert.throws(() => renderWorkerSlots({ ...sample(), min: 9 }), /bound/);
  assert.throws(() => renderWorkerSlots({ ...sample(), slots: [] }), /bound/);
  const inventory = sample(); inventory.slots[0].enrollmentSecret = '${SECRET}'; assert.throws(() => renderWorkerSlots(inventory));
  assert.throws(() => renderWorkerSlots({ ...sample(), E2B_API_KEY: 'must-not-copy' }));
});
test('staging guard rejects cloned replicas and shared durable storage', () => {
  const rendered = JSON.parse(renderWorkerSlots(sample()));
  assert.deepEqual(evaluateWorkerSlotInvariants(rendered, ['desktop-1']), []);
  rendered.services['desktop-1'].deploy.replicas = 2;
  assert.match(evaluateWorkerSlotInvariants(rendered, ['desktop-1']).join('\n'), /replica/);
});
test('requires pinned image and secure remote endpoints', () => {
  assert.throws(() => renderWorkerSlots({ ...sample(), workerImage: 'worker:latest' }));
  assert.throws(() => renderWorkerSlots({ ...sample(), controlPlaneUrl: 'http://public.example.com' }));
});

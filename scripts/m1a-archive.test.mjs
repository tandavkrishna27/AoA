import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, chmod, readFile, open, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareArchive, validateArchiveBytes } from './lib/m1a-archive/evidence.mjs';

const hash = b => createHash('sha256').update(b).digest('hex');
const now = () => new Date('2026-09-27T12:00:00.000Z');
const account = '010438509726';
const uploader = `arn:aws:iam::${account}:user/aoa-s3-artifacts`;
const reader = `arn:aws:iam::${account}:user/synthetic-reader`;
const argv = ['--contract', '/contract', '--expected-contract-sha256', 'PIN', '--inventory', '/inventory', '--input-root', '/source', '--scratch-root', '/scratch', '--output', '/receipt', '--allow-upload'];
async function api() { return import('./m1a-archive.mjs'); }
function fixture() {
  const raw = Buffer.from('final failure; cleanup not observed');
  const members = [{ path: 'job.txt', sha256: hash(raw), size: raw.length, format: 'utf8', artifactId: 'artifact-1', category: 'logs' }];
  const identity = { candidate: 'a'.repeat(40), campaignId: 'm1a-run', runId: '123', runAttempt: 1, qaAttempt: 'a1' };
  const contract = { schema: 1, classification: 'M1A_ARCHIVE_INPUT', ...identity, completedAt: '2026-09-27T11:00:00.000Z',
    requiredRetainUntil: '2027-03-26T12:00:00.000Z', members,
    finalObservations: [{ job: 'build', conclusion: 'failure', cleanupObserved: false, evidencePath: 'job.txt' }],
    redactionReview: { reviewerId: 'redactor', reviewedAt: '2026-09-27T11:30:00.000Z', sourceInventorySha256: hash(JSON.stringify(members)) } };
  const pin = hash(JSON.stringify(contract));
  const bytes = Buffer.from(JSON.stringify({ format: 'aoa-m1a-archive-v1', contractSha256: pin, contract,
    members: [{ path: 'job.txt', sha256: hash(raw), size: raw.length, base64: raw.toString('base64') }] }));
  const expected = { contractSha256: pin, sha256: hash(bytes), size: bytes.length, identity,
    requiredRetainUntil: contract.requiredRetainUntil, expectedJobs: ['build'], requiredCategories: ['logs'] };
  const inventory = { sourceInventorySha256: contract.redactionReview.sourceInventorySha256, expectedJobs: ['build'], requiredCategories: ['logs'] };
  return { raw, contract, pin, bytes, expected, inventory, args: argv.map(x => x === 'PIN' ? pin : x) };
}
function store(f, readonly = false, tamper = false) {
  const sum = createHash('sha256').update(f.bytes).digest('base64');
  return { identify: async () => ({ account, arn: readonly ? reader : uploader }),
    inspectConfiguration: async () => ({ versioning: { Status: 'Enabled' }, encryption: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] }, objectLock: { ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 180 } } } }),
    ...readonly ? {} : { put: async () => ({ versionId: 'version-1', checksumSha256: sum }) },
    head: async () => ({ versionId: tamper ? 'wrong-version' : 'version-1', size: f.bytes.length, checksumSha256: sum, encryption: 'AES256', lastModified: now().toISOString() }),
    get: async () => ({ versionId: 'version-1', bytes: f.bytes, checksumSha256: sum, encryption: 'AES256' }),
    retention: async () => ({ mode: 'COMPLIANCE', retainUntil: f.expected.requiredRetainUntil }) };
}
function caps(f, changes = {}) {
  const events = [], outputs = [];
  return { events, outputs, dependencies: {
    readInput: async p => p === '/contract' ? f.contract : f.inventory,
    prepareArchive: async o => { events.push('prepare'); assert.equal(o.expectedContractSha256, f.pin); return validateArchiveBytes({ bytes: f.bytes, expected: f.expected }); },
    createStore: async () => { events.push('store'); return store(f); },
    writeExclusive: async () => { events.push('reserve'); return { write: async value => { outputs.push(value); }, close: async () => {} }; }, now,
    ...changes } };
}
test('explicit_upload_intent_required_before_store', async () => {
  const f = fixture(), c = caps(f); const m = await api();
  assert.equal((await m.runArchiveCommand(f.args.slice(0, -1), c.dependencies)).exitCode, 2); assert.deepEqual(c.events, []);
});
test('unknown_duplicate_options_refused', async () => {
  const f = fixture(), m = await api();
  for (const extra of [['--output', '/other'], ['--allow-upload'], ['--promote'], ['--contract=/x'], ['--output']]) {
    const c = caps(f); assert.equal((await m.runArchiveCommand([...f.args, ...extra], c.dependencies)).exitCode, 2); assert.deepEqual(c.events, []);
  }
});
test('no_arbitrary_endpoint_or_principal_override', async () => {
  const f = fixture(), m = await api();
  for (const flag of ['endpoint', 'principal', 'bucket', 'region', 'runner', 'executable', 'privacy', 'sign', 'dispatch']) {
    const c = caps(f); assert.equal((await m.runArchiveCommand([...f.args, `--${flag}`, 'x'], c.dependencies)).exitCode, 2); assert.deepEqual(c.events, []);
  }
});
test('no_receipt_overwrite', async () => {
  const f = fixture(), m = await api(), c = caps(f, { writeExclusive: async () => { throw new Error('EEXIST sensitive'); } });
  const result = await m.runArchiveCommand(f.args, c.dependencies);
  assert.equal(result.exitCode, 1); assert.equal(c.events.includes('store'), false); assert.equal(JSON.stringify(result).includes('sensitive'), false);
});
test('external_inventory_pin_and_required_sets_are_mandatory', async () => {
  const m = await api();
  for (const change of [f => delete f.inventory.sourceInventorySha256, f => f.inventory.sourceInventorySha256 = 'b'.repeat(64),
    f => f.inventory.expectedJobs = [], f => delete f.inventory.requiredCategories, f => f.inventory.extra = true]) {
    const f = fixture(); change(f); const c = caps(f);
    assert.equal((await m.runArchiveCommand(f.args, c.dependencies)).exitCode, 1); assert.deepEqual(c.events, []);
  }
});
test('no_dev_receipt_promotion', async () => {
  const f = fixture(); f.contract.classification = 'DEV_ONLY'; const c = caps(f), m = await api();
  assert.equal((await m.runArchiveCommand(f.args, c.dependencies)).exitCode, 1); assert.deepEqual(c.events, []);
});
test('real_modules_are_reachable_roundtrip_and_version_tamper_refuses_output', async t => {
  const f = fixture(), m = await api(); let productionPrepared;
  if (process.platform !== 'win32') {
    const root = await mkdtemp(join(tmpdir(), 'm1a-cli-source-')); await chmod(root, 0o700);
    t.after(() => rm(root, { recursive: true, force: true })); await writeFile(join(root, 'job.txt'), f.raw, { mode: 0o600 });
    productionPrepared = await prepareArchive({ contract: f.contract, expectedContractSha256: f.pin, ...f.inventory, root });
    assert.deepEqual(productionPrepared.bytes, f.bytes);
  }
  const c = caps(f, productionPrepared ? { prepareArchive: async () => productionPrepared } : {});
  const upload = await m.runArchiveCommand(f.args, c.dependencies);
  assert.equal(upload.exitCode, 0); assert.equal(upload.result.status, 'uploaded_verified_pending_independent_review');
  assert.ok(c.events.indexOf('reserve') < c.events.indexOf('store'));
  assert.equal(Object.hasOwn(upload.result, 'ret01Compliant'), false);
  const { runVerifyArchiveCommand } = await import('./verify-m1a-archive.mjs');
  const verifyArgs = ['--facts', '/facts', '--expected', '/expected', '--authority', '/authority', '--scratch-root', '/scratch', '--output', '/review'];
  for (const tamper of [false, true]) {
    const outputs = [];
    const result = await runVerifyArchiveCommand(verifyArgs, { readInput: async p => p === '/facts' ? upload.result : p === '/expected' ? { ref: { key: upload.result.destination.key, versionId: 'version-1' }, expected: f.expected } : { expectedAccount: account, expectedArn: reader, reviewerId: 'reader-1' },
      createReadOnlyStore: async () => store(f, true, tamper), writeExclusive: async () => ({ write: async value => outputs.push(value), close: async () => {} }), now });
    assert.equal(result.exitCode, tamper ? 1 : 0); assert.equal(outputs.length, tamper ? 0 : 1);
  }
  let cloudWrites = 0;
  const rejected = await runVerifyArchiveCommand(verifyArgs, { readInput: async p => p === '/facts' ? upload.result : p === '/expected' ? { ref: { key: upload.result.destination.key, versionId: 'version-1' }, expected: f.expected } : { expectedAccount: account, expectedArn: reader, reviewerId: 'reader-1' },
    createReadOnlyStore: async () => ({ ...store(f, true), put: async () => { cloudWrites++; } }),
    writeExclusive: async () => ({ write: async () => assert.fail('write-capable store accepted'), close: async () => {} }), now });
  assert.equal(rejected.exitCode, 1); assert.equal(cloudWrites, 0);
});
test('snapshot_trusted_inputs_across_async_boundaries', async () => {
  const f = fixture(), c = caps(f); const original = c.dependencies.readInput;
  c.dependencies.readInput = async p => { if (p === '/inventory') f.contract.members[0].sha256 = 'b'.repeat(64); return original(p); };
  const originalPrepare = c.dependencies.prepareArchive;
  c.dependencies.prepareArchive = async o => { assert.equal(o.contract.members[0].sha256, hash(f.raw)); f.inventory.expectedJobs[0] = 'malicious'; return originalPrepare(o); };
  assert.equal((await (await api()).runArchiveCommand(f.args, c.dependencies)).exitCode, 0);
});
test('postput_and_receipt_failures_keep_known_ref_without_retry', async () => {
  const f = fixture(), m = await api();
  for (const readFail of [true, false]) {
    let puts = 0;
    const c = caps(f, { createStore: async () => { const s = store(f); const put = s.put; s.put = async a => { puts++; return put(a); }; if (readFail) s.head = async () => { throw new Error('RAW SECRET'); }; return s; },
      writeExclusive: async () => ({ write: async () => { throw new Error('RAW SECRET'); }, close: async () => {} }) });
    const r = await m.runArchiveCommand(f.args, c.dependencies);
    assert.equal(r.exitCode, 1); assert.equal(r.result.ref.versionId, 'version-1'); assert.equal(puts, 1); assert.equal(JSON.stringify(r).includes('RAW'), false);
  }
});
test('receipt_cleanup_cannot_mask_known_postput_version', async () => {
  const f = fixture(), c = caps(f, {
    createStore: async () => { const s = store(f); s.head = async () => { throw new Error('raw'); }; return s; },
    writeExclusive: async () => ({ write: async () => {}, close: async () => { throw new Error('cleanup raw'); } })
  });
  const r = await (await api()).runArchiveCommand(f.args, c.dependencies);
  assert.equal(r.exitCode, 1); assert.equal(r.result.ref?.versionId, 'version-1');
});
test('production_import_is_inert_and_private_io_refuses_git_or_windows_unavailable', async t => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^AWS_|^NODE_OPTIONS$|^NODE_PATH$/i.test(k)));
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./scripts/m1a-archive.mjs'); await import('./scripts/verify-m1a-archive.mjs');"], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(imported.status, 0); assert.equal(imported.stdout, ''); assert.equal(imported.stderr, '');
  for (const script of ['m1a-archive.mjs', 'verify-m1a-archive.mjs']) {
    const child = spawnSync(process.execPath, [`scripts/${script}`, '--endpoint', 'forbidden'], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 2); assert.deepEqual(JSON.parse(child.stdout), { error: 'M1A_SYNTAX' }); assert.equal(child.stderr, '');
  }
  const m = await api(); await assert.rejects(() => m.readPrivateInput(join(process.cwd(), 'package.json')));
  const root = await mkdtemp(join(tmpdir(), 'm1a-cli-io-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'input'), '{}', { mode: 0o600 });
  if (process.platform === 'win32') {
    await assert.rejects(() => m.readPrivateInput(join(root, 'input')), { code: 'M1A_SOURCE_PRIVACY_UNAVAILABLE' });
    await assert.rejects(() => m.reservePrivateOutput(join(root, 'output')), { code: 'SCRATCH_PRIVACY_UNAVAILABLE' });
  } else {
    await chmod(root, 0o700); assert.deepEqual(await m.readPrivateInput(join(root, 'input')), {});
    const receipt = await m.reservePrivateOutput(join(root, 'output')); await receipt.write({ storage: 'facts' }); await receipt.close();
    assert.deepEqual(JSON.parse(await readFile(join(root, 'output'), 'utf8')), { storage: 'facts' });
    await assert.rejects(() => m.reservePrivateOutput(join(root, 'output')));
    await writeFile(join(root, 'large'), Buffer.alloc(1024 * 1024 + 1), { mode: 0o600 });
    await assert.rejects(() => m.readPrivateInput(join(root, 'large')), { code: 'M1A_INPUT_BOUND' });
    const empty = await m.reservePrivateOutput(join(root, 'failed')); await empty.close();
    await assert.rejects(() => m.reservePrivateOutput(join(root, 'failed'))); assert.equal((await stat(join(root, 'failed'))).size, 0);
    const changed = await m.reservePrivateOutput(join(root, 'changed')); await writeFile(join(root, 'changed'), 'external');
    await assert.rejects(() => changed.write({ sensitive: 'data' }), { code: 'M1A_OUTPUT_REFUSED' }); await changed.close();
    assert.equal(await readFile(join(root, 'changed'), 'utf8'), 'external');
    const held = await open(join(root, 'input'), 'r'); const prototype = Object.getPrototypeOf(held), original = prototype.read; await held.close();
    let reads = 0;
    const mock = t.mock.method(prototype, 'read', async function (...args) {
      const result = await original.apply(this, args);
      if (++reads === 1) await writeFile(join(root, 'input'), '{"growth":true}', { mode: 0o600 });
      return result;
    });
    try { await assert.rejects(() => m.readPrivateInput(join(root, 'input')), { code: 'M1A_INPUT_CHANGED' }); }
    finally { mock.mock.restore(); }
  }
});

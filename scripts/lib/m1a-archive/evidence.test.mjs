import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Independent fixtures spell out the externally pinned serialization.
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sort = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const descriptor = m => ({ path: m.path, sha256: m.sha256, size: m.size,
  format: m.format, artifactId: m.artifactId, category: m.category });
const inventory = ms => ms.map(descriptor).sort((a, b) => sort(a.path, b.path));
function fixture(entries = [{ path: 'job.txt', bytes: Buffer.from('final observation: failure; cleanup observed'), format: 'utf8' }]) {
  const members = entries.map((e, i) => ({ path: e.path, sha256: hash(e.bytes), size: e.bytes.length,
    format: e.format, artifactId: `artifact-${i}`, category: 'logs' }));
  const contract = { schema: 1, classification: 'M1A_ARCHIVE_INPUT', candidate: 'a'.repeat(40),
    campaignId: 'm1a-run', runId: '123', runAttempt: 1, qaAttempt: 'a1',
    completedAt: '2026-09-27T00:00:00.000Z', requiredRetainUntil: '2027-03-26T00:00:00.000Z', members,
    finalObservations: [{ job: 'build', conclusion: 'failure', cleanupObserved: false, evidencePath: entries[0].path }],
    redactionReview: { reviewerId: 'reviewer-1', reviewedAt: '2026-09-27T01:00:00.000Z', sourceInventorySha256: hash(JSON.stringify(inventory(members))) } };
  return { contract, entries };
}
function canonical(c) {
  return { schema: c.schema, classification: c.classification, candidate: c.candidate,
    campaignId: c.campaignId, runId: c.runId, runAttempt: c.runAttempt, qaAttempt: c.qaAttempt,
    completedAt: c.completedAt, requiredRetainUntil: c.requiredRetainUntil, members: inventory(c.members),
    finalObservations: c.finalObservations.map(o => ({ job: o.job, conclusion: o.conclusion,
      cleanupObserved: o.cleanupObserved, evidencePath: o.evidencePath })).sort((a, b) => sort(a.job, b.job)),
    redactionReview: { reviewerId: c.redactionReview.reviewerId, reviewedAt: c.redactionReview.reviewedAt,
      sourceInventorySha256: c.redactionReview.sourceInventorySha256 } };
}
function bundle(f) {
  const c = canonical(f.contract);
  const contractSha256 = hash(JSON.stringify(c));
  const bytes = Buffer.from(JSON.stringify({ format: 'aoa-m1a-archive-v1', contractSha256, contract: c,
    members: [...f.entries].sort((a, b) => sort(a.path, b.path)).map(e => ({ path: e.path,
      sha256: hash(e.bytes), size: e.bytes.length, base64: e.bytes.toString('base64') })) }));
  return { bytes, expected: { contractSha256, sha256: hash(bytes), size: bytes.length,
    identity: { candidate: c.candidate, campaignId: c.campaignId, runId: c.runId, runAttempt: c.runAttempt, qaAttempt: c.qaAttempt },
    requiredRetainUntil: c.requiredRetainUntil, expectedJobs: ['build'], requiredCategories: ['logs'], secretCanaries: ['SYNTHETIC_CANARY_7391'] } };
}
async function api() {
  try { return await import('./evidence.mjs'); }
  catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND') assert.fail('Task 2 offline evidence implementation is missing'); throw e; }
}

test('final_fix_source_and_input_file_reject_replaceable_posix_ancestors', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'm1a-ancestor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parent = join(root, 'shared'); await mkdir(parent); await chmod(parent, 0o777);
  const leaf = join(parent, 'private'); await mkdir(leaf, { mode: 0o700 });
  const path = join(leaf, 'input.json'); await writeFile(path, '{}', { mode: 0o600 });
  const m = await api();
  for (const mode of [0o777, 0o770, 0o702]) {
    await chmod(parent, mode);
    await assert.rejects(m.assertPrivateArchiveInputRoot(leaf), { code: 'M1A_SOURCE_NOT_PRIVATE' });
    await assert.rejects(m.assertPrivateArchiveInputFile(path), { code: 'M1A_SOURCE_NOT_PRIVATE' });
  }
  await chmod(parent, 0o1777);
  await m.assertPrivateArchiveInputRoot(leaf); await m.assertPrivateArchiveInputFile(path);
  await rm(path);
  const f = fixture(); await writeFile(join(leaf, 'job.txt'), f.entries[0].bytes, { mode: 0o600 });
  const options = { contract: f.contract, expectedContractSha256: bundle(f).expected.contractSha256,
    expectedJobs: ['build'], requiredCategories: ['logs'], root: leaf };
  assert.deepEqual((await m.prepareArchive(options)).bytes, bundle(f).bytes);
  await chmod(parent, 0o777);
  await assert.rejects(m.prepareArchive(options), { code: 'M1A_SOURCE_NOT_PRIVATE' });
  await chmod(parent, 0o1777);
  await chmod(leaf, 0o777);
  await assert.rejects(m.assertPrivateArchiveInputFile(join(leaf, 'job.txt')), { code: 'M1A_SOURCE_NOT_PRIVATE' });
});

test('real_only_input_privacy_wrappers_refuse_extra_capabilities', async t => {
  const m = await api();
  assert.equal(typeof m.assertPrivateArchiveInputRoot, 'function');
  assert.equal(typeof m.assertPrivateArchiveInputFile, 'function');
  const root = await mkdtemp(join(tmpdir(), 'm1a-input-wrapper-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'input.json'); await writeFile(path, '{}', { mode: 0o600 });
  for (const [fn, p] of [[m.assertPrivateArchiveInputRoot, root], [m.assertPrivateArchiveInputFile, path]]) {
    await assert.rejects(() => fn(p, undefined), { code: 'M1A_INVALID_INPUT' });
    await assert.rejects(() => fn(p, () => true), { code: 'M1A_INVALID_INPUT' });
    if (process.platform === 'win32') await assert.rejects(() => fn(p), { code: 'M1A_SOURCE_PRIVACY_UNAVAILABLE' });
    else await fn(p);
  }
  await assert.rejects(() => m.assertPrivateArchiveInputRoot(process.cwd()));
});
async function validate(f, change = () => {}) {
  const args = bundle(f); change(args);
  return (await api()).validateArchiveBytes(args);
}
async function refuses(f, change = () => {}) {
  await assert.rejects(() => validate(f, change), e => /^M1A_[A-Z_]+$/.test(e.code) && e.message === e.code);
}
function repin(f) { f.contract.redactionReview.sourceInventorySha256 = hash(JSON.stringify(inventory(f.contract.members))); }

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
// Synthetic ZIP writer, never used by production; preserves original unsafe names.
function zip(entries, archiveComment = Buffer.alloc(0)) {
  const locals = [], central = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name); const bytes = e.bytes ?? Buffer.from('clean log');
    const payload = e.method === 8 ? deflateRawSync(bytes) : bytes;
    const comment = e.comment ?? Buffer.alloc(0), extra = e.extra ?? Buffer.alloc(0);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4);
    h.writeUInt16LE(e.flags ?? 0, 6); h.writeUInt16LE(e.method ?? 0, 8);
    h.writeUInt32LE(e.crc ?? crc32(bytes), 14); h.writeUInt32LE(payload.length, 18);
    h.writeUInt32LE(e.declaredSize ?? bytes.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(extra.length, 28);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x0314, 4); c.writeUInt16LE(20, 6);
    c.writeUInt16LE(e.flags ?? 0, 8); c.writeUInt16LE(e.method ?? 0, 10);
    c.writeUInt32LE(e.crc ?? crc32(bytes), 16); c.writeUInt32LE(payload.length, 20);
    c.writeUInt32LE(e.declaredSize ?? bytes.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt16LE(extra.length, 30); c.writeUInt16LE(comment.length, 32);
    c.writeUInt32LE(e.external ?? 0, 38); c.writeUInt32LE(offset, 42);
    locals.push(h, name, extra, payload); central.push(c, name, extra, comment); offset += h.length + name.length + extra.length + payload.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(archiveComment.length, 20);
  return Buffer.concat([...locals, directory, end, archiveComment]);
}
const zipped = es => fixture([{ path: 'logs.zip', bytes: zip(es), format: 'zip' }]);

test('rejects_missing_extra_duplicate_members', async () => {
  const f = fixture(); await validate(f);
  for (const mutation of [o => o.members.pop(), o => o.members.push(o.members[0]),
    o => o.members.push({ ...o.members[0], path: 'extra.txt' })]) {
    await refuses(f, args => { const o = JSON.parse(args.bytes); mutation(o); args.bytes = Buffer.from(JSON.stringify(o));
      args.expected.sha256 = hash(args.bytes); args.expected.size = args.bytes.length; });
  }
  const alias = fixture([{ path: 'job.txt', bytes: Buffer.from('x'), format: 'utf8' },
    { path: 'JOB.txt', bytes: Buffer.from('y'), format: 'utf8' }]); await refuses(alias);
});
test('binds_inventory_and_final_observations', async () => {
  const f = fixture(); await validate(f);
  const wrongInventory = fixture(); wrongInventory.contract.redactionReview.sourceInventorySha256 = 'b'.repeat(64); await refuses(wrongInventory);
  for (const change of [f => { f.contract.finalObservations = []; },
    f => { f.contract.finalObservations.push(f.contract.finalObservations[0]); },
    f => { f.contract.finalObservations[0].evidencePath = 'absent.txt'; },
    f => { f.contract.finalObservations[0].conclusion = 'pass'; }]) { const f = fixture(); change(f); await refuses(f); }
  for (const change of [e => { e.expectedJobs = []; }, e => { e.requiredCategories = []; },
    e => { e.expectedJobs = ['another-job']; }, e => { e.requiredCategories = ['proof']; },
    e => { e.contractSha256 = 'f'.repeat(64); }, e => { e.identity.qaAttempt = 'a2'; },
    e => { delete e.expectedJobs; }]) await refuses(f, args => change(args.expected));
});
test('preserves_raw_zip_bytes', async () => {
  const f = zipped([{ name: 'dir/', bytes: Buffer.alloc(0) }, { name: 'dir/log.txt', bytes: Buffer.from('clean final failure') }]);
  const p = await validate(f); const o = JSON.parse(p.bytes);
  assert.deepEqual(Buffer.from(o.members[0].base64, 'base64'), f.entries[0].bytes);
  assert.equal(p.sha256, hash(p.bytes)); assert.equal(p.contractSha256, bundle(f).expected.contractSha256);
  assert.deepEqual(Object.keys(p), ['bytes', 'sha256', 'size', 'contractSha256', 'identity', 'requiredRetainUntil']);
});
test('zip_hidden_secret_refused', async () => {
  for (const secret of ['SYNTHETIC_CANARY_7391', 'AWS_ACCESS_KEY_ID=AKIA0000000000000000',
    'Authorization: Bearer synthetic-token-value', '-----BEGIN PRIVATE KEY-----', 'password=synthetic-secret']) {
    const f = zipped([{ name: 'nested/log.txt', bytes: Buffer.from(secret) }]); const original = Buffer.from(f.entries[0].bytes);
    await refuses(f); assert.deepEqual(f.entries[0].bytes, original);
  }
  const f = fixture(); f.contract.redactionReview.reviewerId = 'SYNTHETIC_CANARY_7391'; await refuses(f);
  await refuses(fixture([{ path: 'job.txt', bytes: Buffer.from('password: hidden'), format: 'utf8' }]));
});
test('unsafe_original_zip_name_refused', async () => {
  for (const name of ['../evil.txt', '/evil.txt', 'C:/evil.txt', 'a\\evil.txt', 'a/%2e.txt', 'a//b', 'a/./b', 'a/../b', 'CON.txt', 'a. /b', 'a\u0000x']) await refuses(zipped([{ name }]));
  for (const entries of [[{ name: 'a.txt' }, { name: 'a.txt' }], [{ name: 'A.txt' }, { name: 'a.txt' }],
    [{ name: 'a' }, { name: 'a/b.txt' }], [{ name: 'link', external: (0xa1ff << 16) >>> 0 }]]) await refuses(zipped(entries));
});
test('nested_encrypted_binary_archive_refused', async () => {
  for (const entry of [{ name: 'a.txt', flags: 1 }, { name: 'a.txt', method: 12 },
    { name: 'a.zip', bytes: Buffer.from('ordinary text') }, { name: 'a.txt', bytes: zip([{ name: 'inner.txt' }]) },
    { name: 'a.txt', bytes: Buffer.from([0xff, 0xfe, 0x61]) }, { name: 'a.txt', bytes: Buffer.from('x\0y') }]) await refuses(zipped([entry]));
  await refuses(fixture([{ path: 'job.txt', bytes: Buffer.from([0xc0, 0xaf]), format: 'utf8' }]));
});
test('size_bounds_before_upload', async () => {
  await refuses(zipped([{ name: 'big.txt', declaredSize: 64 * 1024 * 1024 + 1 }]));
  await refuses(zipped([{ name: 'a.txt', declaredSize: 40 * 1024 * 1024 }, { name: 'b.txt', declaredSize: 40 * 1024 * 1024 }]));
  await refuses(zipped(Array.from({ length: 4097 }, (_, i) => ({ name: `entry-${i}.txt` }))));
  const many = fixture(Array.from({ length: 129 }, (_, i) => ({ path: `member-${i}.txt`, bytes: Buffer.from('x'), format: 'utf8' }))); await refuses(many);
  const huge = fixture(); huge.contract.members[0].size = 64 * 1024 * 1024 + 1; repin(huge); await refuses(huge);
  await refuses(fixture(), a => { a.bytes = Buffer.alloc(128 * 1024 * 1024 + 1); });
});
test('dev_relabeling_refused', async () => {
  const f = fixture(); f.contract.classification = 'DEV_ONLY'; await refuses(f);
  for (const field of ['approved', 'campaignPass', 'ret01Compliant', 'h08Approved']) {
    const f = fixture(); f.contract[field] = true;
    // Inject forbidden keys into the wire manifest, independently re-pin outer bytes.
    await refuses(f, a => { const o = JSON.parse(a.bytes); o.contract[field] = true; a.bytes = Buffer.from(JSON.stringify(o)); a.expected.sha256 = hash(a.bytes); a.expected.size = a.bytes.length; });
  }
});
test('canonical_order_and_exact_bytes_are_bound', async () => {
  const f = fixture([{ path: 'z.txt', bytes: Buffer.from('z'), format: 'utf8' }, { path: 'A.txt', bytes: Buffer.from('a'), format: 'utf8' }]);
  const p = await validate(f); assert.deepEqual(JSON.parse(p.bytes).contract.members.map(m => m.path), ['A.txt', 'z.txt']);
  await refuses(f, a => { a.bytes = Buffer.concat([a.bytes, Buffer.from('\n')]); a.expected.sha256 = hash(a.bytes); a.expected.size = a.bytes.length; });
  await refuses(f, a => { const o = JSON.parse(a.bytes); o.members[0].base64 = 'YR=='; a.bytes = Buffer.from(JSON.stringify(o)); a.expected.sha256 = hash(a.bytes); a.expected.size = a.bytes.length; });
});
test('source_closure_links_and_privacy', async t => {
  const root = await mkdtemp(join(tmpdir(), 'm1a-evidence-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture(); await writeFile(join(root, 'job.txt'), f.entries[0].bytes, { mode: 0o600 });
  const args = { contract: f.contract, expectedContractSha256: bundle(f).expected.contractSha256,
    expectedJobs: ['build'], requiredCategories: ['logs'], root, secretCanaries: ['SYNTHETIC_CANARY_7391'] };
  const { prepareArchive } = await api();
  let p;
  if (process.platform === 'win32') {
    // No synthetic bypass: a capable, private host can run the closure checks too.
    try { p = await prepareArchive(args); }
    catch (e) {
      assert.ok(['M1A_SOURCE_PRIVACY_UNAVAILABLE', 'M1A_SOURCE_NOT_PRIVATE'].includes(e.code));
      t.diagnostic(`Windows source preparation refused: ${e.code}; source closure success requires a capable private host.`);
      assert.deepEqual(await readFile(join(root, 'job.txt')), f.entries[0].bytes);
      return;
    }
  }
  p ??= await prepareArchive(args); assert.deepEqual(p.bytes, bundle(f).bytes);
  await writeFile(join(root, 'extra.txt'), 'unlisted', { mode: 0o600 });
  await assert.rejects(() => prepareArchive(args)); await rm(join(root, 'extra.txt'));
  await rm(join(root, 'job.txt')); await assert.rejects(() => prepareArchive(args));
  await symlink('/etc/passwd', join(root, 'job.txt')); await assert.rejects(() => prepareArchive(args));
});
test('deflated_secret_content_is_inspected_and_original_is_unchanged', async () => {
  const bytes = Buffer.from('clean prefix\n'.repeat(100) + 'SYNTHETIC_CANARY_7391');
  const f = zipped([{ name: 'log.txt', bytes, method: 8 }]);
  assert.equal(f.entries[0].bytes.includes(Buffer.from('SYNTHETIC_CANARY_7391')), false);
  await assert.rejects(() => validate(f), { code: 'M1A_SECRET_REFUSED' });
  const clean = zipped([{ name: 'log.txt', bytes: Buffer.from('clean log\n'.repeat(100)), method: 8 }]);
  const p = await validate(clean);
  assert.deepEqual(Buffer.from(JSON.parse(p.bytes).members[0].base64, 'base64'), clean.entries[0].bytes);
});
test('deflate_declared_size_cannot_hide_secret_suffix', async () => {
  const prefix = Buffer.from('clean log');
  const f = zipped([{ name: 'log.txt', bytes: Buffer.concat([prefix, Buffer.from('SYNTHETIC_CANARY_7391')]),
    method: 8, declaredSize: prefix.length, crc: crc32(prefix) }]);
  assert.equal(f.entries[0].bytes.includes(Buffer.from('SYNTHETIC_CANARY_7391')), false);
  await refuses(f);
});
test('large_valid_member_does_not_overflow_base64_validation', async () => {
  const f = fixture([{ path: 'job.txt', bytes: Buffer.alloc(2 * 1024 * 1024, 0x61), format: 'utf8' }]);
  const p = await validate(f); assert.equal(JSON.parse(p.bytes).members[0].size, 2 * 1024 * 1024);
});
test('round1_actual_64mib_member_validates_in_bounded_child', async () => {
  // Isolate the maximum fixture and its serialization copies from the test runner.
  const script = `import assert from 'node:assert/strict';
    import { createHash } from 'node:crypto';
    import { validateArchiveBytes } from ${JSON.stringify(new URL('./evidence.mjs', import.meta.url).href)};
    const hash = ${hash.toString()}; const sort = ${sort.toString()};
    const descriptor = ${descriptor.toString()}; const inventory = ${inventory.toString()};
    ${fixture.toString()} ${canonical.toString()} ${bundle.toString()}
    try {
      const size = 64 * 1024 * 1024;
      let f = fixture([{ path: 'job.txt', bytes: Buffer.alloc(size, 0x61), format: 'utf8' }]);
      const args = bundle(f); f = null; global.gc();
      const prepared = await validateArchiveBytes(args);
      assert.equal(prepared.size, args.bytes.length);
      assert.equal(prepared.sha256, args.expected.sha256);
      assert.equal(prepared.contractSha256, args.expected.contractSha256);
      assert.ok(prepared.bytes.equals(args.bytes));
      process.stdout.write('validated-64mib');
    } catch (e) { process.stderr.write(e.code ?? 'CHILD_FAILURE'); process.exitCode = 1; }`;
  const allowed = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => allowed.has(k.toUpperCase())));
  let result;
  try {
    result = { code: 0, ...await promisify(execFile)(process.execPath,
      ['--max-old-space-size=1024', '--expose-gc', '--input-type=module', '-e', script],
      { env, shell: false, windowsHide: true, timeout: 60_000, maxBuffer: 1024 }) };
  } catch (e) { result = { code: e.code, stdout: e.stdout, stderr: e.stderr }; }
  assert.equal(result.code, 0, `Valid 64 MiB member refused: ${result.stderr}`);
  assert.equal(result.stdout, 'validated-64mib'); assert.equal(result.stderr, '');
});
test('round1_base64_padding_whitespace_and_url_alphabet_are_refused', async () => {
  const f = fixture([{ path: 'job.txt', bytes: Buffer.from('a'), format: 'utf8' }]);
  for (const base64 of ['Y===', '=Q==', 'Y=Q=', 'YR==', 'YQ= ', 'YQ=\n', 'YQ-=', 'YQ_=', 'YQ', 'YQ==AA', 'Y!==']) {
    await refuses(f, args => {
      const archive = JSON.parse(args.bytes); archive.members[0].base64 = base64;
      args.bytes = Buffer.from(JSON.stringify(archive));
      args.expected.sha256 = hash(args.bytes); args.expected.size = args.bytes.length;
    });
  }
  for (const value of ['a', 'ab', 'abc']) await validate(fixture([{ path: 'job.txt', bytes: Buffer.from(value), format: 'utf8' }]));
});
test('round1_oversize_declared_member_refused_before_base64_allocation', async () => {
  const f = fixture(); f.contract.members[0].size = 64 * 1024 * 1024 + 1; repin(f);
  await assert.rejects(() => validate(f), { code: 'M1A_SIZE_BOUND' });
});
test('aggregate_inflation_is_bounded_across_zip_members', async () => {
  const entries = ['a.zip', 'b.zip'].map(path => ({ path, bytes: zip([{ name: 'log.txt', method: 8,
    bytes: Buffer.alloc(33 * 1024 * 1024, 0x61) }]), format: 'zip' }));
  await refuses(fixture(entries));
});
test('python_environment_ignores_loaders_and_ambient_credentials', async t => {
  const root = await mkdtemp(join(tmpdir(), 'm1a-python-isolation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'zipfile.py'), 'raise RuntimeError("UNSAFE_PYTHON_LOADER")\n', { mode: 0o600 });
  await writeFile(join(root, 'sitecustomize.py'), 'raise RuntimeError("UNSAFE_PYTHON_SITE")\n', { mode: 0o600 });
  const allowed = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => allowed.has(k.toUpperCase())));
  const args = bundle(zipped([{ name: 'log.txt', method: 8, bytes: Buffer.from('clean log') }]));
  const script = `import { validateArchiveBytes } from ${JSON.stringify(new URL('./evidence.mjs', import.meta.url).href)};
    const args = JSON.parse(process.argv[1]); args.bytes = Buffer.from(args.bytes, 'base64');
    await validateArchiveBytes(args); process.stdout.write('validated');`;
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    ['--input-type=module', '-e', script, JSON.stringify({ ...args, bytes: args.bytes.toString('base64') })],
    { env: { ...env, PYTHONPATH: root, PYTHONHOME: root, PYTHONSTARTUP: join(root, 'sitecustomize.py'),
      AWS_ACCESS_KEY_ID: 'SYNTHETIC_ONLY', AWS_SECRET_ACCESS_KEY: 'SYNTHETIC_ONLY', AWS_SESSION_TOKEN: 'SYNTHETIC_ONLY' },
      shell: false, windowsHide: true, timeout: 60_000 });
  assert.equal(stdout, 'validated'); assert.equal(stderr, '');
});
test('archive_and_member_comments_and_names_cannot_hide_secrets', async () => {
  for (const raw of [zip([{ name: 'log.txt' }], Buffer.from('SYNTHETIC_CANARY_7391')),
    zip([{ name: 'log.txt', comment: Buffer.from('SYNTHETIC_CANARY_7391') }]),
    zip([{ name: 'SYNTHETIC_CANARY_7391.txt' }]),
    zip([{ name: 'log.txt', extra: Buffer.from('SYNTHETIC_CANARY_7391') }]),
    zip([{ name: 'log.txt' }], Buffer.from('Authorization: Bearer synthetic-comment'))]) {
    const f = fixture([{ path: 'logs.zip', bytes: raw, format: 'zip' }]);
    const before = Buffer.from(raw);
    await assert.rejects(() => validate(f), { code: 'M1A_SECRET_REFUSED' }); assert.deepEqual(raw, before);
  }
  const clean = fixture([{ path: 'logs.zip', format: 'zip', bytes: zip([{ name: 'log.txt', comment: Buffer.from('member note') }], Buffer.from('archive note')) }]);
  await validate(clean);
  await refuses(fixture([{ path: 'logs.zip', format: 'zip', bytes: zip([{ name: 'log.txt' }], Buffer.from([0xff])) }]));
  await refuses(zipped([{ name: 'log.txt', extra: Buffer.from([1, 0, 0, 0]) }]));
});
test('masked_headers_are_refused', async () => {
  await refuses(zipped([{ name: 'log.txt', flags: 8192 }]));
});
test('local_only_binary_metadata_is_refused', async () => {
  const raw = zip([{ name: 'log.txt', extra: Buffer.from([1, 0, 0, 0]) }]);
  const central = raw.indexOf(Buffer.from('504b0102', 'hex'));
  const stripped = Buffer.concat([raw.subarray(0, central + 46 + 7), raw.subarray(central + 46 + 7 + 4)]);
  stripped.writeUInt16LE(0, central + 30);
  stripped.writeUInt32LE(stripped.readUInt32LE(stripped.length - 10) - 4, stripped.length - 10);
  await refuses(fixture([{ path: 'logs.zip', bytes: stripped, format: 'zip' }]));
});
test('invalid_inputs_return_only_fixed_codes', async () => {
  const { validateArchiveBytes, prepareArchive } = await api();
  await assert.rejects(() => validateArchiveBytes(undefined), e => /^M1A_[A-Z_]+$/.test(e.code) && e.message === e.code);
  await assert.rejects(() => prepareArchive(undefined), e => /^M1A_[A-Z_]+$/.test(e.code) && e.message === e.code);
});
test('external_job_names_and_reviewer_ids_need_not_be_path_segments', async () => {
  const f = fixture(); f.contract.finalObservations[0].job = 'Build and check';
  f.contract.redactionReview.reviewerId = 'reviewer@example.invalid';
  await validate(f, a => { a.expected.expectedJobs = ['Build and check']; });
});
test('multiple_members_may_belong_to_the_same_artifact', async () => {
  const f = fixture([{ path: 'a.txt', bytes: Buffer.from('a'), format: 'utf8' }, { path: 'b.txt', bytes: Buffer.from('b'), format: 'utf8' }]);
  f.contract.members[1].artifactId = f.contract.members[0].artifactId; repin(f); await validate(f);
});
test('zip_entry_count_is_bounded_across_members', async () => {
  const entries = ['a.zip', 'b.zip'].map(path => ({ path, bytes: zip(Array.from({ length: 2049 }, (_, i) =>
    ({ name: `entry-${i}.txt`, bytes: Buffer.from('x') }))), format: 'zip' }));
  await refuses(fixture(entries));
});
test('unsupported_ascii_binary_formats_are_refused', async () => {
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
  await refuses(zipped([{ name: 'log.txt', bytes: pdf }]));
  await refuses(fixture([{ path: 'job.txt', bytes: pdf, format: 'utf8' }]));
});
test('canonical_contract_hash_normalizes_members_and_observations_before_source_reads', async t => {
  const f = fixture([{ path: 'z.txt', bytes: Buffer.from('z'), format: 'utf8' }, { path: 'a.txt', bytes: Buffer.from('a'), format: 'utf8' }]);
  f.contract.finalObservations.push({ job: 'a-job', conclusion: 'success', cleanupObserved: true, evidencePath: 'a.txt' });
  const args = bundle(f); args.expected.expectedJobs = ['build', 'a-job'];
  const p = await (await api()).validateArchiveBytes(args);
  assert.deepEqual(JSON.parse(p.bytes).contract.finalObservations.map(o => o.job), ['a-job', 'build']);
  const root = await mkdtemp(join(tmpdir(), 'm1a-canonical-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = { contract: f.contract, expectedContractSha256: args.expected.contractSha256,
    expectedJobs: ['build', 'a-job'], requiredCategories: ['logs'], root };
  // Missing sources/private capability can fail only after accepting the correct
  // canonical pin, even though the caller's member/observation arrays are reversed.
  await assert.rejects(() => (async () => (await api()).prepareArchive(source))(), e =>
    ['M1A_INVENTORY_MISMATCH', 'M1A_SOURCE_PRIVACY_UNAVAILABLE', 'M1A_SOURCE_NOT_PRIVATE'].includes(e.code));
  await assert.rejects(() => (async () => (await api()).prepareArchive({ ...source, expectedContractSha256: hash(JSON.stringify(f.contract)) }))(),
    { code: 'M1A_CONTRACT_MISMATCH' });
});
test('exact_member_and_zip_entry_limits_accept_valid_inventory', async () => {
  const f = fixture(Array.from({ length: 128 }, (_, i) => ({ path: `member-${i}.txt`, bytes: Buffer.from('x'), format: 'utf8' })));
  await validate(f);
  await validate(zipped(Array.from({ length: 4096 }, (_, i) => ({ name: `entry-${i}.txt`, bytes: Buffer.from('x') }))));
});
test('implicit_directory_case_aliases_are_refused', async () => {
  await refuses(fixture([{ path: 'A/one.txt', bytes: Buffer.from('a'), format: 'utf8' },
    { path: 'a/two.txt', bytes: Buffer.from('b'), format: 'utf8' }]));
});
test('zip_implicit_directory_case_aliases_are_refused', async () => {
  await refuses(zipped([{ name: 'A/one.txt' }, { name: 'a/two.txt' }]));
});
test('empty_zip_cannot_hide_an_uninspected_binary_prefix', async () => {
  const prefix = deflateRawSync(Buffer.from('SYNTHETIC_CANARY_7391'));
  const raw = Buffer.concat([prefix, zip([])]);
  assert.equal(raw.includes(Buffer.from('SYNTHETIC_CANARY_7391')), false);
  await refuses(fixture([{ path: 'logs.zip', bytes: raw, format: 'zip' }]));
  await validate(fixture([{ path: 'logs.zip', bytes: zip([]), format: 'zip' }]));
});
function insertZipGap(raw, gap) {
  const central = raw.readUInt32LE(raw.length - 6);
  const bytes = Buffer.concat([raw.subarray(0, central), gap, raw.subarray(central)]);
  bytes.writeUInt32LE(central + gap.length, bytes.length - 6);
  return bytes;
}
test('unlisted_binary_records_between_zip_members_and_directory_are_refused', async () => {
  const raw = insertZipGap(zip([{ name: 'log.txt', method: 8 }]), deflateRawSync(Buffer.from('SYNTHETIC_CANARY_7391')));
  assert.equal(raw.includes(Buffer.from('SYNTHETIC_CANARY_7391')), false);
  await refuses(fixture([{ path: 'logs.zip', bytes: raw, format: 'zip' }]));
});
test('standard_data_descriptors_preserve_original_zip_bytes', async () => {
  const bytes = Buffer.from('clean log');
  for (const signature of [false, true]) {
    const descriptor = Buffer.alloc(signature ? 16 : 12); let offset = 0;
    if (signature) { descriptor.writeUInt32LE(0x08074b50); offset = 4; }
    descriptor.writeUInt32LE(crc32(bytes), offset); descriptor.writeUInt32LE(deflateRawSync(bytes).length, offset + 4);
    descriptor.writeUInt32LE(bytes.length, offset + 8);
    const raw = insertZipGap(zip([{ name: 'log.txt', bytes, method: 8, flags: 8 }]), descriptor);
    const p = await validate(fixture([{ path: 'logs.zip', bytes: raw, format: 'zip' }]));
    assert.deepEqual(Buffer.from(JSON.parse(p.bytes).members[0].base64, 'base64'), raw);
  }
});

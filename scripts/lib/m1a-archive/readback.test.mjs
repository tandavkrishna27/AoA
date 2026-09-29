import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateArchiveBytes } from './evidence.mjs';

const ACCOUNT = '010438509726';
const UPLOADER = `arn:aws:iam::${ACCOUNT}:user/aoa-s3-artifacts`;
const VERIFIER = `arn:aws:iam::${ACCOUNT}:user/synthetic-reader`;
const CREATED = '2026-09-27T12:00:00.000Z';
const FLOOR = '2027-03-26T12:00:00.000Z';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const checksum = bytes => createHash('sha256').update(bytes).digest('base64');
const clone = value => structuredClone(value);

// Synthetic canonical memory data: no source-directory privacy claim.
async function fixture({ conclusion = 'failure', cleanupObserved = false, content = 'final failure', deadline = FLOOR } = {}) {
  const raw = Buffer.from(content);
  const members = [{ path: 'job.txt', sha256: hash(raw), size: raw.length, format: 'utf8', artifactId: 'artifact-1', category: 'logs' }];
  const identity = { candidate: 'a'.repeat(40), campaignId: 'm1a-run', runId: '123', runAttempt: 1, qaAttempt: 'a1' };
  const contract = { schema: 1, classification: 'M1A_ARCHIVE_INPUT', ...identity,
    completedAt: '2026-09-27T11:00:00.000Z', requiredRetainUntil: deadline, members,
    finalObservations: [{ job: 'build', conclusion, cleanupObserved, evidencePath: 'job.txt' }],
    redactionReview: { reviewerId: 'redactor', reviewedAt: '2026-09-27T11:30:00.000Z', sourceInventorySha256: hash(JSON.stringify(members)) } };
  const contractSha256 = hash(JSON.stringify(contract));
  const bytes = Buffer.from(JSON.stringify({ format: 'aoa-m1a-archive-v1', contractSha256, contract,
    members: [{ path: 'job.txt', sha256: hash(raw), size: raw.length, base64: raw.toString('base64') }] }));
  const expected = { contractSha256, sha256: hash(bytes), size: bytes.length, identity,
    requiredRetainUntil: deadline, expectedJobs: ['build'], requiredCategories: ['logs'], secretCanaries: ['SYNTHETIC_CANARY'] };
  const prepared = await validateArchiveBytes({ bytes, expected });
  return { prepared, expected };
}
function transport(f, { reader = false } = {}) {
  const calls = [];
  const state = { caller: { account: ACCOUNT, arn: reader ? VERIFIER : UPLOADER },
    config: { versioning: { Status: 'Enabled' }, encryption: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
      objectLock: { ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 180 } } } },
    put: { versionId: 'returned-version', checksumSha256: checksum(f.prepared.bytes) },
    head: { versionId: 'returned-version', size: f.prepared.size, checksumSha256: checksum(f.prepared.bytes), encryption: 'AES256', lastModified: CREATED },
    get: { versionId: 'returned-version', bytes: Buffer.from(f.prepared.bytes), checksumSha256: checksum(f.prepared.bytes), encryption: 'AES256' },
    retention: { mode: 'COMPLIANCE', retainUntil: FLOOR } };
  const store = {};
  for (const [method, field] of [['identify', 'caller'], ['inspectConfiguration', 'config'], ['head', 'head'], ['get', 'get'], ['retention', 'retention'], ...reader ? [] : [['put', 'put']]]) {
    store[method] = async arg => { calls.push({ method, arg }); if (state[field] instanceof Error) throw state[field]; return state[field]; };
  }
  return { store, state, calls };
}
async function api() {
  try { return await import('./readback.mjs'); }
  catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND') assert.fail('Task 3 readback implementation is missing'); throw e; }
}
async function upload(f, t = transport(f), now = () => new Date(CREATED)) {
  return (await api()).uploadPreparedArchive({ store: t.store, ...f, now });
}
async function review(f, facts, t = transport(f, { reader: true }), changes = {}) {
  return (await api()).verifyStoredArchive({ store: t.store, ref: { key: facts.destination.key, versionId: facts.destination.versionId },
    expected: f.expected, authority: { expectedAccount: ACCOUNT, expectedArn: VERIFIER, reviewerId: 'reader-1' },
    uploadFacts: facts, now: () => new Date('2026-10-27T12:00:00.000Z'), ...changes });
}
const fixedError = e => /^M1A_[A-Z_]+$/.test(e.code) && e.message === e.code;

test('put_returned_version_is_the_only_read_target', async () => {
  const f = await fixture(), t = transport(f); const facts = await upload(f, t);
  const key = `replatform/m1a/m1a-run/123-r1/a1/${f.prepared.sha256}.json`;
  assert.deepEqual(t.calls.map(c => c.method), ['identify', 'inspectConfiguration', 'put', 'head', 'get', 'retention']);
  assert.deepEqual(t.calls[2].arg, { key, bytes: f.prepared.bytes, checksumSha256: checksum(f.prepared.bytes) });
  for (const call of t.calls.slice(3)) assert.deepEqual(call.arg, { key, versionId: 'returned-version' });
  assert.deepEqual(facts.destination, { account: ACCOUNT, region: 'us-east-1', bucket: 'aoa-platform-evidence-010438509726-us-east-1-an', key, versionId: 'returned-version' });
  const rt = transport(f, { reader: true }); await review(f, facts, rt);
  for (const call of rt.calls.slice(2)) assert.deepEqual(call.arg, { key, versionId: 'returned-version' });
});

test('missing_wrong_version_checksum_size_refused', async () => {
  const f = await fixture();
  for (const [field, prop, value] of [['put', 'versionId', undefined], ['put', 'versionId', 'null'], ['put', 'checksumSha256', f.prepared.sha256],
    ['head', 'versionId', 'latest'], ['get', 'versionId', undefined], ['head', 'size', f.prepared.size + 1],
    ['head', 'checksumSha256', 'A'.repeat(43) + '='], ['get', 'checksumSha256', undefined], ['get', 'encryption', 'aws:kms'], ['head', 'encryption', undefined], ['get', 'bytes', Buffer.from('wrong')]]) {
    const t = transport(f); t.state[field][prop] = value; await assert.rejects(() => upload(f, t), fixedError);
    assert.equal(t.calls.filter(c => c.method === 'put').length, 1);
  }
});

test('configuration_drift_refused', async () => {
  const f = await fixture();
  for (const change of [c => { c.versioning.Status = 'Suspended'; }, c => { c.encryption.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm = 'aws:kms'; },
    c => { c.objectLock.ObjectLockEnabled = 'Disabled'; }, c => { c.objectLock.Rule.DefaultRetention.Mode = 'GOVERNANCE'; },
    c => { c.objectLock.Rule.DefaultRetention.Days = 179; }, c => { c.objectLock.Rule.DefaultRetention.Years = 1; }, c => { c.encryption.Rules.push(c.encryption.Rules[0]); }]) {
    const t = transport(f); change(t.state.config); await assert.rejects(() => upload(f, t), fixedError); assert.equal(t.calls.some(c => c.method === 'put'), false);
    const facts = await upload(f), rt = transport(f, { reader: true }); change(rt.state.config); await assert.rejects(() => review(f, facts, rt), fixedError);
  }
});

test('trusted_expectations_and_canonical_preput_validation_required', async () => {
  for (const change of [f => { delete f.expected; }, f => { f.expected.contractSha256 = 'b'.repeat(64); }, f => { f.expected.sha256 = 'b'.repeat(64); },
    f => { f.expected.size++; }, f => { f.expected.identity.qaAttempt = 'a2'; }, f => { f.expected.requiredRetainUntil = '2027-04-01T00:00:00.000Z'; },
    f => { f.expected.expectedJobs = []; }, f => { delete f.expected.requiredCategories; }, f => { f.expected.expectedJobs = ['other']; }, f => { f.expected.requiredCategories = ['other']; },
    f => { f.expected.secretCanaries = ['final failure']; }, f => { f.prepared.bytes = Buffer.from(f.prepared.bytes.toString() + '\n'); f.expected.sha256 = f.prepared.sha256 = hash(f.prepared.bytes); f.expected.size = f.prepared.size = f.prepared.bytes.length; }]) {
    const f = await fixture(), t = transport(f); change(f); await assert.rejects(() => upload(f, t), fixedError); assert.equal(t.calls.some(c => c.method === 'put'), false);
  }
});

test('short_governance_retention_refused', async () => {
  const f = await fixture();
  for (const retention of [{ mode: 'GOVERNANCE', retainUntil: FLOOR }, { mode: 'COMPLIANCE', retainUntil: '2027-03-26T11:59:59.999Z' }, { mode: 'COMPLIANCE', retainUntil: 'invalid' }]) {
    const t = transport(f); t.state.retention = retention; await assert.rejects(() => upload(f, t), fixedError);
  }
  const later = await fixture({ deadline: '2027-04-01T12:00:00.000Z' }); await assert.rejects(() => upload(later), fixedError);
  const t = transport(later); t.state.retention.retainUntil = later.expected.requiredRetainUntil; await upload(later, t);
});

test('delayed_review_uses_creation_floor', async () => {
  const f = await fixture(), facts = await upload(f);
  const result = await review(f, facts);
  assert.equal(result.status, 'independently_verified_pending_owner_disposition'); assert.equal(result.verifiedAt, '2026-10-27T12:00:00.000Z');
  await assert.rejects(() => review(f, facts, undefined, { now: () => new Date(FLOOR) }), fixedError);
  const t = transport(f, { reader: true }); t.state.retention.retainUntil = '2027-03-26T11:59:59.999Z'; await assert.rejects(() => review(f, facts, t), fixedError);
});

test('clock_skew_does_not_shorten_retention', async () => {
  const f = await fixture();
  await upload(f, undefined, () => new Date('2026-09-27T11:55:00.000Z'));
  await upload(f, undefined, () => new Date('2026-09-27T12:05:00.000Z'));
  for (const date of ['2026-09-27T11:54:59.999Z', '2026-09-27T12:05:00.001Z', 'invalid']) await assert.rejects(() => upload(f, undefined, () => new Date(date)), fixedError);
  let i = 0; await assert.rejects(() => upload(f, undefined, () => new Date(i++ ? '2026-09-27T11:59:59.000Z' : CREATED)), fixedError);
  const t = transport(f); t.state.head.lastModified = 'invalid'; await assert.rejects(() => upload(f, t), fixedError);
  const short = transport(f); short.state.retention.retainUntil = '2027-03-26T11:59:59.999Z'; await assert.rejects(() => upload(f, short, () => new Date('2026-09-27T11:55:00.000Z')), fixedError);
});

test('uploader_identity_cannot_certify', async () => {
  const f = await fixture(), facts = await upload(f);
  for (const arn of [UPLOADER, `arn:aws:iam::${ACCOUNT}:root`, `arn:aws:iam::${ACCOUNT}:user/`, `arn:aws:iam::${ACCOUNT}:role`, `arn:aws:sts::${ACCOUNT}:assumed-role/reader`, 'reader', 'arn:aws:iam::999999999999:user/reader']) {
    const t = transport(f, { reader: true }); t.state.caller.arn = arn; const receipt = clone(facts); receipt.uploader.arn = VERIFIER;
    await assert.rejects(() => review(f, receipt, t, { authority: { expectedAccount: ACCOUNT, expectedArn: arn, reviewerId: 'reader' } }), fixedError);
  }
  const t = transport(f, { reader: true }); t.state.caller.arn = 'arn:aws:sts::010438509726:assumed-role/synthetic-reader/session';
  await review(f, facts, t, { authority: { expectedAccount: ACCOUNT, expectedArn: t.state.caller.arn, reviewerId: 'reader' } });
  const writable = transport(f); writable.state.caller.arn = VERIFIER; await assert.rejects(() => review(f, facts, writable), fixedError);
  const wrong = transport(f); wrong.state.caller.arn = VERIFIER; await assert.rejects(() => upload(f, wrong), fixedError); assert.equal(wrong.calls.some(c => c.method === 'put'), false);
});

test('tampered_receipt_contract_refused', async () => {
  const f = await fixture(), facts = await upload(f);
  for (const change of [r => { r.contractSha256 = 'b'.repeat(64); }, r => { r.sha256 = 'b'.repeat(64); }, r => { r.size++; }, r => { r.identity.qaAttempt = 'a2'; },
    r => { r.destination.bucket = 'other'; }, r => { r.destination.region = 'other'; }, r => { r.destination.account = '999999999999'; }, r => { r.destination.key += '/extra'; },
    r => { r.destination.versionId = 'other'; }, r => { r.uploader.arn = VERIFIER; }, r => { r.requiredRetainUntil = '2027-04-01T00:00:00.000Z'; },
    r => { r.lastModified = '2026-09-27T11:59:59.000Z'; }, r => { r.retainUntil = '2027-04-01T00:00:00.000Z'; }, r => { r.putCompletedAt = '2026-09-27T11:59:59.000Z'; },
    r => { r.status = 'approved'; }, r => { r.campaignPass = true; }]) {
    const r = clone(facts); change(r); await assert.rejects(() => review(f, r, undefined, { ref: { key: facts.destination.key, versionId: facts.destination.versionId } }), fixedError);
  }
  for (const ref of [{ key: facts.destination.key, versionId: 'null' }, { key: '../escape', versionId: 'returned-version' }, { key: facts.destination.key }]) await assert.rejects(() => review(f, facts, undefined, { ref }), fixedError);
  const expected = clone(f.expected); expected.expectedJobs = ['other']; await assert.rejects(() => review(f, facts, undefined, { expected }), fixedError);
});

test('failure_or_cancelled_evidence_is_not_campaign_pass', async () => {
  for (const conclusion of ['failure', 'cancelled', 'success']) {
    const f = await fixture({ conclusion }), facts = await upload(f), result = await review(f, facts);
    assert.deepEqual(Object.keys(facts), ['schema', 'classification', 'status', 'destination', 'identity', 'contractSha256', 'sha256', 'size', 'uploader', 'putStartedAt', 'putCompletedAt', 'lastModified', 'retainUntil', 'requiredRetainUntil']);
    assert.deepEqual(Object.keys(result), ['classification', 'status', 'verifier', 'reviewerId', 'verifiedAt', 'facts']);
    assert.equal(facts.status, 'uploaded_verified_pending_independent_review'); assert.deepEqual(result.facts, facts);
    assert.equal(Object.values(facts).some(v => typeof v === 'boolean'), false);
  }
});

test('postput_failure_preserves_known_ref_without_retry_or_sensitive_error', async () => {
  const f = await fixture();
  for (const method of ['head', 'get', 'retention']) {
    const t = transport(f); t.state[method] = new Error('SYNTHETIC_SECRET raw transport stderr');
    await assert.rejects(() => upload(f, t), e => fixedError(e) && e.ref?.versionId === 'returned-version' && e.ref.key.endsWith(`${f.prepared.sha256}.json`) && !('cause' in e));
    assert.equal(t.calls.filter(c => c.method === 'put').length, 1);
  }
  const t = transport(f); t.state.put.checksumSha256 = 'wrong'; await assert.rejects(() => upload(f, t), e => fixedError(e) && e.ref.versionId === 'returned-version');
  const uncertain = transport(f); uncertain.state.put = new Error('secret'); await assert.rejects(() => upload(f, uncertain), e => fixedError(e) && !e.ref);
  assert.equal(uncertain.calls.filter(c => c.method === 'put').length, 1);
});

test('external_inputs_and_reference_are_snapshotted', async () => {
  const f = await fixture(), t = transport(f);
  t.store.identify = async () => { f.expected.expectedJobs[0] = 'other'; f.prepared.bytes.fill(0); return t.state.caller; };
  const facts = await upload(f, t); assert.equal(facts.sha256, hash(t.state.get.bytes));
  const clean = await fixture(), rt = transport(clean, { reader: true });
  const ref = { key: facts.destination.key, versionId: facts.destination.versionId };
  rt.store.identify = async () => { ref.versionId = 'latest'; return rt.state.caller; };
  await review(clean, facts, rt, { ref });
  assert.equal(rt.calls.find(c => c.method === 'head').arg.versionId, 'returned-version');
});

test('source_input_errors_cannot_supply_error_codes_or_raw_text', async () => {
  const f = await fixture(), t = transport(f);
  await assert.rejects(() => upload(f, t, () => { throw Object.assign(new Error('raw secret'), { code: 'M1A_SENSITIVE_TOKEN' }); }),
    e => e.code === 'M1A_INVALID_INPUT' && e.message === e.code && !e.cause);
  assert.equal(t.calls.some(c => c.method === 'put'), false);
  const malicious = { ...f.expected }; Object.defineProperty(malicious, 'sha256', { enumerable: true, get() { throw new Error('raw secret'); } });
  await assert.rejects(() => upload({ ...f, expected: malicious }), fixedError);
});

test('independent_identity_and_readback_mismatches_refused', async () => {
  const f = await fixture(), facts = await upload(f);
  for (const [field, prop, value] of [['caller', 'arn', `arn:aws:iam::${ACCOUNT}:user/unpinned`], ['caller', 'account', '999999999999'],
    ['head', 'versionId', 'latest'], ['get', 'versionId', 'latest'], ['head', 'size', f.expected.size + 1],
    ['get', 'bytes', Buffer.from('raw mismatch')], ['retention', 'mode', 'GOVERNANCE']]) {
    const t = transport(f, { reader: true }); t.state[field][prop] = value; await assert.rejects(() => review(f, facts, t), fixedError);
  }
  for (const change of [a => { a.expectedAccount = '999999999999'; }, a => { a.reviewerId = ''; }, a => { a.expectedArn = 'arn:aws:sts::010438509726:assumed-role/reader/session/extra'; }]) {
    const authority = { expectedAccount: ACCOUNT, expectedArn: VERIFIER, reviewerId: 'reader' }; change(authority);
    await assert.rejects(() => review(f, facts, undefined, { authority }), fixedError);
  }
});

test('prepared_metadata_cannot_override_trusted_expected_fields', async () => {
  for (const change of [p => { p.contractSha256 = 'b'.repeat(64); }, p => { p.sha256 = 'b'.repeat(64); }, p => { p.size++; },
    p => { p.identity.runAttempt = 2; }, p => { p.requiredRetainUntil = '2027-04-01T00:00:00.000Z'; }, p => { p.extra = true; }]) {
    const f = await fixture(), t = transport(f); change(f.prepared); await assert.rejects(() => upload(f, t), fixedError);
    assert.equal(t.calls.some(c => c.method === 'put'), false);
  }
});

test('producer_error_ref_is_validated_and_preserved_without_read_or_retry', async () => {
  const f = await fixture(), key = `replatform/m1a/m1a-run/123-r1/a1/${f.expected.sha256}.json`;
  for (const code of ['INVALID_RESPONSE', 'SCRATCH_CLEANUP_FAILED']) {
    const t = transport(f); t.state.put = Object.assign(new Error('raw private diagnostic'), { code, knownVersionRef: { key, versionId: 'known-version' } });
    await assert.rejects(() => upload(f, t), e => fixedError(e) && e.ref?.key === key && e.ref.versionId === 'known-version');
    assert.deepEqual(t.calls.map(c => c.method), ['identify', 'inspectConfiguration', 'put']);
  }
  for (const knownVersionRef of [{ key: 'outside/prefix', versionId: 'v' }, { key, versionId: 'null' }, { key }, { key, versionId: 'v', extra: true }]) {
    const t = transport(f); t.state.put = Object.assign(new Error('secret'), { knownVersionRef });
    await assert.rejects(() => upload(f, t), e => fixedError(e) && !Object.hasOwn(e, 'ref'));
    assert.equal(t.calls.filter(c => c.method === 'put').length, 1);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const account = '010438509726';
const uploader = `arn:aws:iam::${account}:user/aoa-s3-artifacts`;
const reader = `arn:aws:iam::${account}:user/synthetic-TEST-reader`;
const created = '2026-09-27T12:00:00.000Z';
const until = '2027-03-26T12:00:00.000Z';
function recordHash(value) {
  const sorted = v => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
  return hash(JSON.stringify(sorted(value)));
}
async function api() {
  const m = await import('../m1a-evidence-disposition.mjs').catch(e => {
    if (e.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw e;
  });
  assert.equal(typeof m.createTestEvidenceDisposition, 'function', 'missing TEST boundary export');
  assert.equal(typeof m.evaluateEvidenceDisposition, 'function', 'missing evaluator export');
  return m;
}
async function fixture(change = () => {}, cleanupChange = () => {}, rawContent) {
  const m = await api();
  // Synthetic independently reviewed collection: pins are built before upload facts exist.
  const identity = { candidate: 'a'.repeat(40), campaignId: 'synthetic-test', runId: '123', runAttempt: 1, qaAttempt: 'a1' };
  const scope = { repositoryId: 'TEST-repository', workflowId: 'TEST-workflow', ...identity };
  const cleanup = { job: 'build', jobId: 'TEST-job',
    capturedAt: '2026-09-27T10:00:00.000Z', preparation: 'complete', missingContext: [],
    teardownAt: '2026-09-27T10:01:00.000Z', exitCode: 0, residualResources: [], uncertainty: [],
    scanAt: '2026-09-27T10:02:00.000Z', scanPassed: true, contextAvailable: true, contextPrivate: true,
    contextNonUploadable: true, contextDestroyedAt: '2026-09-27T10:03:00.000Z',
    transferredAt: '2026-09-27T10:04:00.000Z', transferSucceeded: true, verifiedAt: '2026-09-27T10:05:00.000Z' };
  cleanupChange(cleanup);
  const terminal = Object.fromEntries(['capturedAt', 'preparation', 'missingContext', 'teardownAt', 'exitCode', 'residualResources', 'uncertainty'].map(k => [k, cleanup[k]]));
  const raw = Buffer.from(rawContent ?? JSON.stringify({ run: clone(scope),
    job: { job: 'build', jobId: 'TEST-job', status: 'completed', conclusion: 'failure', postActionsComplete: true }, cleanup: terminal }));
  const members = [{ path: 'job.txt', sha256: hash(raw), size: raw.length, format: 'utf8', artifactId: 'TEST-artifact', category: 'observations' }];
  const contract = { schema: 1, classification: 'M1A_ARCHIVE_INPUT', ...identity,
    completedAt: '2026-09-27T11:00:00.000Z', requiredRetainUntil: until, members,
    finalObservations: [{ job: 'build', conclusion: 'failure', cleanupObserved: true, evidencePath: 'job.txt' }],
    redactionReview: { reviewerId: 'TEST-redactor', reviewedAt: '2026-09-27T11:30:00.000Z', sourceInventorySha256: hash(JSON.stringify(members)) } };
  const bytes = Buffer.from(JSON.stringify({ format: 'aoa-m1a-archive-v1', contractSha256: hash(JSON.stringify(contract)), contract,
    members: [{ path: 'job.txt', sha256: hash(raw), size: raw.length, base64: raw.toString('base64') }] }));
  const expected = { contractSha256: hash(JSON.stringify(contract)), sha256: hash(bytes), size: bytes.length,
    identity: clone(identity), requiredRetainUntil: until, expectedJobs: ['build'], requiredCategories: ['observations'] };
  const ref = { key: `replatform/m1a/synthetic-test/123-r1/a1/${expected.sha256}.json`, versionId: 'TEST-exact-version' };
  const finalEvidence = { scope: clone(scope), contract: clone(contract), cleanup: [clone(cleanup)] };
  const config = { mode: 'TEST', reviewedCollection: { scope: clone(scope), pinned: { ref: clone(ref), expected: clone(expected) }, finalEvidence: clone(finalEvidence) },
    authority: { mode: 'TEST', approvedBy: 'TEST-external-authority-owner', readOnly: true,
      authority: { expectedAccount: account, expectedArn: reader, reviewerId: 'TEST-reader' } },
    ownerAuthority: { mode: 'TEST', ownerId: 'TEST-ret-owner', attribution: 'TEST-external-attribution' } };
  const facts = { schema: 1, classification: 'M1A_ARCHIVE_FACTS', status: 'uploaded_verified_pending_independent_review',
    destination: { account, region: 'us-east-1', bucket: 'aoa-platform-evidence-010438509726-us-east-1-an', ...ref },
    identity: clone(identity), contractSha256: expected.contractSha256, sha256: expected.sha256, size: expected.size,
    uploader: { account, arn: uploader }, putStartedAt: created, putCompletedAt: created,
    lastModified: created, retainUntil: until, requiredRetainUntil: until };
  const checksum = createHash('sha256').update(bytes).digest('base64');
  const calls = [];
  const store = {
    identify: async () => { calls.push('identify'); return { account, arn: reader }; },
    inspectConfiguration: async () => ({ versioning: { Status: 'Enabled' }, encryption: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
      objectLock: { ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 180 } } } }),
    head: async r => { calls.push(clone(r)); return { versionId: ref.versionId, size: bytes.length, checksumSha256: checksum, encryption: 'AES256', lastModified: created }; },
    get: async r => { calls.push(clone(r)); return { versionId: ref.versionId, bytes, checksumSha256: checksum, encryption: 'AES256' }; },
    retention: async r => { calls.push(clone(r)); return { mode: 'COMPLIANCE', retainUntil: until }; }
  };
  const f = { m, config, facts, finalEvidence, store, calls, ref };
  change(f);
  return f;
}
async function verified(f) {
  f.boundary = f.m.createTestEvidenceDisposition(f.config);
  f.verification = await f.boundary.verify({ store: f.store, uploadFacts: f.facts, now: () => new Date('2026-09-27T13:00:00.000Z') });
  f.owner = { mode: 'TEST', scope: clone(f.config.reviewedCollection.scope), ref: clone(f.ref),
    uploadFactsSha256: recordHash(f.facts), verificationSha256: recordHash(f.verification), finalEvidenceSha256: recordHash(f.finalEvidence),
    ownerId: 'TEST-ret-owner', attribution: 'TEST-external-attribution', recordedAt: '2026-09-27T14:00:00.000Z', disposition: 'review_requested' };
  return f;
}
function evaluate(f, overrides = {}) {
  return f.m.evaluateEvidenceDisposition({ pinnedExpectations: f.boundary.pinnedExpectations,
    uploadFacts: f.facts, verification: f.verification, ownerDisposition: f.owner, finalEvidence: f.finalEvidence, ...overrides });
}

test('refuse_uploader_self_verification', async () => {
  const f = await fixture(); f.store.identify = async () => ({ account, arn: uploader });
  await assert.rejects(verified(f));
});
test('reject_expected_derived_from_facts', async () => {
  const f = await verified(await fixture());
  assert.equal(evaluate(f, { pinnedExpectations: { ref: f.ref, expected: f.facts } }).eligibleForRetOwnerReview, false);
  assert.equal(evaluate(f, { pinnedExpectations: clone(f.boundary.pinnedExpectations) }).eligibleForRetOwnerReview, false);
});
test('reject_wrong_exact_version_or_candidate', async () => {
  for (const change of [f => { f.facts.destination.versionId = 'TEST-other'; }, f => { f.facts.identity.candidate = 'b'.repeat(40); },
    f => { f.facts.sha256 = 'b'.repeat(64); }, f => { f.facts.contractSha256 = 'b'.repeat(64); },
    f => { f.facts.identity.runAttempt = 2; }, f => { f.facts.identity.qaAttempt = 'a2'; },
    f => { f.facts.identity.campaignId = 'other'; }, f => { f.facts.identity.runId = '456'; },
    f => { f.facts.size++; }, f => { f.facts.destination.key += '-other'; },
    f => { f.facts.destination.account = '000000000000'; }, f => { f.facts.destination.bucket = 'TEST-other'; },
    f => { f.facts.destination.region = 'TEST-other'; }]) {
    await assert.rejects(verified(await fixture(change)));
  }
});
test('read_only_store_has_no_put', async () => {
  for (const storeChange of [s => { s.put = undefined; }, s => Object.setPrototypeOf(s, { put() { assert.fail('put'); } })]) {
    const f = await fixture(); storeChange(f.store); await assert.rejects(verified(f)); assert.deepEqual(f.calls, []);
  }
});
test('distinct_ARN_without_injected_TEST_approval_refused', async () => {
  for (const change of [c => { c.authority = c.authority.authority; }, c => { c.authority.readOnly = false; },
    c => { c.authority.approvedBy = ''; }, c => { c.authority.authority.expectedArn = uploader; }]) {
    const f = await fixture(); change(f.config); assert.throws(() => f.m.createTestEvidenceDisposition(f.config));
  }
});
test('retain_unknown_cleanup_nonpass', async () => {
  for (const change of [c => { c.uncertainty = ['TEST-runner-lost']; }, c => { c.exitCode = null; },
    c => { c.exitCode = 1; }, c => { c.residualResources = ['TEST-residual']; }, c => { c.scanPassed = false; }]) {
    const f = await fixture(() => {}, change);
    await verified(f); const result = evaluate(f);
    assert.equal(result.eligibleForRetOwnerReview, false); assert.ok(result.reasons.includes('cleanup_nonpass'));
    assert.deepEqual(f.finalEvidence, f.config.reviewedCollection.finalEvidence);
  }
});
test('storage_success_not_ret01_or_h08', async () => {
  const f = await verified(await fixture()); const result = evaluate(f);
  assert.deepEqual(result, { eligibleForRetOwnerReview: true, reasons: [] });
  assert.equal(f.verification.status, 'independently_verified_pending_owner_disposition');
  assert.deepEqual(Object.keys(f.verification).sort(), ['classification', 'facts', 'reviewerId', 'status', 'verifiedAt', 'verifier']);
  for (const r of f.calls.filter(c => typeof c === 'object')) assert.deepEqual(r, f.ref);
  for (const disposition of ['RET-01', 'H-08', 'campaign_pass', 'approved']) {
    assert.equal(evaluate(f, { ownerDisposition: { ...f.owner, disposition } }).eligibleForRetOwnerReview, false);
  }
});
test('reject_unattributed_or_wrong_scope_owner_record', async () => {
  const f = await verified(await fixture());
  for (const mutate of [o => { delete o.attribution; }, o => { o.ownerId = 'TEST-other'; },
    o => { o.scope.repositoryId = 'TEST-other'; }, o => { o.scope.workflowId = 'TEST-other'; },
    o => { o.ref.versionId = 'TEST-other'; }, o => { o.uploadFactsSha256 = 'b'.repeat(64); },
    o => { o.verificationSha256 = 'b'.repeat(64); }, o => { o.recordedAt = created; }]) {
    const owner = clone(f.owner); mutate(owner); assert.equal(evaluate(f, { ownerDisposition: owner }).eligibleForRetOwnerReview, false);
  }
});
test('immutable_links_refuse_cloned_receipts_and_changed_final_evidence', async () => {
  const f = await verified(await fixture());
  assert.ok(Object.isFrozen(f.verification.facts.destination));
  assert.equal(evaluate(f, { verification: clone(f.verification) }).eligibleForRetOwnerReview, false);
  const final = clone(f.finalEvidence); final.scope.workflowId = 'TEST-other';
  assert.equal(evaluate(f, { finalEvidence: final }).eligibleForRetOwnerReview, false);
  const facts = clone(f.facts); facts.retainUntil = '2027-04-01T12:00:00.000Z';
  assert.equal(evaluate(f, { uploadFacts: facts }).eligibleForRetOwnerReview, false);
});
test('production_refuses_P5_P6_and_closed_inputs', async () => {
  const f = await fixture();
  for (const mode of ['production', undefined]) assert.throws(() => f.m.createTestEvidenceDisposition({ ...f.config, mode }), /unresolved_P5_P6/);
  assert.throws(() => f.m.createTestEvidenceDisposition({ ...f.config, approved: true }));
  await verified(f);
  assert.equal(f.m.evaluateEvidenceDisposition({ pinnedExpectations: f.boundary.pinnedExpectations, production: true }).eligibleForRetOwnerReview, false);
});

test('collection_scope_and_cleanup_must_bind_actual_archived_bytes', async () => {
  for (const change of [f => { f.config.reviewedCollection.scope.repositoryId = 'TEST-substitute'; f.config.reviewedCollection.finalEvidence.scope.repositoryId = 'TEST-substitute'; },
    f => { f.config.reviewedCollection.scope.workflowId = 'TEST-substitute'; f.config.reviewedCollection.finalEvidence.scope.workflowId = 'TEST-substitute'; },
    f => { f.config.reviewedCollection.finalEvidence.cleanup[0].uncertainty = ['TEST-hidden']; },
    f => { f.config.reviewedCollection.finalEvidence.contract.finalObservations[0].conclusion = 'success'; }]) {
    await assert.rejects(verified(await fixture(change)));
  }
});
test('injected_pins_and_authority_are_snapshotted_before_verification', async () => {
  const f = await fixture(); f.boundary = f.m.createTestEvidenceDisposition(f.config);
  f.config.authority.authority.expectedArn = uploader;
  f.config.reviewedCollection.pinned.ref.versionId = 'TEST-mutated';
  f.config.reviewedCollection.finalEvidence.cleanup[0].uncertainty.push('TEST-mutated');
  const receipt = await f.boundary.verify({ store: f.store, uploadFacts: f.facts, now: () => new Date('2026-09-27T13:00:00.000Z') });
  assert.equal(receipt.verifier.arn, reader); assert.equal(receipt.facts.destination.versionId, 'TEST-exact-version');
});
test('separate_boundary_cannot_reuse_verification_or_owner_links', async () => {
  const f = await verified(await fixture()); const other = f.m.createTestEvidenceDisposition(f.config);
  assert.equal(evaluate(f, { pinnedExpectations: other.pinnedExpectations }).eligibleForRetOwnerReview, false);
  const owner = clone(f.owner); owner.finalEvidenceSha256 = 'c'.repeat(64);
  assert.equal(evaluate(f, { ownerDisposition: owner }).eligibleForRetOwnerReview, false);
});
test('bad_observation_JSON_refuses_without_raw_error_detail', async () => {
  const f = await fixture(() => {}, () => {}, 'synthetic TEST private malformed observation');
  // A valid archive can contain non-JSON UTF-8 observations; the new seam must sanitize its own parser errors.
  await assert.rejects(verified(f), e => e.message === 'final_cleanup_mismatch');
});

test('malicious_bytes_getter_cannot_substitute_unvalidated_scope', async () => {
  const f = await fixture();
  const genuine = await f.store.get(f.ref);
  const substituted = JSON.parse(genuine.bytes.toString('utf8'));
  const observation = JSON.parse(Buffer.from(substituted.members[0].base64, 'base64').toString('utf8'));
  observation.run.repositoryId = 'TEST-substituted-repository';
  observation.run.workflowId = 'TEST-substituted-workflow';
  substituted.members[0].base64 = Buffer.from(JSON.stringify(observation)).toString('base64');
  // Leave every digest and the pinned contract unchanged: this copy must never authorize binding.
  const substitutedBytes = Buffer.from(JSON.stringify(substituted));
  f.config.reviewedCollection.scope = clone(observation.run);
  f.config.reviewedCollection.finalEvidence.scope = clone(observation.run);
  let reads = 0;
  f.store.get = async () => ({ versionId: genuine.versionId, checksumSha256: genuine.checksumSha256,
    encryption: genuine.encryption, get bytes() { return ++reads === 2 ? substitutedBytes : genuine.bytes; } });
  await assert.rejects(verified(f), e => e.code === 'M1A_STORE_FAILED');
  assert.equal(reads, 0, 'accessor must be refused without invocation');
});

test('mutable_get_response_and_buffer_are_owned_before_awaited_return', async () => {
  const f = await fixture();
  const response = await f.store.get(f.ref);
  let mutated = false;
  f.store.get = () => Promise.resolve(response).then(value => {
    // Wrapper resumes between these two microtasks; downstream readback resumes after mutation.
    queueMicrotask(() => queueMicrotask(() => {
      response.bytes.fill(0);
      response.bytes = Buffer.from('synthetic TEST substituted bytes');
      response.versionId = 'TEST-substituted-version';
      response.checksumSha256 = 'TEST-substituted-checksum';
      response.encryption = 'TEST-substituted-encryption';
      mutated = true;
    }));
    return value;
  });
  await verified(f);
  assert.equal(mutated, true);
  assert.equal(f.verification.facts.destination.versionId, 'TEST-exact-version');
  assert.deepEqual(evaluate(f), { eligibleForRetOwnerReview: true, reasons: [] });
});

test('paused_identify_keeps_preawait_upload_facts_snapshot', async () => {
  const f = await fixture();
  const originalFacts = clone(f.facts);
  let release;
  let entered;
  const paused = new Promise(resolve => { entered = resolve; });
  f.store.identify = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const pending = verified(f);
  await paused;
  f.facts.identity.candidate = 'b'.repeat(40);
  f.facts.destination.versionId = 'TEST-mutated-version';
  f.facts.sha256 = 'c'.repeat(64);
  release({ account, arn: reader });
  await pending;
  assert.deepEqual(f.verification.facts, originalFacts);
  assert.equal(evaluate(f).eligibleForRetOwnerReview, false, 'mutated caller facts cannot reuse the receipt');
  f.facts = originalFacts;
  f.owner.uploadFactsSha256 = recordHash(originalFacts);
  assert.deepEqual(evaluate(f), { eligibleForRetOwnerReview: true, reasons: [] });
});

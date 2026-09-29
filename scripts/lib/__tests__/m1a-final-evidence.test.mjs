import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const hash = x => createHash('sha256').update(x).digest('hex');
const time = n => `2026-09-27T12:00:0${n}.000Z`;
const api = () => import('../m1a-final-evidence.mjs');
function fixture() {
  const run = { repositoryId: '1', workflowId: '2', runId: '123', runAttempt: 1,
    candidate: 'a'.repeat(40), campaignId: 'm1a-test', qaAttempt: 'a1' };
  const jobs = [{ job: 'build', jobId: '3', status: 'completed', conclusion: 'success', postActionsComplete: true }];
  const earlyBundle = { profileSha256: 'b'.repeat(64), admissionSha256: 'c'.repeat(64), bundleSha256: 'd'.repeat(64) };
  const cleanup = [{ job: 'build', jobId: '3', capturedAt: time(1), preparation: 'complete', missingContext: [],
    teardownAt: time(2), exitCode: 0, residualResources: [], uncertainty: [], scanAt: time(3), scanPassed: true,
    contextAvailable: true, contextPrivate: true, contextNonUploadable: true, contextDestroyedAt: time(4),
    transferredAt: time(5), transferSucceeded: true, verifiedAt: time(6) }];
  const final = { run, job: jobs[0], cleanup: { capturedAt: time(1), preparation: 'complete', missingContext: [],
    teardownAt: time(2), exitCode: 0, residualResources: [], uncertainty: [] } };
  const entry = (path, category, bytes, artifactId) => ({ path, category, bytes: Buffer.from(bytes),
    format: 'utf8', artifactId, jobId: '3', binding: { ...run }, sha256: hash(bytes) });
  const artifacts = [entry('final.json', 'observations', JSON.stringify(final), '4'),
    entry('linkage.json', 'linkage', JSON.stringify({ run, ...earlyBundle }), '5')];
  const logs = [{ ...entry('post.txt', 'logs', 'final post-action log', '6'), phase: 'post-actions' }];
  const pins = [...artifacts, ...logs].map(({ bytes, binding, jobId, phase, ...p }) => ({ ...p, size: bytes.length, jobId, ...(phase ? { phase } : {}) }));
  const controllerObservation = { mode: 'TEST', run: { ...run }, jobs: structuredClone(jobs),
    cleanup: structuredClone(cleanup), members: structuredClone(pins), earlyBundle: { ...earlyBundle } };
  for (const c of cleanup) c.receipt = { mode: 'TEST', binding: { ...run }, jobId: c.jobId,
    members: structuredClone(pins), transferredAt: c.transferredAt };
  return { profile: { mode: 'TEST', expectedJobs: [{ job: 'build', jobId: '3' }],
    requiredCategories: ['logs', 'observations', 'linkage'] }, run, jobs, artifacts, logs, cleanup, earlyBundle, controllerObservation };
}
const collect = async f => (await api()).collectFinalEvidence(f);
async function refuse(f, pattern) { const r = await collect(f); assert.equal(r.ready, false); assert.match(r.reasons.join(' '), pattern); return r; }
test('wait_all_jobs_and_post_actions', async () => {
  const f = fixture(); assert.equal((await collect(f)).ready, true);
  f.jobs[0].postActionsComplete = false; await refuse(f, /terminal/);
  f.jobs[0].status = 'in_progress'; await refuse(f, /terminal/);
  f.jobs = []; await refuse(f, /jobs/);
});
function refreshFinal(f) {
  const c = f.cleanup[0];
  const cleanup = Object.fromEntries(['capturedAt', 'preparation', 'missingContext', 'teardownAt', 'exitCode', 'residualResources', 'uncertainty'].map(k => [k, c[k]]));
  f.artifacts[0].bytes = Buffer.from(JSON.stringify({ run: f.run, job: f.jobs[0], cleanup }));
  f.artifacts[0].sha256 = hash(f.artifacts[0].bytes);
  f.controllerObservation.jobs = structuredClone(f.jobs);
  f.controllerObservation.cleanup = structuredClone(f.cleanup.map(({ receipt, ...v }) => v));
  const pins = [...f.artifacts, ...f.logs].map(({ bytes, binding, jobId, phase, ...p }) => ({ ...p, size: bytes.length, jobId, ...(phase ? { phase } : {}) }));
  f.controllerObservation.members = structuredClone(pins); f.cleanup[0].receipt.members = structuredClone(pins);
}
test('retain_failure_and_cancelled_evidence', async () => {
  for (const conclusion of ['failure', 'cancelled']) {
    const f = fixture(); f.jobs[0].conclusion = conclusion; refreshFinal(f);
    const r = await collect(f); assert.equal(r.ready, true); assert.equal(r.finalObservations[0].conclusion, conclusion);
  }
});

test('reject_members_outside_reviewed_category_profile', async () => {
  for (const kind of ['artifacts', 'logs']) {
    const f = fixture();
    const extra = { ...f[kind][0], path: 'extra.txt', category: 'unreviewed', artifactId: '10',
      bytes: Buffer.from('extra evidence'), sha256: hash('extra evidence') };
    f[kind].push(extra);
    refreshFinal(f);
    const r = await refuse(f, /category_profile/);
    assert.deepEqual(r.members, []);
  }
});

test('accept_extra_members_in_reviewed_categories', async () => {
  const f = fixture();
  f.logs.push({ ...f.logs[0], path: 'extra-post.txt', artifactId: '10' });
  refreshFinal(f);
  assert.equal((await collect(f)).ready, true);
});
test('teardown_failure_is_preserved', async () => {
  const f = fixture(); Object.assign(f.cleanup[0], { exitCode: 7, residualResources: ['container-test'], uncertainty: ['teardown failed'] }); refreshFinal(f);
  const r = await collect(f); assert.equal(r.ready, true); assert.equal(r.finalObservations[0].cleanupObserved, true);
  assert.equal(JSON.parse(r.members.find(x => x.path === 'final.json').bytes).cleanup.exitCode, 7);
});
test('runner_loss_not_cleanup_success', async () => { const f = fixture(); f.cleanup = []; await refuse(f, /cleanup/); });
test('cancellation_has_no_inferred_cleanup', async () => { const f = fixture(); f.jobs[0].conclusion = 'cancelled'; f.cleanup[0].exitCode = null; refreshFinal(f); await refuse(f, /cleanup/); });
test('missing_final_logs_refuse_complete', async () => { const f = fixture(); f.logs = []; await refuse(f, /logs/); });
test('skipped_unknown_refuse_without_mapping', async () => {
  for (const conclusion of ['skipped', 'unknown', 'neutral']) { const f = fixture(); f.jobs[0].conclusion = conclusion; await refuse(f, /terminal/); }
});
test('wrong_attempt_or_candidate_refuse', async () => {
  for (const key of ['runAttempt', 'candidate', 'workflowId', 'repositoryId']) {
    const f = fixture(); f.artifacts[0].binding[key] = key === 'runAttempt' ? 2 : 'wrong'; await refuse(f, /binding/);
  }
  const f = fixture(); f.logs[0].artifactId = 'name-only'; await refuse(f, /inventory/);
});
test('link_early_profile_hashes', async () => {
  const f = fixture(); const r = await collect(f); assert.equal(r.ready, true);
  assert.deepEqual(JSON.parse(r.members.find(m => m.category === 'linkage').bytes), { run: f.run, ...f.earlyBundle });
  f.earlyBundle.profileSha256 = 'e'.repeat(64); await refuse(f, /linkage/);
});
test('partial_prepare_has_explicit_missing_context', async () => {
  const f = fixture(); f.cleanup[0].preparation = 'partial'; f.cleanup[0].missingContext = ['scanner context unavailable']; refreshFinal(f);
  const r = await refuse(f, /context/); assert.ok(r.diagnostics.some(d => d.code === 'missing_context'));
});
test('post_cleanup_scan_failure_refuses_transfer', async () => {
  const f = fixture(); f.cleanup[0].scanPassed = false; const r = await refuse(f, /scan/); assert.deepEqual(r.members, []);
  assert.equal(r.diagnostics.find(d => d.code === 'teardown_observed').exitCode, 0);
  assert.equal(r.diagnostics.find(d => d.code === 'teardown_observed').observedAt, time(2));
});
test('transfer_failure_remains_nonpassing', async () => {
  const f = fixture(); f.cleanup[0].transferSucceeded = false; await refuse(f, /transfer/);
  const g = fixture(); g.cleanup[0].receipt.members = []; await refuse(g, /transfer/);
});
test('state_machine_order_and_independent_terminal_verification', async () => {
  for (const [key, value] of [['scanAt', time(1)], ['transferredAt', time(2)], ['verifiedAt', time(3)],
    ['contextAvailable', false], ['contextPrivate', false], ['contextNonUploadable', false], ['contextDestroyedAt', null]]) {
    const f = fixture(); f.cleanup[0][key] = value; await refuse(f, /state|context|transfer/);
  }
  const f = fixture(); f.controllerObservation.cleanup[0].exitCode = 9; await refuse(f, /independent/);
});
test('reject_secret_duplicate_oversize_binary', async () => {
  for (const bytes of [Buffer.from('Bearer fake-secret'), Buffer.from([0, 1]), Buffer.alloc(64 * 1024 * 1024 + 1, 65)]) {
    const f = fixture(); f.logs[0].bytes = bytes; f.logs[0].sha256 = hash(bytes); refreshFinal(f); await refuse(f, /M1A_|bound/);
  }
  const f = fixture(); f.artifacts[1].path = f.artifacts[0].path; await refuse(f, /duplicate/);
});
test('collector_failure_keeps_diagnostics', async () => {
  const f = fixture(); f.artifacts[0].sha256 = 'e'.repeat(64); const r = await refuse(f, /hash/);
  assert.ok(r.diagnostics.length); assert.equal(JSON.stringify(r).includes('final post-action log'), false);
  assert.equal((await collect(null)).ready, false);
  const g = fixture(); Object.defineProperty(g.profile, 'mode', { get() { throw Object.assign(new Error('private detail'), { code: 'private_detail' }); } });
  const safe = await collect(g); assert.deepEqual(safe.reasons, ['invalid_input']);
  assert.equal(JSON.stringify(safe).includes('private_detail'), false);
});
test('production_refuses_unresolved_P4_P5', async () => {
  const f = fixture(); f.profile.mode = 'production'; await refuse(f, /P4.*P5/);
  const g = fixture(); g.controllerObservation.mode = 'production'; await refuse(g, /P4.*P5/);
  for (const target of ['profile', 'controllerObservation']) {
    const h = fixture(); h[target].approved = true; await refuse(h, /invalid_input/);
  }
});
test('early_logs_and_extra_terminal_context_are_refused', async () => {
  const f = fixture(); f.logs[0].phase = 'early'; await refuse(f, /post/);
  const g = fixture(); g.controllerObservation.cleanup.push(structuredClone(g.controllerObservation.cleanup[0])); await refuse(g, /cleanup/);
});
test('missing_receipt_and_source_state_fields_are_refused', async () => {
  const f = fixture(); delete f.cleanup[0].receipt; await refuse(f, /cleanup/);
  const g = fixture(); g.cleanup[0].scannerContext = 'not evidence'; await refuse(g, /cleanup/);
  const h = fixture(); h.artifacts[0].state = 'not evidence'; await refuse(h, /inventory/);
});
test('asynchronous_validation_snapshots_input_pins_and_bytes', async () => {
  const f = fixture(); const pending = collect(f);
  // Resolve the dynamic import before beginning collection, then mutate during its validation await.
  const m = await api(); const g = fixture(); const collecting = m.collectFinalEvidence(g);
  g.profile.requiredCategories.push('unapproved'); g.cleanup[0].verifiedAt = null; g.logs[0].bytes.fill(0);
  const r = await collecting; assert.equal(r.ready, true);
  assert.equal(r.members.find(x => x.path === 'post.txt').bytes.toString(), 'final post-action log');
  const identity = Object.fromEntries(['candidate', 'campaignId', 'runId', 'runAttempt', 'qaAttempt'].map(k => [k, g.run[k]]));
  const b = await m.buildArchiveInputs({ identity, completedAt: time(7), requiredRetainUntil: '2027-04-01T00:00:00Z', collected: r,
    redactionReview: { reviewerId: 'test-reviewer', reviewedAt: time(7), sourceInventorySha256: hash(JSON.stringify(r.members.map(({ bytes, ...d }) => d))) } });
  assert.deepEqual(b.inventory.requiredCategories, ['logs', 'observations', 'linkage']);
  assert.equal((await pending).ready, true);
});
test('build_preserves_exact_archive_schema_enums_and_canonical_hashes', async () => {
  const f = fixture(), m = await api(), collected = await collect(f);
  const descriptors = collected.members.map(({ bytes, ...d }) => d);
  const inventoryHash = hash(JSON.stringify(descriptors));
  const identity = Object.fromEntries(['candidate', 'campaignId', 'runId', 'runAttempt', 'qaAttempt'].map(k => [k, f.run[k]]));
  const args = { identity, completedAt: time(7), requiredRetainUntil: '2027-04-01T00:00:00Z', collected,
    redactionReview: { reviewerId: 'test-reviewer', reviewedAt: time(7), sourceInventorySha256: inventoryHash } };
  const b = await m.buildArchiveInputs(args);
  assert.deepEqual(Object.keys(b.contract), ['schema', 'classification', 'candidate', 'campaignId', 'runId', 'runAttempt', 'qaAttempt', 'completedAt', 'requiredRetainUntil', 'members', 'finalObservations', 'redactionReview']);
  assert.equal(b.contract.schema, 1); assert.equal(b.contract.classification, 'M1A_ARCHIVE_INPUT');
  assert.equal(b.expectedContractSha256, hash(JSON.stringify(b.contract)));
  assert.deepEqual(Object.keys(b.inventory), ['sourceInventorySha256', 'expectedJobs', 'requiredCategories']);
  assert.equal(b.inventory.sourceInventorySha256, inventoryHash);
  assert.deepEqual(Object.keys(b.contract.members[0]), ['path', 'sha256', 'size', 'format', 'artifactId', 'category']);
  assert.deepEqual(Object.keys(b.contract.finalObservations[0]), ['job', 'conclusion', 'cleanupObserved', 'evidencePath']);
  await assert.rejects(m.buildArchiveInputs({ ...args, identity: { ...identity, runAttempt: 2 } }));
  await assert.rejects(m.buildArchiveInputs({ ...args, collected: structuredClone(collected) }));
  collected.members[0].bytes[0] ^= 1; await assert.rejects(m.buildArchiveInputs(args));
});
test('two_jobs_require_separate_final_logs_and_cleanup', async () => {
  const f = fixture(), g = fixture();
  const second = { ...g.jobs[0], job: 'verify', jobId: '7', conclusion: 'failure' };
  const cleanup = { ...g.cleanup[0], job: 'verify', jobId: '7' };
  const final = { ...g.artifacts[0], path: 'verify-final.json', jobId: '7', artifactId: '8' };
  final.bytes = Buffer.from(JSON.stringify({ run: f.run, job: second,
    cleanup: Object.fromEntries(['capturedAt', 'preparation', 'missingContext', 'teardownAt', 'exitCode', 'residualResources', 'uncertainty'].map(k => [k, cleanup[k]])) }));
  final.sha256 = hash(final.bytes);
  f.jobs.push(second); f.profile.expectedJobs.push({ job: 'verify', jobId: '7' });
  f.cleanup.push(cleanup); f.artifacts.push(final);
  f.logs.push({ ...g.logs[0], path: 'verify-post.txt', jobId: '7', artifactId: '9' });
  const pins = [...f.artifacts, ...f.logs].map(({ bytes, binding, jobId, phase, ...p }) => ({ ...p, size: bytes.length, jobId, ...(phase ? { phase } : {}) }));
  f.controllerObservation.jobs = structuredClone(f.jobs);
  f.controllerObservation.cleanup = structuredClone(f.cleanup.map(({ receipt, ...c }) => c));
  f.controllerObservation.members = structuredClone(pins);
  f.cleanup.forEach(c => { c.receipt = { ...c.receipt, jobId: c.jobId, members: structuredClone(pins) }; });
  assert.deepEqual((await collect(f)).finalObservations.map(o => o.conclusion), ['success', 'failure']);
  f.logs.pop(); await refuse(f, /inventory|logs/);
});
test('unsafe_paths_and_unreviewed_categories_are_refused', async () => {
  for (const path of ['../outside.txt', 'CON.txt', 'a\\b.txt']) {
    const f = fixture(); f.logs[0].path = path; refreshFinal(f); await refuse(f, /M1A_UNSAFE_PATH/);
  }
  const f = fixture(); f.profile.requiredCategories.push('missing-category'); await refuse(f, /M1A_INVENTORY_MISMATCH/);
});
test('missing_early_hash_and_wrong_transfer_identity_are_refused', async () => {
  const f = fixture(); delete f.earlyBundle.admissionSha256; await refuse(f, /linkage/);
  const g = fixture(); g.cleanup[0].receipt.binding.runAttempt = 9; await refuse(g, /transfer_binding/);
});

test('receipt_and_controller_pins_are_independent', async () => {
  for (const side of ['receipt', 'controller']) {
    for (const [key, value] of [['artifactId', 'wrong'], ['jobId', 'wrong'], ['size', 99], ['sha256', 'e'.repeat(64)], ['phase', 'early']]) {
      const f = fixture();
      const pins = side === 'receipt' ? f.cleanup[0].receipt.members : f.controllerObservation.members;
      pins.find(p => p.category === 'logs')[key] = value;
      await refuse(f, /transfer|inventory/);
    }
  }
});

async function deliveryFixture(failure) {
  const m = await api(), f = fixture(), collected = await collect(f);
  const identity = Object.fromEntries(['candidate', 'campaignId', 'runId', 'runAttempt', 'qaAttempt'].map(k => [k, f.run[k]]));
  const archiveInputs = await m.buildArchiveInputs({ identity, collected, completedAt: time(7), requiredRetainUntil: '2027-04-01T00:00:00Z',
    redactionReview: { reviewerId: 'test-reviewer', reviewedAt: time(7), sourceInventorySha256: hash(JSON.stringify(collected.members.map(({ bytes, ...d }) => d))) } });
  const bytes = Buffer.from(JSON.stringify({ format: 'aoa-m1a-archive-v1', contractSha256: archiveInputs.expectedContractSha256,
    contract: archiveInputs.contract, members: collected.members.map(x => ({ path: x.path, sha256: x.sha256, size: x.size, base64: x.bytes.toString('base64') })) }));
  const checksumSha256 = createHash('sha256').update(bytes).digest('base64');
  const events = [], puts = [], reads = [];
  const dependencies = {
    prepareArchive: async options => {
      events.push('prepare');
      const { validateArchiveBytes } = await import('../m1a-archive/evidence.mjs');
      return validateArchiveBytes({ bytes, expected: { identity: Object.fromEntries(Object.keys(identity).map(k => [k, options.contract[k]])), contractSha256: options.expectedContractSha256,
        sha256: hash(bytes), size: bytes.length, requiredRetainUntil: options.contract.requiredRetainUntil,
        expectedJobs: options.expectedJobs, requiredCategories: options.requiredCategories } });
    },
    createStore: async () => ({
      identify: async () => ({ account: '010438509726', arn: 'arn:aws:iam::010438509726:user/aoa-s3-artifacts' }),
      inspectConfiguration: async () => ({ versioning: { Status: 'Enabled' }, encryption: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
        objectLock: { ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 180 } } } }),
      put: async args => { puts.push(args); if (failure === 'timeout') throw new Error('PRIVATE timeout'); return { versionId: 'test-version-1', checksumSha256 }; },
      head: async ref => { reads.push(ref); if (failure === 'readback') throw new Error('PRIVATE readback');
        return { versionId: ref.versionId, size: bytes.length, checksumSha256, encryption: 'AES256', lastModified: time(8) }; },
      get: async ref => { reads.push(ref); return { versionId: ref.versionId, bytes, checksumSha256, encryption: 'AES256' }; },
      retention: async ref => { reads.push(ref); return { mode: 'COMPLIANCE', retainUntil: archiveInputs.contract.requiredRetainUntil }; }
    }),
    writeExclusive: async () => ({ write: async () => { if (failure === 'receipt') throw new Error('PRIVATE receipt'); }, close: async () => {} }),
    now: () => new Date(time(8))
  };
  const delivery = { identity, archiveInputs, paths: { contract: '/contract', inventory: '/inventory', inputRoot: '/source', scratchRoot: '/scratch', output: '/receipt' },
    cleanupObservation: structuredClone(f.controllerObservation.cleanup) };
  const options = { mode: 'TEST', dependencies, cleanup: async observation => { events.push('cleanup'); assert.deepEqual(observation, f.controllerObservation.cleanup); } };
  return { m, delivery, options, puts, reads, events };
}

test('known_version_after_readback_failure', async () => {
  const f = await deliveryFixture('readback'); assert.equal(typeof f.m.createTestArchiveCoordinator, 'function');
  const coordinator = f.m.createTestArchiveCoordinator(f.options), result = await coordinator.deliver(f.delivery);
  assert.equal(result.status, 'KNOWN_VERSION'); assert.equal(result.ref.versionId, 'test-version-1');
  assert.equal(result.reconciliation, 'operator_exact_version_read_only'); assert.equal(f.puts.length, 1);
  assert.ok(Object.isFrozen(result.ref)); assert.throws(() => { result.ref.versionId = 'wrong'; });
  assert.deepEqual(await coordinator.deliver(f.delivery), result); assert.equal(f.puts.length, 1);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('timeout_without_version_stays_uncertain', async () => {
  const f = await deliveryFixture('timeout'); assert.equal(typeof f.m.createTestArchiveCoordinator, 'function');
  const c = f.m.createTestArchiveCoordinator(f.options), result = await c.deliver(f.delivery);
  assert.equal(result.status, 'UNKNOWN'); assert.equal(result.reconciliation, 'operator_unknown_outcome');
  assert.equal(Object.hasOwn(result, 'ref'), false); assert.equal(f.reads.length, 0);
  await c.deliver(f.delivery); assert.equal(f.puts.length, 1);
});
test('duplicate_delivery_does_not_reupload', async () => {
  const f = await deliveryFixture(); assert.equal(typeof f.m.createTestArchiveCoordinator, 'function');
  const c = f.m.createTestArchiveCoordinator(f.options);
  const [a, b] = await Promise.all([c.deliver(f.delivery), c.deliver(structuredClone(f.delivery))]);
  assert.deepEqual(a, b); assert.equal(a.status, 'uploaded_verified_pending_independent_review');
  assert.equal(f.puts.length, 1); assert.deepEqual(f.events, ['cleanup', 'prepare']);
  assert.deepEqual(Object.keys(f.puts[0]), ['key', 'bytes', 'checksumSha256']);
  assert.ok(f.reads.every(ref => ref.versionId === 'test-version-1'));
  const conflict = structuredClone(f.delivery); conflict.identity.candidate = 'b'.repeat(40);
  await assert.rejects(c.deliver(conflict), /duplicate_identity_conflict/);
  const changed = structuredClone(f.delivery); changed.paths.output = '/another';
  await assert.rejects(c.deliver(changed), /duplicate_identity_conflict/); assert.equal(f.puts.length, 1);
});
test('cleanup_independent_of_archive_failure', async () => {
  for (const failure of ['timeout', 'readback', 'receipt']) {
    const f = await deliveryFixture(failure); assert.equal(typeof f.m.createTestArchiveCoordinator, 'function');
    const result = await f.m.createTestArchiveCoordinator(f.options).deliver(f.delivery);
    assert.equal(result.cleanup.status, 'completed'); assert.deepEqual(result.cleanup.observation, f.delivery.cleanupObservation);
    assert.equal(f.events[0], 'cleanup'); assert.equal(f.puts.length, 1);
  }
});
test('coordination_snapshots_inputs_and_capabilities_before_await', async () => {
  const f = await deliveryFixture('readback'); assert.equal(typeof f.m.createTestArchiveCoordinator, 'function');
  const c = f.m.createTestArchiveCoordinator(f.options), pending = c.deliver(f.delivery);
  f.delivery.identity.candidate = 'b'.repeat(40); f.delivery.archiveInputs.contract.candidate = 'c'.repeat(40);
  f.delivery.cleanupObservation[0].exitCode = 9; f.delivery.paths.output = '/mutated';
  f.options.dependencies.createStore = async () => { assert.fail('mutated capability'); };
  const result = await pending; assert.equal(result.status, 'KNOWN_VERSION'); assert.equal(result.cleanup.observation[0].exitCode, 0);
});
test('coordination_requires_TEST_closed_inputs_and_bounded_lifetime', async () => {
  const f = await deliveryFixture(); assert.equal(typeof f.m.createTestArchiveCoordinator, 'function');
  for (const mode of [undefined, 'production']) assert.throws(() => f.m.createTestArchiveCoordinator({ ...f.options, mode }), /production_refused/);
  assert.throws(() => f.m.createTestArchiveCoordinator({ ...f.options, approved: true }), /invalid_input/);
  const c = f.m.createTestArchiveCoordinator({ ...f.options, maxDeliveries: 1 });
  const extra = structuredClone(f.delivery); extra.approved = true; await assert.rejects(c.deliver(extra), /invalid_input/);
  await c.deliver(f.delivery);
  const other = structuredClone(f.delivery); other.identity.runId = '124';
  await assert.rejects(c.deliver(other), /delivery_limit/); assert.equal(f.puts.length, 1);
});

test('cleanup_callback_failure_preserves_observation_and_archive_diagnostics', async () => {
  const f = await deliveryFixture('readback');
  f.delivery.cleanupObservation[0].exitCode = 7;
  f.options.cleanup = async observation => { observation[0].exitCode = 0; throw new Error('PRIVATE cleanup'); };
  const result = await f.m.createTestArchiveCoordinator(f.options).deliver(f.delivery);
  assert.equal(result.cleanup.status, 'failed'); assert.equal(result.cleanup.observation[0].exitCode, 7);
  assert.equal(result.status, 'KNOWN_VERSION'); assert.equal(f.puts.length, 1);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('preparation_failure_runs_cleanup_without_store_or_retry', async () => {
  const f = await deliveryFixture();
  f.options.dependencies.prepareArchive = async () => { throw new Error('PRIVATE prepare'); };
  f.options.dependencies.createStore = async () => { assert.fail('store after failed prepare'); };
  const c = f.m.createTestArchiveCoordinator(f.options), result = await c.deliver(f.delivery);
  assert.equal(result.status, 'UNKNOWN'); assert.equal(result.cleanup.status, 'completed');
  await c.deliver(f.delivery); assert.deepEqual(f.events, ['cleanup']); assert.equal(f.puts.length, 0);
});
test('delivery_bound_and_identity_checks_refuse_before_callbacks', async () => {
  const f = await deliveryFixture(), c = f.m.createTestArchiveCoordinator(f.options);
  const oversized = structuredClone(f.delivery); oversized.cleanupObservation[0].uncertainty = ['x'.repeat(1024 * 1024)];
  await assert.rejects(c.deliver(oversized), /delivery_bound/);
  const wrong = structuredClone(f.delivery); wrong.archiveInputs.contract.runAttempt = 2;
  await assert.rejects(c.deliver(wrong), /identity_mismatch/);
  assert.deepEqual(f.events, []); assert.equal(f.puts.length, 0);
});

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateArchiveBytes } from './m1a-archive/evidence.mjs';
import { runArchiveCommand } from '../m1a-archive.mjs';

const RAW_LIMIT = 64 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const RUN = ['repositoryId', 'workflowId', 'runId', 'runAttempt', 'candidate', 'campaignId', 'qaAttempt'];
const IDENTITY = ['candidate', 'campaignId', 'runId', 'runAttempt', 'qaAttempt'];
const JOB = ['job', 'jobId', 'status', 'conclusion', 'postActionsComplete'];
const TERMINAL = ['capturedAt', 'preparation', 'missingContext', 'teardownAt', 'exitCode', 'residualResources', 'uncertainty'];
const CLEANUP = ['job', 'jobId', ...TERMINAL, 'scanAt', 'scanPassed', 'contextAvailable', 'contextPrivate',
  'contextNonUploadable', 'contextDestroyedAt', 'transferredAt', 'transferSucceeded', 'verifiedAt'];
const MEMBER = ['path', 'sha256', 'size', 'format', 'artifactId', 'category'];
const collections = new WeakMap();
const internalErrors = new WeakSet();
const ARCHIVE_CODES = new Set(['M1A_ARCHIVE_MISMATCH', 'M1A_CONTRACT_MISMATCH', 'M1A_DUPLICATE_MEMBER',
  'M1A_EXPECTATIONS_REQUIRED', 'M1A_INVALID_BUNDLE', 'M1A_INVALID_INPUT', 'M1A_INVALID_UTF_EIGHT',
  'M1A_INVENTORY_MISMATCH', 'M1A_MEMBER_MISMATCH', 'M1A_NONCANONICAL_BUNDLE', 'M1A_OBSERVATION_MISMATCH',
  'M1A_SECRET_REFUSED', 'M1A_SIZE_BOUND', 'M1A_UNSAFE_PATH', 'M1A_UNSUPPORTED_BINARY']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const order = (object, keys) => Object.fromEntries(keys.map(k => [k, object[k]]));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = code => { const error = Object.assign(new Error(code), { code }); internalErrors.add(error); throw error; };
function requireFact(ok, code) { if (!ok) fail(code); }
function closed(value, keys, code = 'invalid_input') {
  requireFact(value && Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length && keys.every(k => {
      const d = Object.getOwnPropertyDescriptor(value, k);
      return d && d.enumerable && Object.hasOwn(d, 'value');
    }), code);
}
function label(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value); }
function list(value, nonempty = false) {
  return Array.isArray(value) && value.length <= 128 && (!nonempty || value.length > 0);
}
function labels(value, nonempty = false) { return list(value, nonempty) && value.every(label) && new Set(value).size === value.length; }
function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && [new Date(value).toISOString(), new Date(value).toISOString().replace('.000Z', 'Z')].includes(value);
}
function same(a, b, code) { requireFact(isDeepStrictEqual(a, b), code); }
function descriptors(members) { return members.map(m => order(m, MEMBER)).sort((a, b) => compare(a.path, b.path)); }
function contractFor(identity, completedAt, requiredRetainUntil, members, finalObservations, review) {
  closed(identity, IDENTITY);
  closed(review, ['reviewerId', 'reviewedAt', 'sourceInventorySha256']);
  return { schema: 1, classification: 'M1A_ARCHIVE_INPUT', ...order(identity, IDENTITY), completedAt,
    requiredRetainUntil, members: descriptors(members),
    finalObservations: finalObservations.map(o => order(o, ['job', 'conclusion', 'cleanupObserved', 'evidencePath']))
      .sort((a, b) => compare(a.job, b.job)), redactionReview: order(review, ['reviewerId', 'reviewedAt', 'sourceInventorySha256']) };
}
async function inspect(contract, members, expectedJobs, requiredCategories) {
  const contractSha256 = hash(JSON.stringify(contract));
  const raw = [...members].sort((a, b) => compare(a.path, b.path)).map(m => ({
    path: m.path, sha256: m.sha256, size: m.size, base64: m.bytes.toString('base64') }));
  const bytes = Buffer.from(JSON.stringify({ format: 'aoa-m1a-archive-v1', contractSha256, contract, members: raw }));
  try {
    await validateArchiveBytes({ bytes, expected: { contractSha256, sha256: hash(bytes), size: bytes.length,
      identity: order(contract, IDENTITY), requiredRetainUntil: contract.requiredRetainUntil, expectedJobs, requiredCategories } });
  } catch (error) { fail(ARCHIVE_CODES.has(error?.code) ? error.code : 'invalid_input'); }
  return contractSha256;
}

/** Pure, bounded TEST observations only. No custody implementation or scanner context is accepted.
 * ready means complete evidence, never campaign success, RET-01 or H-08 approval.
 * Refusal retains safe diagnostic codes; callers retain private source diagnostics separately.
 */
export async function collectFinalEvidence(input) {
  const diagnostics = [];
  try {
    closed(input, ['profile', 'run', 'jobs', 'artifacts', 'logs', 'cleanup', 'earlyBundle', 'controllerObservation']);
    const { profile, run, jobs, artifacts, logs, cleanup, earlyBundle, controllerObservation: controller } = input;
    requireFact(profile?.mode === 'TEST' && controller?.mode === 'TEST', 'unresolved_P4_P5_production_refused');
    closed(profile, ['mode', 'expectedJobs', 'requiredCategories']);
    closed(controller, ['mode', 'run', 'jobs', 'cleanup', 'members', 'earlyBundle']);
    closed(run, RUN, 'binding'); closed(controller.run, RUN, 'binding'); same(run, controller.run, 'binding');
    requireFact(RUN.filter(k => k !== 'runAttempt').every(k => label(run[k])) && Number.isSafeInteger(run.runAttempt) && run.runAttempt > 0, 'binding');
    requireFact(list(profile.expectedJobs, true) && labels(profile.requiredCategories, true), 'jobs_profile');
    profile.expectedJobs.forEach(j => { closed(j, ['job', 'jobId']); requireFact(label(j.job) && label(j.jobId), 'jobs_profile'); });
    requireFact(new Set(profile.expectedJobs.map(j => j.job)).size === profile.expectedJobs.length &&
      new Set(profile.expectedJobs.map(j => j.jobId)).size === profile.expectedJobs.length, 'duplicate_jobs');
    requireFact(list(jobs, true) && jobs.length === profile.expectedJobs.length && list(controller.jobs, true), 'missing_jobs');
    for (const j of jobs) {
      closed(j, JOB, 'terminal_jobs');
      requireFact(profile.expectedJobs.some(p => p.job === j.job && p.jobId === j.jobId) &&
        jobs.filter(x => x.job === j.job).length === 1, 'jobs_binding');
      requireFact(j.status === 'completed' && j.postActionsComplete === true && ['success', 'failure', 'cancelled'].includes(j.conclusion), 'terminal_jobs');
    }
    same(jobs, controller.jobs, 'independent_jobs');
    closed(earlyBundle, ['profileSha256', 'admissionSha256', 'bundleSha256'], 'linkage');
    requireFact(Object.values(earlyBundle).every(v => typeof v === 'string' && HASH.test(v)), 'linkage_hash');
    same(earlyBundle, controller.earlyBundle, 'linkage');
    requireFact(list(artifacts, true) && list(logs, true), 'missing_final_logs_or_artifacts');
    requireFact(list(cleanup, true) && cleanup.length === jobs.length && list(controller.cleanup, true) &&
      controller.cleanup.length === jobs.length, 'missing_cleanup');
    const observations = [];
    for (const j of jobs) {
      const c = cleanup.find(c => c?.job === j.job && c?.jobId === j.jobId);
      requireFact(c && cleanup.filter(x => x.job === j.job).length === 1, 'missing_cleanup');
      closed(c, [...CLEANUP, 'receipt'], 'cleanup_context');
      requireFact(['complete', 'partial', 'missing'].includes(c.preparation) && labels(c.missingContext) &&
        labels(c.residualResources) && labels(c.uncertainty), 'cleanup_context');
      diagnostics.push({ code: c.preparation === 'complete' && !c.missingContext.length ? 'capture_observed' : 'missing_context',
        jobIndex: jobs.indexOf(j), preparation: c.preparation, missingContextCount: c.missingContext.length });
      requireFact(Number.isSafeInteger(c.exitCode) && c.exitCode >= 0 && c.exitCode <= 255, 'cleanup_exit_missing');
      requireFact(date(c.capturedAt) && date(c.teardownAt) && Date.parse(c.teardownAt) > Date.parse(c.capturedAt), 'state_cleanup_order');
      diagnostics.push({ code: 'teardown_observed', jobIndex: jobs.indexOf(j), exitCode: c.exitCode,
        observedAt: c.teardownAt, residualResourceCount: c.residualResources.length, uncertaintyCount: c.uncertainty.length });
      requireFact(c.preparation === 'complete' && c.missingContext.length === 0 && c.contextAvailable === true &&
        c.contextPrivate === true && c.contextNonUploadable === true, 'missing_context');
      const times = ['capturedAt', 'teardownAt', 'scanAt', 'contextDestroyedAt', 'transferredAt', 'verifiedAt'].map(k => c[k]);
      requireFact(times.every(date) && times.every((v, i) => i === 0 || Date.parse(v) > Date.parse(times[i - 1])), 'state_context_order');
      requireFact(c.scanPassed === true, 'post_cleanup_scan_failed');
      diagnostics.push({ code: 'postcleanupscan_observed' });
      requireFact(c.transferSucceeded === true, 'transfer_failed');
      closed(c.receipt, ['mode', 'binding', 'jobId', 'members', 'transferredAt'], 'transfer_receipt');
      requireFact(c.receipt.mode === 'TEST' && c.receipt.jobId === j.jobId && c.receipt.transferredAt === c.transferredAt, 'transfer_binding');
      same(c.receipt.binding, run, 'transfer_binding');
      same(c.receipt.members, controller.members, 'transfer_inventory');
      const independent = controller.cleanup.find(x => x?.job === j.job && x?.jobId === j.jobId);
      closed(independent, CLEANUP, 'independent_cleanup'); same(order(c, CLEANUP), independent, 'independent_cleanup');
      diagnostics.push({ code: 'transfer_verified' });
    }
    requireFact(list(controller.members, true) && artifacts.length + logs.length <= 128, 'inventory_bound');
    const members = []; let total = 0;
    for (const log of logs) requireFact(log?.phase === 'post-actions', 'missing_post_logs');
    for (const m of [...artifacts, ...logs]) {
      closed(m, ['path', 'category', 'bytes', 'format', 'artifactId', 'jobId', 'binding', 'sha256',
        ...(logs.includes(m) ? ['phase'] : [])], 'inventory');
      requireFact(profile.requiredCategories.includes(m.category), 'category_profile');
      same(m.binding, run, 'binding');
      requireFact(jobs.some(j => j.jobId === m.jobId), 'job_binding');
      requireFact(Buffer.isBuffer(m.bytes) && m.bytes.length > 0 && (total += m.bytes.length) <= RAW_LIMIT, 'member_bound');
      // UTF-8 only keeps this pure collector free of ZIP helper subprocesses.
      requireFact(m.format === 'utf8', 'M1A_UNSUPPORTED_BINARY');
      const bytes = Buffer.from(m.bytes);
      requireFact(hash(bytes) === m.sha256, 'member_hash');
      const descriptor = { path: m.path, sha256: m.sha256, size: bytes.length, format: m.format, artifactId: m.artifactId, category: m.category };
      requireFact(!members.some(p => typeof p.path === 'string' && p.path.toLowerCase() === String(m.path).toLowerCase()), 'duplicate_member');
      same({ ...descriptor, jobId: m.jobId, ...(logs.includes(m) ? { phase: m.phase } : {}) },
        controller.members.find(p => p.path === m.path), 'inventory');
      members.push({ ...descriptor, bytes });
    }
    requireFact(controller.members.length === members.length, 'inventory');
    for (const j of jobs) {
      requireFact(logs.some(m => m.jobId === j.jobId && m.category === 'logs'), 'missing_final_logs');
      const c = cleanup.find(c => c.jobId === j.jobId);
      const finals = artifacts.filter(m => m.jobId === j.jobId && m.category === 'observations');
      requireFact(finals.length === 1, 'missing_cleanup_member');
      let final;
      try { final = JSON.parse(finals[0].bytes.toString('utf8')); } catch { fail('cleanup_member'); }
      same(final, { run, job: j, cleanup: order(c, TERMINAL) }, 'cleanup_member');
      observations.push({ job: j.job, conclusion: j.conclusion, cleanupObserved: true, evidencePath: finals[0].path });
    }
    const links = artifacts.filter(m => m.category === 'linkage');
    requireFact(links.length === 1, 'linkage_missing');
    let link;
    try { link = JSON.parse(links[0].bytes.toString('utf8')); } catch { fail('linkage'); }
    same(link, { run, ...earlyBundle }, 'linkage');
    const identity = order(run, IDENTITY), expectedJobs = profile.expectedJobs.map(j => j.job).sort(compare);
    const requiredCategories = [...profile.requiredCategories], verifiedAt = cleanup.map(c => c.verifiedAt);
    // Internal inspection sentinel, never returned as a redaction review or evidence.
    const review = { reviewerId: 'TEST-internal-validation', reviewedAt: '2000-01-01T00:00:00Z', sourceInventorySha256: hash(JSON.stringify(descriptors(members))) };
    await inspect(contractFor(identity, review.reviewedAt, '2001-01-01T00:00:00Z', members, observations, review),
      members, expectedJobs, requiredCategories);
    const result = { ready: true, reasons: [], members: members.sort((a, b) => compare(a.path, b.path)),
      finalObservations: observations.sort((a, b) => compare(a.job, b.job)), diagnostics };
    collections.set(result, { snapshot: structuredClone(result), identity, expectedJobs,
      requiredCategories, verifiedAt });
    return result;
  } catch (error) {
    const code = internalErrors.has(error) ? error.code : 'invalid_input';
    return { ready: false, reasons: [code], members: [], finalObservations: [], diagnostics: [...diagnostics, { code }] };
  }
}

/** Builds the existing closed contract after collection and a caller-supplied review.
 * The hash is a computed proposal for independent review, not an external authority pin.
 */
export async function buildArchiveInputs({ identity, completedAt, requiredRetainUntil, collected, redactionReview } = {}) {
  const provenance = collections.get(collected);
  requireFact(provenance && collected.ready === true, 'collection_required');
  // structuredClone normalizes Buffers to Uint8Arrays, so compare like snapshots.
  same(structuredClone(collected), provenance.snapshot, 'collection_changed');
  same(identity, provenance.identity, 'identity_mismatch');
  requireFact(date(completedAt) && provenance.verifiedAt.every(v => Date.parse(completedAt) >= Date.parse(v)), 'completion_before_verification');
  requireFact(date(redactionReview?.reviewedAt) && Date.parse(redactionReview.reviewedAt) >= Date.parse(completedAt), 'review_before_completion');
  const members = collected.members.map(m => ({ ...order(m, MEMBER), bytes: Buffer.from(m.bytes) }));
  const contract = contractFor(identity, completedAt, requiredRetainUntil, members, collected.finalObservations, redactionReview);
  const expectedContractSha256 = await inspect(contract, members, provenance.expectedJobs, provenance.requiredCategories);
  return { contract, inventory: { sourceInventorySha256: hash(JSON.stringify(contract.members)),
    expectedJobs: [...provenance.expectedJobs], requiredCategories: [...provenance.requiredCategories] }, expectedContractSha256 };
}

function freezeTree(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeTree);
    Object.freeze(value);
  }
  return value;
}

/** Offline injected capabilities only. Entries are retained until this coordinator is
 * discarded; suppression is neither durable nor shared with another instance/process.
 * A hung capability stays pending: timing it out would not cancel an uncertain Put.
 */
export function createTestArchiveCoordinator(options) {
  requireFact(options?.mode === 'TEST', 'unresolved_P4_P5_production_refused');
  closed(options, ['mode', 'dependencies', 'cleanup', ...(Object.hasOwn(options, 'maxDeliveries') ? ['maxDeliveries'] : [])]);
  closed(options.dependencies, ['prepareArchive', 'createStore', 'writeExclusive', 'now']);
  requireFact(Object.values(options.dependencies).every(v => typeof v === 'function') && typeof options.cleanup === 'function', 'invalid_input');
  const dependencies = { ...options.dependencies }, cleanup = options.cleanup, max = options.maxDeliveries ?? 128;
  requireFact(Number.isSafeInteger(max) && max >= 1 && max <= 128, 'delivery_limit');
  const deliveries = new Map();
  return Object.freeze({
    async deliver(input) {
      closed(input, ['identity', 'archiveInputs', 'paths', 'cleanupObservation']);
      closed(input.identity, IDENTITY);
      requireFact(IDENTITY.filter(k => k !== 'runAttempt').every(k => label(input.identity[k])) &&
        Number.isSafeInteger(input.identity.runAttempt) && input.identity.runAttempt > 0, 'invalid_input');
      closed(input.archiveInputs, ['contract', 'inventory', 'expectedContractSha256']);
      closed(input.paths, ['contract', 'inventory', 'inputRoot', 'scratchRoot', 'output']);
      requireFact(Object.values(input.paths).every(p => typeof p === 'string' && p.length > 0 && p.length <= 4096 && !/[\x00-\x1f\x7f]/.test(p)) &&
        input.paths.contract !== input.paths.inventory && HASH.test(input.archiveInputs.expectedContractSha256), 'invalid_input');
      requireFact(list(input.cleanupObservation, true), 'invalid_input');
      input.cleanupObservation.forEach(c => closed(c, CLEANUP));
      // Bound serialized TEST control inputs before retaining snapshots. No bytes or context are accepted.
      const serialized = JSON.stringify(input);
      requireFact(Buffer.byteLength(serialized) <= 1024 * 1024, 'delivery_bound');
      const snapshot = structuredClone(input);
      const slot = JSON.stringify(order(snapshot.identity, ['campaignId', 'runId', 'runAttempt', 'qaAttempt']));
      const previous = deliveries.get(slot);
      if (previous) {
        same(snapshot, previous.snapshot, 'duplicate_identity_conflict');
        return previous.pending;
      }
      requireFact(deliveries.size < max, 'delivery_limit');
      same(order(snapshot.archiveInputs.contract, IDENTITY), snapshot.identity, 'identity_mismatch');
      const { archiveInputs: built, paths } = snapshot;
      const argv = ['--contract', paths.contract, '--expected-contract-sha256', built.expectedContractSha256,
        '--inventory', paths.inventory, '--input-root', paths.inputRoot, '--scratch-root', paths.scratchRoot,
        '--output', paths.output, '--allow-upload'];
      // Install the pending entry before any callback, including synchronously reentrant delivery.
      const pending = Promise.resolve().then(async () => {
        let cleanupStatus = 'completed';
        try { await cleanup(structuredClone(snapshot.cleanupObservation)); }
        catch { cleanupStatus = 'failed'; }
        const outcome = await runArchiveCommand(argv, {
          ...dependencies,
          readInput: async path => structuredClone(path === paths.contract ? built.contract : built.inventory),
          prepareArchive: async args => {
            const prepared = await dependencies.prepareArchive(args);
            same(prepared.identity, snapshot.identity, 'identity_mismatch');
            return prepared;
          }
        });
        const ref = outcome.result.ref ?? (outcome.exitCode === 0 ? order(outcome.result.destination, ['key', 'versionId']) : undefined);
        return freezeTree({ mode: 'TEST', status: outcome.exitCode === 0 ? outcome.result.status : ref ? 'KNOWN_VERSION' : 'UNKNOWN',
          exitCode: outcome.exitCode, ...(ref ? { ref: { ...ref } } : {}),
          reconciliation: outcome.exitCode === 0 ? 'independent_review_required' : ref ? 'operator_exact_version_read_only' : 'operator_unknown_outcome',
          cleanup: { status: cleanupStatus, observation: structuredClone(snapshot.cleanupObservation) } });
      });
      deliveries.set(slot, { snapshot, pending });
      return pending;
    }
  });
}

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { verifyStoredArchive } from './m1a-archive/readback.mjs';

const boundaries = new WeakMap();
const receipts = new WeakMap();
const IDENTITY = ['candidate', 'campaignId', 'runId', 'runAttempt', 'qaAttempt'];
const SCOPE = ['repositoryId', 'workflowId', ...IDENTITY];
const TERMINAL = ['capturedAt', 'preparation', 'missingContext', 'teardownAt', 'exitCode', 'residualResources', 'uncertainty'];
const CLEANUP = ['job', 'jobId', ...TERMINAL, 'scanAt', 'scanPassed', 'contextAvailable', 'contextPrivate',
  'contextNonUploadable', 'contextDestroyedAt', 'transferredAt', 'transferSucceeded', 'verifiedAt'];
const fail = code => { throw new Error(code); };
const requireFact = (ok, code) => { if (!ok) fail(code); };
function closed(v, keys) {
  requireFact(v && Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).length === keys.length &&
    keys.every(k => { const d = Object.getOwnPropertyDescriptor(v, k); return d?.enumerable && Object.hasOwn(d, 'value'); }), 'invalid_input');
}
const label = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 256 && !/[\x00-\x1f\x7f]/.test(v);
const order = (v, keys) => Object.fromEntries(keys.map(k => [k, v[k]]));
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
const digest = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function date(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)) return false;
  const n = Date.parse(v);
  return Number.isFinite(n) && [new Date(n).toISOString(), new Date(n).toISOString().replace('.000Z', 'Z')].includes(v);
}
function cleanupNonpass(final, jobs) {
  if (!Array.isArray(final.cleanup) || final.cleanup.length !== jobs.length || jobs.length > 128) return true;
  const seen = new Set(), ids = new Set();
  for (const c of final.cleanup) {
    closed(c, CLEANUP);
    if (!jobs.includes(c.job) || seen.has(c.job) || ids.has(c.jobId) || !label(c.jobId)) return true;
    seen.add(c.job); ids.add(c.jobId);
    if (['missingContext', 'residualResources', 'uncertainty'].some(k => !Array.isArray(c[k]) || c[k].length !== 0) ||
      c.exitCode !== 0 || c.preparation !== 'complete' ||
      ['scanPassed', 'contextAvailable', 'contextPrivate', 'contextNonUploadable', 'transferSucceeded'].some(k => c[k] !== true)) return true;
    const times = ['capturedAt', 'teardownAt', 'scanAt', 'contextDestroyedAt', 'transferredAt', 'verifiedAt'].map(k => c[k]);
    if (!times.every(date) || times.some((t, i) => i && Date.parse(t) <= Date.parse(times[i - 1])) ||
      !date(final.contract.completedAt) || Date.parse(c.verifiedAt) > Date.parse(final.contract.completedAt)) return true;
  }
  return final.contract.finalObservations.some(o => o.cleanupObserved !== true);
}

/** Explicit caller-controlled TEST injection, not approval authentication or a production policy schema.
 * Reviewed collection pins must be supplied independently before receipt ingestion.
 * No defaults, AWS adapter, signing, persistent owner record, retry or gate promotion.
 */
export function createTestEvidenceDisposition(input) {
  requireFact(input?.mode === 'TEST', 'unresolved_P5_P6_production_refused');
  closed(input, ['mode', 'reviewedCollection', 'authority', 'ownerAuthority']);
  closed(input.reviewedCollection, ['scope', 'pinned', 'finalEvidence']);
  closed(input.authority, ['mode', 'approvedBy', 'readOnly', 'authority']);
  closed(input.authority.authority, ['expectedAccount', 'expectedArn', 'reviewerId']);
  closed(input.ownerAuthority, ['mode', 'ownerId', 'attribution']);
  requireFact(input.authority.mode === 'TEST' && input.authority.readOnly === true && label(input.authority.approvedBy) &&
    input.ownerAuthority.mode === 'TEST' && label(input.ownerAuthority.ownerId) && label(input.ownerAuthority.attribution), 'TEST_authority_required');
  const authority = input.authority.authority;
  requireFact(authority.expectedAccount === '010438509726' && label(authority.reviewerId) &&
    typeof authority.expectedArn === 'string' && /^arn:aws:(?:iam::010438509726:(?:user|role)\/[^\s]+|sts::010438509726:assumed-role\/[^\s]+\/[^\s]+)$/.test(authority.expectedArn) &&
    authority.expectedArn !== 'arn:aws:iam::010438509726:user/aoa-s3-artifacts', 'TEST_authority_required');
  const collection = input.reviewedCollection;
  closed(collection.scope, SCOPE); closed(collection.pinned, ['ref', 'expected']);
  closed(collection.finalEvidence, ['scope', 'contract', 'cleanup']);
  requireFact(SCOPE.filter(k => k !== 'runAttempt').every(k => label(collection.scope[k])) &&
    Number.isSafeInteger(collection.scope.runAttempt) && collection.scope.runAttempt > 0 &&
    isDeepStrictEqual(collection.scope, collection.finalEvidence.scope) &&
    isDeepStrictEqual(order(collection.scope, IDENTITY), collection.pinned.expected.identity) &&
    isDeepStrictEqual(order(collection.finalEvidence.contract, IDENTITY), collection.pinned.expected.identity), 'scope_mismatch');
  const state = freeze(structuredClone(input));
  const pinnedExpectations = Object.freeze({ mode: 'TEST' });
  boundaries.set(pinnedExpectations, state);
  return Object.freeze({ pinnedExpectations,
    async verify(options) {
      closed(options, ['store', 'uploadFacts', 'now']);
      // Check the original capability before wrapping reads; inherited put is also forbidden.
      requireFact(options.store && !('put' in options.store), 'read_only_store_required');
      const uploadFacts = structuredClone(options.uploadFacts);
      let archive;
      const store = {};
      for (const method of ['identify', 'inspectConfiguration', 'head', 'get', 'retention']) {
        const call = options.store[method]; requireFact(typeof call === 'function', 'read_only_store_required');
        store[method] = async arg => {
          const result = await call.call(options.store, arg);
          if (method === 'get') {
            closed(result, ['versionId', 'bytes', 'checksumSha256', 'encryption']);
            const response = order(result, ['versionId', 'bytes', 'checksumSha256', 'encryption']);
            requireFact(Buffer.isBuffer(response.bytes), 'invalid_input');
            // Own bytes and metadata before yielding; readback and observation parsing share this snapshot.
            response.bytes = Buffer.from(response.bytes);
            archive = response.bytes;
            return response;
          }
          return result;
        };
      }
      const verification = await verifyStoredArchive({ store, ...state.reviewedCollection.pinned,
        authority: state.authority.authority, uploadFacts, now: options.now });
      const bundle = JSON.parse(archive.toString('utf8'));
      const final = state.reviewedCollection.finalEvidence;
      requireFact(isDeepStrictEqual(bundle.contract, final.contract), 'final_contract_mismatch');
      requireFact(Array.isArray(final.cleanup) && final.cleanup.length === bundle.contract.finalObservations.length, 'final_cleanup_mismatch');
      for (const o of bundle.contract.finalObservations) {
        const c = final.cleanup.find(c => c.job === o.job); requireFact(c, 'final_cleanup_mismatch'); closed(c, CLEANUP);
        const member = bundle.members.find(m => m.path === o.evidencePath);
        requireFact(member, 'final_cleanup_mismatch');
        let observation;
        try { observation = JSON.parse(Buffer.from(member.base64, 'base64').toString('utf8')); }
        catch { fail('final_cleanup_mismatch'); }
        requireFact(isDeepStrictEqual(observation, { run: state.reviewedCollection.scope,
          job: { job: c.job, jobId: c.jobId, status: 'completed', conclusion: o.conclusion, postActionsComplete: true },
          cleanup: order(c, TERMINAL) }), 'final_cleanup_mismatch');
      }
      freeze(verification);
      receipts.set(verification, { pinnedExpectations, uploadHash: digest(uploadFacts), verificationHash: digest(verification) });
      return verification;
    }
  });
}

/** Review eligibility only. All failures return bounded codes; no owner ruling is issued. */
export function evaluateEvidenceDisposition(input) {
  try {
    closed(input, ['pinnedExpectations', 'uploadFacts', 'verification', 'ownerDisposition', 'finalEvidence']);
    const state = boundaries.get(input.pinnedExpectations);
    requireFact(state, 'independent_TEST_pins_required');
    const receipt = receipts.get(input.verification);
    requireFact(receipt?.pinnedExpectations === input.pinnedExpectations && receipt.uploadHash === digest(input.uploadFacts) &&
      receipt.verificationHash === digest(input.verification), 'independent_verification_required');
    requireFact(isDeepStrictEqual(input.finalEvidence, state.reviewedCollection.finalEvidence), 'final_evidence_mismatch');
    const owner = input.ownerDisposition;
    closed(owner, ['mode', 'scope', 'ref', 'uploadFactsSha256', 'verificationSha256', 'finalEvidenceSha256', 'ownerId', 'attribution', 'recordedAt', 'disposition']);
    requireFact(owner.mode === 'TEST' && owner.disposition === 'review_requested' &&
      owner.ownerId === state.ownerAuthority.ownerId && owner.attribution === state.ownerAuthority.attribution &&
      isDeepStrictEqual(owner.scope, state.reviewedCollection.scope) && isDeepStrictEqual(owner.ref, state.reviewedCollection.pinned.ref) &&
      owner.uploadFactsSha256 === receipt.uploadHash && owner.verificationSha256 === receipt.verificationHash &&
      owner.finalEvidenceSha256 === digest(input.finalEvidence) && date(owner.recordedAt) &&
      Date.parse(owner.recordedAt) >= Date.parse(input.verification.verifiedAt), 'owner_record_refused');
    requireFact(!cleanupNonpass(input.finalEvidence, state.reviewedCollection.pinned.expected.expectedJobs), 'cleanup_nonpass');
    return freeze({ eligibleForRetOwnerReview: true, reasons: [] });
  } catch (e) {
    const allowed = ['invalid_input', 'independent_TEST_pins_required', 'independent_verification_required', 'final_evidence_mismatch', 'owner_record_refused', 'cleanup_nonpass'];
    return freeze({ eligibleForRetOwnerReview: false, reasons: [allowed.includes(e.message) ? e.message : 'invalid_input'] });
  }
}

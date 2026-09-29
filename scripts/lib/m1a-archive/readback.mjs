import { createHash } from 'node:crypto';
import { validateArchiveBytes } from './evidence.mjs';

const ACCOUNT = '010438509726';
const REGION = 'us-east-1';
const BUCKET = 'aoa-platform-evidence-010438509726-us-east-1-an';
const UPLOADER = `arn:aws:iam::${ACCOUNT}:user/aoa-s3-artifacts`;
const DAYS_180 = 180 * 24 * 60 * 60 * 1000;
const SKEW = 300_000;
const LIMIT = 128 * 1024 * 1024;
const IDENTITY_KEYS = ['candidate', 'campaignId', 'runId', 'runAttempt', 'qaAttempt'];
const EXPECTED_KEYS = ['contractSha256', 'sha256', 'size', 'identity', 'requiredRetainUntil', 'expectedJobs', 'requiredCategories'];
const PREPARED_KEYS = ['bytes', 'sha256', 'size', 'contractSha256', 'identity', 'requiredRetainUntil'];
const FACT_KEYS = ['schema', 'classification', 'status', 'destination', 'identity', 'contractSha256', 'sha256', 'size', 'uploader',
  'putStartedAt', 'putCompletedAt', 'lastModified', 'retainUntil', 'requiredRetainUntil'];
const ERROR_CODES = new Set(['M1A_INVALID_INPUT', 'M1A_TIME_REFUSED', 'M1A_EXPECTATIONS_REQUIRED', 'M1A_ARCHIVE_MISMATCH',
  'M1A_VERSION_REFUSED', 'M1A_DESTINATION_MISMATCH', 'M1A_IDENTITY_MISMATCH', 'M1A_AUTHORITY_REFUSED',
  'M1A_CONFIGURATION_MISMATCH', 'M1A_STORE_REFUSED', 'M1A_STORE_FAILED', 'M1A_READBACK_MISMATCH',
  'M1A_RETENTION_REFUSED', 'M1A_RECEIPT_MISMATCH', 'M1A_EVIDENCE_REFUSED']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function fail(code) { throw Object.assign(new Error(code), { code }); }
function closed(value, keys, optional = []) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype ||
    keys.some(k => !Object.hasOwn(value, k)) || Reflect.ownKeys(value).some(k => ![...keys, ...optional].includes(k) ||
      !Object.getOwnPropertyDescriptor(value, k)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), 'value'))) fail('M1A_INVALID_INPUT');
}
function token(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) fail('M1A_INVALID_INPUT');
}
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) fail('M1A_TIME_REFUSED');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ![new Date(ms).toISOString(), new Date(ms).toISOString().replace('.000Z', 'Z')].includes(value)) fail('M1A_TIME_REFUSED');
  return ms;
}
function clock(now) {
  if (typeof now !== 'function') fail('M1A_INVALID_INPUT');
  const date = now();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail('M1A_TIME_REFUSED');
  return date.toISOString();
}
function identity(input) {
  closed(input, IDENTITY_KEYS);
  if (typeof input.candidate !== 'string' || !/^[a-f0-9]{40}$/.test(input.candidate) || typeof input.campaignId !== 'string' ||
    input.campaignId.length > 128 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.campaignId) ||
    typeof input.runId !== 'string' || !/^[1-9][0-9]{0,31}$/.test(input.runId) || !Number.isSafeInteger(input.runAttempt) || input.runAttempt < 1 ||
    typeof input.qaAttempt !== 'string' || !/^a[1-9][0-9]{0,31}$/.test(input.qaAttempt)) fail('M1A_INVALID_INPUT');
  return Object.fromEntries(IDENTITY_KEYS.map(k => [k, input[k]]));
}
function fields(input) {
  for (const k of ['sha256', 'contractSha256']) if (typeof input[k] !== 'string' || !/^[a-f0-9]{64}$/.test(input[k])) fail('M1A_INVALID_INPUT');
  if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > LIMIT) fail('M1A_INVALID_INPUT');
  time(input.requiredRetainUntil);
  return { contractSha256: input.contractSha256, sha256: input.sha256, size: input.size,
    identity: identity(input.identity), requiredRetainUntil: input.requiredRetainUntil };
}
function strings(input) {
  if (!Array.isArray(input) || !input.length || input.length > 128 || new Set(input).size !== input.length) fail('M1A_EXPECTATIONS_REQUIRED');
  input.forEach(token); return [...input];
}
function expectations(input) {
  closed(input, EXPECTED_KEYS, ['secretCanaries']);
  const expected = { ...fields(input), expectedJobs: strings(input.expectedJobs), requiredCategories: strings(input.requiredCategories) };
  if (input.secretCanaries !== undefined) {
    if (!Array.isArray(input.secretCanaries) || input.secretCanaries.length > 128 || input.secretCanaries.some(s => typeof s !== 'string' || !s || s.length > 4096)) fail('M1A_INVALID_INPUT');
    expected.secretCanaries = [...input.secretCanaries];
  }
  return expected;
}
function same(a, b) {
  if (['contractSha256', 'sha256', 'size', 'requiredRetainUntil'].some(k => a[k] !== b[k]) || IDENTITY_KEYS.some(k => a.identity[k] !== b.identity[k])) fail('M1A_ARCHIVE_MISMATCH');
}
function keyFor(expected) {
  const i = expected.identity;
  return `replatform/m1a/${i.campaignId}/${i.runId}-r${i.runAttempt}/${i.qaAttempt}/${expected.sha256}.json`;
}
function version(v) {
  if (typeof v !== 'string' || !v.trim() || v === 'null' || v.startsWith('-') || /[\x00-\x20\x7f]/.test(v)) fail('M1A_VERSION_REFUSED');
  return v;
}
function reference(input, expected) {
  closed(input, ['key', 'versionId']);
  if (input.key !== keyFor(expected)) fail('M1A_DESTINATION_MISMATCH');
  return Object.freeze({ key: input.key, versionId: version(input.versionId) });
}
function principal(input, expectedArn) {
  closed(input, ['account', 'arn']);
  if (input.account !== ACCOUNT || input.arn !== expectedArn) fail('M1A_IDENTITY_MISMATCH');
  return { account: input.account, arn: input.arn };
}
function authority(input) {
  closed(input, ['expectedAccount', 'expectedArn', 'reviewerId']); token(input.reviewerId);
  // Qualified IAM users/roles and STS role sessions only; no root or bare resource.
  const qualified = /^arn:aws:(?:iam::010438509726:(?:user|role)\/[A-Za-z0-9+=,.@_-]+(?:\/[A-Za-z0-9+=,.@_-]+)*|sts::010438509726:assumed-role\/[A-Za-z0-9+=,.@_-]+\/[A-Za-z0-9+=,.@_-]+)$/;
  if (input.expectedAccount !== ACCOUNT || typeof input.expectedArn !== 'string' || !qualified.test(input.expectedArn) || input.expectedArn === UPLOADER) fail('M1A_AUTHORITY_REFUSED');
  return { ...input };
}
function configuration(config) {
  const retention = config?.objectLock?.Rule?.DefaultRetention;
  if (config?.versioning?.Status !== 'Enabled' || config?.encryption?.Rules?.length !== 1 ||
    config.encryption.Rules[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm !== 'AES256' ||
    config?.objectLock?.ObjectLockEnabled !== 'Enabled' || retention?.Mode !== 'COMPLIANCE' || retention.Days !== 180 ||
    Object.hasOwn(retention, 'Years')) fail('M1A_CONFIGURATION_MISMATCH');
}
function storeMethods(store, upload) {
  if (!store || ['identify', 'inspectConfiguration', 'head', 'get', 'retention', ...upload ? ['put'] : []].some(k => typeof store[k] !== 'function') ||
    !upload && 'put' in store) fail('M1A_STORE_REFUSED');
}
async function call(store, method, arg) {
  try { return await store[method](arg); } catch { fail('M1A_STORE_FAILED'); }
}
async function validate(bytes, expected) {
  try { await validateArchiveBytes({ bytes, expected }); } catch { fail('M1A_EVIDENCE_REFUSED'); }
}
function timing(start, complete, created) {
  const s = time(start), c = time(complete), m = time(created);
  if (c < s || m < s - SKEW || m > c + SKEW) fail('M1A_TIME_REFUSED');
}
async function readback(store, ref, expected, started, completed, checkedAt, originalBytes) {
  const sum = Buffer.from(expected.sha256, 'hex').toString('base64');
  const head = await call(store, 'head', { ...ref });
  if (!head || head.versionId !== ref.versionId || head.size !== expected.size || head.checksumSha256 !== sum || head.encryption !== 'AES256') fail('M1A_READBACK_MISMATCH');
  // Capture metadata before another asynchronous transport call can mutate it.
  const lastModified = head.lastModified;
  timing(started, completed, lastModified);
  const get = await call(store, 'get', { ...ref });
  if (!get || get.versionId !== ref.versionId || get.checksumSha256 !== sum || get.encryption !== 'AES256' ||
    !Buffer.isBuffer(get.bytes) || get.bytes.length !== expected.size || hash(get.bytes) !== expected.sha256 ||
    originalBytes && !get.bytes.equals(originalBytes)) fail('M1A_READBACK_MISMATCH');
  await validate(Buffer.from(get.bytes), expected);
  const retention = await call(store, 'retention', { ...ref });
  if (!retention || retention.mode !== 'COMPLIANCE') fail('M1A_RETENTION_REFUSED');
  const retainUntil = retention.retainUntil, until = time(retainUntil);
  // S3 creation, never review time, anchors the exact 180-day floor. No tolerance.
  if (until < Math.max(time(lastModified) + DAYS_180, time(expected.requiredRetainUntil)) || until <= time(checkedAt)) fail('M1A_RETENTION_REFUSED');
  return { lastModified, retainUntil };
}
function facts(expected, ref, uploader, started, completed, stored) {
  return { schema: 1, classification: 'M1A_ARCHIVE_FACTS', status: 'uploaded_verified_pending_independent_review',
    destination: { account: ACCOUNT, region: REGION, bucket: BUCKET, ...ref }, identity: { ...expected.identity },
    contractSha256: expected.contractSha256, sha256: expected.sha256, size: expected.size, uploader,
    putStartedAt: started, putCompletedAt: completed, ...stored, requiredRetainUntil: expected.requiredRetainUntil };
}
function receipt(input, expected, ref) {
  closed(input, FACT_KEYS); same(fields(input), expected);
  if (input.schema !== 1 || input.classification !== 'M1A_ARCHIVE_FACTS' || input.status !== 'uploaded_verified_pending_independent_review') fail('M1A_RECEIPT_MISMATCH');
  closed(input.destination, ['account', 'region', 'bucket', 'key', 'versionId']);
  if (input.destination.account !== ACCOUNT || input.destination.region !== REGION || input.destination.bucket !== BUCKET ||
    input.destination.key !== ref.key || input.destination.versionId !== ref.versionId) fail('M1A_DESTINATION_MISMATCH');
  const uploader = principal(input.uploader, UPLOADER);
  timing(input.putStartedAt, input.putCompletedAt, input.lastModified); time(input.retainUntil);
  return facts(expected, ref, uploader, input.putStartedAt, input.putCompletedAt, { lastModified: input.lastModified, retainUntil: input.retainUntil });
}
function sanitized(error, ref) {
  const code = ERROR_CODES.has(error?.code) ? error.code : 'M1A_INVALID_INPUT';
  return Object.assign(new Error(code), { code }, ref ? { ref: { ...ref } } : {});
}

/** @typedef {import('./evidence.mjs').PreparedArchive} PreparedArchive */
/** @typedef {{contractSha256:string,sha256:string,size:number,identity:object,requiredRetainUntil:string,expectedJobs:string[],requiredCategories:string[],secretCanaries?:string[]}} ExpectedArchive */
/** @typedef {{expectedAccount:string,expectedArn:string,reviewerId:string}} VerifierAuthority */
/** @typedef {{schema:1,classification:'M1A_ARCHIVE_FACTS',status:'uploaded_verified_pending_independent_review',destination:object,identity:object,contractSha256:string,sha256:string,size:number,uploader:object,putStartedAt:string,putCompletedAt:string,lastModified:string,retainUntil:string,requiredRetainUntil:string}} UploadFacts */
/**
 * One conditional put via Task 1's fixed Store, then exact-version integrity reads.
 * Trusted expectations must come from external inventory, never bundle discovery.
 * A thrown post-put error carries ref when the returned version is known; no retry.
 * @param {{store:object,prepared:PreparedArchive,expected:ExpectedArchive,now?:()=>Date}} options
 * @returns {Promise<UploadFacts>}
 */
export async function uploadPreparedArchive(options) {
  let ref;
  try {
    closed(options, ['store', 'prepared', 'expected'], ['now']);
    const { store, now = () => new Date() } = options;
    storeMethods(store, true);
    const expected = expectations(options.expected);
    closed(options.prepared, PREPARED_KEYS); same(fields(options.prepared), expected);
    if (!Buffer.isBuffer(options.prepared.bytes) || options.prepared.bytes.length !== expected.size) fail('M1A_ARCHIVE_MISMATCH');
    const bytes = Buffer.from(options.prepared.bytes);
    await validate(bytes, expected);
    const uploader = principal(await call(store, 'identify'), UPLOADER);
    configuration(await call(store, 'inspectConfiguration'));
    const started = clock(now), key = keyFor(expected), sum = Buffer.from(expected.sha256, 'hex').toString('base64');
    let put;
    try { put = await store.put({ key, bytes: Buffer.from(bytes), checksumSha256: sum }); }
    catch (error) {
      // Only validated destination/version primitives escape a producer failure.
      try { ref = reference(error?.knownVersionRef, expected); } catch { /* Unknown version stays unknown. */ }
      fail('M1A_STORE_FAILED');
    }
    ref = reference({ key, versionId: put?.versionId }, expected);
    const completed = clock(now);
    if (put.checksumSha256 !== sum) fail('M1A_READBACK_MISMATCH');
    const stored = await readback(store, ref, expected, started, completed, completed, bytes);
    return facts(expected, ref, uploader, started, completed, stored);
  } catch (error) { throw sanitized(error, ref); }
}

/**
 * Read-only verification uses externally pinned authority/ref/expectations. An ARN
 * match records identity, not IAM policy approval; permission setup is operator-owned.
 * @param {{store:object,ref:object,expected:ExpectedArchive,authority:VerifierAuthority,uploadFacts:UploadFacts,now?:()=>Date}} options
 */
export async function verifyStoredArchive(options) {
  try {
    closed(options, ['store', 'ref', 'expected', 'authority', 'uploadFacts'], ['now']);
    const { store, now = () => new Date() } = options;
    storeMethods(store, false);
    const expected = expectations(options.expected), ref = reference(options.ref, expected), pinnedAuthority = authority(options.authority);
    const upload = receipt(options.uploadFacts, expected, ref);
    const verifier = principal(await call(store, 'identify'), pinnedAuthority.expectedArn);
    if (verifier.arn === UPLOADER) fail('M1A_AUTHORITY_REFUSED');
    configuration(await call(store, 'inspectConfiguration'));
    const verifiedAt = clock(now);
    if (time(verifiedAt) < time(upload.putCompletedAt)) fail('M1A_TIME_REFUSED');
    const stored = await readback(store, ref, expected, upload.putStartedAt, upload.putCompletedAt, verifiedAt);
    if (stored.lastModified !== upload.lastModified || stored.retainUntil !== upload.retainUntil) fail('M1A_RECEIPT_MISMATCH');
    return { classification: 'M1A_ARCHIVE_VERIFICATION', status: 'independently_verified_pending_owner_disposition',
      verifier, reviewerId: pinnedAuthority.reviewerId, verifiedAt, facts: upload };
  } catch (error) { throw sanitized(error); }
}

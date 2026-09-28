import { createHash, createPublicKey, verify } from 'node:crypto';

export class GatewayRenderAuthorityError extends Error {
  constructor() { super('gateway-render-authority-refused'); this.name = 'GatewayRenderAuthorityError'; }
}

const require = (condition) => { if (!condition) throw new GatewayRenderAuthorityError(); };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
const epoch = (value) => Number.isSafeInteger(value) && value >= 0;
function keys(value, fields, ordered = false) {
  require(value !== null && typeof value === 'object' && !Array.isArray(value));
  const actual = Object.keys(value);
  require(JSON.stringify(ordered ? actual : actual.sort()) ===
    JSON.stringify(ordered ? fields : [...fields].sort()));
}
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  return value;
}
export function renderProfileHash(profile) {
  const { profileSha256: ignored, ...body } = profile;
  const bytes = JSON.stringify(sorted(body));
  require(/^[\x20-\x7e]*$/.test(bytes));
  return hash(bytes);
}
function protectedProfile(profile, expected) {
  keys(profile, ['schema', 'classification', 'controllerSha', 'candidate', 'session',
    'candidateUid', 'authorityFingerprint', 'composeSha256', 'inputIdentitySha256',
    'project', 'services', 'profileSha256']);
  require(profile.schema === 'm1a-gateway-render-profile-offline-v1' && profile.classification === 'OFFLINE_TEST_ONLY');
  require(hex(profile.controllerSha, 40) && hex(profile.candidate, 40) && hex(profile.authorityFingerprint, 64)
    && hex(profile.composeSha256, 64) && hex(profile.inputIdentitySha256, 64) && hex(profile.profileSha256, 64));
  require(identifier(profile.session) && identifier(profile.project)
    && epoch(profile.candidateUid) && profile.candidateUid > 0);
  for (const field of ['controllerSha', 'candidate', 'session', 'candidateUid',
    'authorityFingerprint', 'composeSha256', 'inputIdentitySha256', 'profileSha256']) require(profile[field] === expected[field]);
  require(renderProfileHash(profile) === profile.profileSha256);
  require(Array.isArray(profile.services) && profile.services.length >= 1 && profile.services.length <= 32);
  const names = profile.services.map((service) => service?.name);
  require(names.every(identifier) && JSON.stringify(names) === JSON.stringify([...new Set(names)].sort()));
  const graph = new Map();
  for (const service of profile.services) {
    keys(service, ['name', 'dependencies']);
    const deps = service.dependencies;
    require(Array.isArray(deps) && deps.length <= 32 && deps.every(identifier)
      && JSON.stringify(deps) === JSON.stringify([...new Set(deps)].sort())
      && deps.every((dep) => names.includes(dep) && dep !== service.name));
    graph.set(service.name, deps);
  }
  const visited = new Set();
  const visit = (name, active) => {
    require(!active.has(name));
    if (visited.has(name)) return;
    for (const dep of graph.get(name)) visit(dep, new Set([...active, name]));
    visited.add(name);
  };
  for (const name of names) visit(name, new Set());
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

export function verifyGatewayRenderAuthority(input) {
  try {
    const { signedPolicyBytes, signatureBytes, trustedPublicKeyPem, expected, now, revocation } = input;
    require(signedPolicyBytes instanceof Uint8Array && signedPolicyBytes.byteLength > 0 && signedPolicyBytes.byteLength <= 1048576);
    require(signatureBytes instanceof Uint8Array && signatureBytes.byteLength === 64 && typeof trustedPublicKeyPem === 'string');
    keys(expected, ['fullProfile', 'controllerSha', 'candidate', 'session', 'profileSha256',
      'authorityFingerprint', 'candidateUid', 'composeSha256', 'inputIdentitySha256', 'maxAgeSeconds',
      'installationId', 'generation', 'minimumRevocationSequence']);
    require(epoch(expected.maxAgeSeconds) && expected.maxAgeSeconds >= 1 && expected.maxAgeSeconds <= 86400);
    require(identifier(expected.installationId) && epoch(expected.generation) && expected.generation >= 1
      && epoch(expected.minimumRevocationSequence));
    const bytes = Buffer.from(signedPolicyBytes);
    const key = createPublicKey(trustedPublicKeyPem);
    require(key.asymmetricKeyType === 'ed25519' && verify(null, bytes, key, Buffer.from(signatureBytes)));
    const policy = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
    keys(policy, ['schema', 'classification', 'mode', 'controllerSha', 'candidate', 'session',
      'profileSha256', 'authorityFingerprint', 'notBefore', 'expiresAt'], true);
    require(Buffer.from(JSON.stringify(policy)).equals(bytes));
    require(policy.schema === 'm1a-gateway-render-policy-offline-v1' && policy.classification === 'OFFLINE_TEST_ONLY'
      && policy.mode === 'render-only');
    protectedProfile(expected.fullProfile, expected);
    for (const field of ['controllerSha', 'candidate', 'session', 'profileSha256', 'authorityFingerprint'])
      require(policy[field] === expected[field]);
    require(hash(key.export({ type: 'spki', format: 'der' })) === policy.authorityFingerprint);
    require(epoch(now) && epoch(policy.notBefore) && epoch(policy.expiresAt)
      && policy.notBefore <= now && now < policy.expiresAt && policy.notBefore < policy.expiresAt);
    keys(revocation, ['schema', 'installationId', 'generation', 'sequence',
      'available', 'checkedAt', 'validUntil', 'revoked']);
    require(revocation.schema === 'm1a-gateway-revocation-v1'
      && revocation.installationId === expected.installationId
      && revocation.generation === expected.generation
      && epoch(revocation.sequence) && revocation.sequence >= expected.minimumRevocationSequence
      && revocation.available === true && epoch(revocation.checkedAt) && epoch(revocation.validUntil)
      && revocation.checkedAt <= now && now < revocation.validUntil
      && now - revocation.checkedAt <= expected.maxAgeSeconds
      && Array.isArray(revocation.revoked) && revocation.revoked.length <= 512
      && revocation.revoked.every((item) => hex(item, 64))
      && new Set(revocation.revoked).size === revocation.revoked.length
      && !revocation.revoked.includes(policy.authorityFingerprint) && !revocation.revoked.includes(hash(bytes)));
    return freeze({ offlineOnly: true, policy, policySha256: hash(bytes), signatureSha256: hash(Buffer.from(signatureBytes)),
      verifiedAt: now, revocationCheckedAt: revocation.checkedAt,
      revocationValidUntil: revocation.validUntil });
  } catch {
    throw new GatewayRenderAuthorityError();
  }
}

import { createHash, createPublicKey, verify } from 'node:crypto';

export class GatewayAuthorityError extends Error {
  constructor() { super('gateway-authority-refused'); this.name = 'GatewayAuthorityError'; }
}

const require = (condition) => { if (!condition) throw new GatewayAuthorityError(); };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fields = ['schema', 'classification', 'controllerSha', 'candidate', 'session', 'profileSha256', 'authorityFingerprint', 'notBefore', 'expiresAt', 'images', 'provider'];
const identities = ['controllerSha', 'candidate', 'session', 'profileSha256', 'authorityFingerprint'];
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
const digest = (value) => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const epoch = (value) => Number.isSafeInteger(value) && value >= 0;
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
function keys(value, names) {
  require(value !== null && typeof value === 'object' && !Array.isArray(value));
  require(JSON.stringify(Object.keys(value)) === JSON.stringify(names));
}
function imageInventory(images, relationships) {
  require(Array.isArray(images) && images.length >= 1 && images.length <= 32);
  const services = new Set();
  for (const image of images) {
    keys(image, ['service', 'kind', 'digest', 'configId', 'relationship']);
    require(typeof image.service === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(image.service));
    require(!services.has(image.service)); services.add(image.service);
    require(digest(image.digest) && digest(image.configId));
    if (image.kind === 'docker-config-id') {
      require(image.digest === image.configId && image.relationship === null);
    } else {
      require(image.kind === 'oci-manifest');
      keys(image.relationship, ['manifestDigest', 'configId']);
      require(image.relationship.manifestDigest === image.digest && image.relationship.configId === image.configId);
      require(Array.isArray(relationships) && relationships.some((item) => JSON.stringify(item) === JSON.stringify(image.relationship)));
    }
  }
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  return value;
}
export function gatewayProfileHash(fullProfile) {
  const { profileSha256: ignored, ...body } = fullProfile;
  const bytes = JSON.stringify(sorted(body));
  // The cross-language v1 profile is ASCII only. No surrogate/escape ambiguity.
  require(/^[\x20-\x7e]*$/.test(bytes));
  return hash(bytes);
}
function protectedProfile(expected) {
  const p = expected.fullProfile;
  require(p && typeof p === 'object' && !Array.isArray(p));
  const names = ['schema', 'classification', 'controllerSha', 'candidate', 'session', 'authorityFingerprint', 'profileSha256', 'candidateUid', 'dockerBinary', 'endpoint', 'composePath', 'composeSha256', 'project', 'timeoutMs', 'cleanupExpiresAt', 'provider', 'services', 'payloads', 'validatedRelationships'];
  require(JSON.stringify(Object.keys(p).sort()) === JSON.stringify(names.sort()));
  require(p.schema === 'm1a-gateway-profile-v1' && p.classification === 'PRODUCTION');
  require(identities.every((name) => p[name] === expected[name]));
  require(gatewayProfileHash(p) === expected.profileSha256 && p.provider === null);
  require(Array.isArray(p.services) && p.services.length >= 1 && p.services.length <= 32);
  const images = p.services.map((service) => service.image);
  imageInventory(images, p.validatedRelationships);
  require(JSON.stringify(images) === JSON.stringify(expected.images));
  require(JSON.stringify(p.validatedRelationships) === JSON.stringify(expected.validatedRelationships ?? []));
  const path = (value) => typeof value === 'string' && /^\/(?!\/)/.test(value) && value !== '/' && !value.includes('\\') && !value.includes('\0') && !value.split('/').slice(1).some((part) => ['', '.', '..'].includes(part));
  require(path(p.dockerBinary) && path(p.composePath) && typeof p.endpoint === 'string' && p.endpoint.startsWith('unix://') && path(p.endpoint.slice(7)));
  require(identifier(p.project) && hex(p.composeSha256, 64) && epoch(p.candidateUid));
  require(epoch(p.timeoutMs) && p.timeoutMs >= 1 && p.timeoutMs <= 2147483647 && epoch(p.cleanupExpiresAt));
  const serviceNames = new Set(p.services.map((s) => s.name));
  require(serviceNames.size === p.services.length);
  const containers = new Set();
  for (const s of p.services) {
    require(JSON.stringify(Object.keys(s).sort()) === JSON.stringify(['name', 'dependencies', 'image', 'containers', 'mounts', 'devices', 'privileged', 'hostNamespaces', 'restartPolicy'].sort()));
    require(identifier(s.name) && s.name !== 'adapter-manager' && s.image.service === s.name);
    require(Array.isArray(s.dependencies) && s.dependencies.length <= 32 && new Set(s.dependencies).size === s.dependencies.length && s.dependencies.every((dep) => serviceNames.has(dep) && dep !== s.name));
    require(Array.isArray(s.containers) && s.containers.length >= 1 && s.containers.length <= 32);
    for (const cid of s.containers) { require(hex(cid, 64) && !containers.has(cid)); containers.add(cid); }
    require(Array.isArray(s.mounts) && s.mounts.length === 0 && Array.isArray(s.devices) && s.devices.length === 0 && s.privileged === false && s.hostNamespaces === false && s.restartPolicy === 'no');
  }
  require(containers.size <= 32);
  const byName = new Map(p.services.map((s) => [s.name, s]));
  const visited = new Set();
  const visit = (name, seen) => {
    require(!seen.has(name));
    if (visited.has(name)) return;
    for (const dep of byName.get(name).dependencies) visit(dep, new Set([...seen, name]));
    visited.add(name);
  };
  for (const name of serviceNames) visit(name, new Set());
  require(Array.isArray(p.payloads) && p.payloads.length <= 32);
  const payloads = new Set();
  for (const capability of p.payloads) {
    require(JSON.stringify(Object.keys(capability).sort()) === JSON.stringify(['id', 'service', 'argv', 'maxStdinBytes'].sort()));
    require(identifier(capability.id) && !payloads.has(capability.id) && serviceNames.has(capability.service)); payloads.add(capability.id);
    require(Array.isArray(capability.argv) && capability.argv.length >= 1 && capability.argv.length <= 32 && path(capability.argv[0]) && capability.argv.every((arg) => typeof arg === 'string' && arg.length <= 4096 && !arg.includes('\0')));
    require(epoch(capability.maxStdinBytes) && capability.maxStdinBytes <= 32768);
  }
}

// Inputs are controller-owned, independently protected configuration. No root loader,
// defaults or TEST capability promotion exists here. Epoch units are seconds.
export function verifyGatewayAuthority(input) {
  return verifyEnvelope(input, false);
}

// Separate controller-side entrypoint: it authorizes cleanup admission only.
// Dispatcher still restricts effects to durable, exact session-owned resources.
export function verifyGatewayCleanupAuthority(input) {
  return verifyEnvelope(input, true);
}

function verifyEnvelope(input, cleanup) {
  try {
    const { signedPolicyBytes, signatureBytes, trustedPublicKeyPem, expected, now, revocation } = input;
    require(signedPolicyBytes instanceof Uint8Array && signedPolicyBytes.byteLength > 0 && signedPolicyBytes.byteLength <= 1048576);
    require(signatureBytes instanceof Uint8Array && signatureBytes.byteLength === 64 && typeof trustedPublicKeyPem === 'string');
    const bytes = Buffer.from(signedPolicyBytes); const signature = Buffer.from(signatureBytes);
    const key = createPublicKey(trustedPublicKeyPem);
    require(key.asymmetricKeyType === 'ed25519');
    require(verify(null, bytes, key, signature));
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
    keys(value, fields);
    require(Buffer.from(JSON.stringify(value)).equals(bytes));
    require(value.schema === 'm1a-gateway-policy-v1' && value.classification === 'PRODUCTION');
    require(expected && identities.every((name) => value[name] === expected[name]));
    require(hex(value.controllerSha, 40) && hex(value.candidate, 40) && hex(value.profileSha256, 64));
    require(typeof value.session === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.session));
    const fingerprint = hash(key.export({ type: 'spki', format: 'der' }));
    require(value.authorityFingerprint === fingerprint);
    require(epoch(now) && epoch(value.notBefore) && epoch(value.expiresAt) && value.expiresAt > value.notBefore);
    require(now >= value.notBefore);
    require(revocation && revocation.available === true && epoch(revocation.checkedAt) && epoch(revocation.validUntil));
    require(revocation.checkedAt <= now && now < revocation.validUntil && Array.isArray(revocation.revoked));
    require(revocation.revoked.every((item) => hex(item, 64)) && !revocation.revoked.includes(fingerprint) && !revocation.revoked.includes(hash(bytes)));
    // Provider admission needs a separately approved pre-create contract.
    require(value.provider === null && expected.provider === null);
    protectedProfile(expected);
    require(now < (cleanup ? expected.fullProfile.cleanupExpiresAt : value.expiresAt));
    imageInventory(expected.images, expected.validatedRelationships);
    imageInventory(value.images, expected.validatedRelationships);
    require(JSON.stringify(value.images) === JSON.stringify(expected.images));
    return freeze({ policy: value, policySha256: hash(bytes), signatureSha256: hash(signature),
      verifiedAt: now, revocationCheckedAt: revocation.checkedAt, revocationValidUntil: revocation.validUntil });
  } catch {
    throw new GatewayAuthorityError();
  }
}

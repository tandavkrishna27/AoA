import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';

import * as module from '../m1a-gateway-authority.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const fingerprint = hash(publicKey.export({ type: 'spki', format: 'der' }));
const image = { service: 'worker', kind: 'docker-config-id', digest: `sha256:${'a'.repeat(64)}`, configId: `sha256:${'a'.repeat(64)}`, relationship: null };
const expected = { controllerSha: 'b'.repeat(40), candidate: 'c'.repeat(40), session: 'session1', profileSha256: 'd'.repeat(64), authorityFingerprint: fingerprint, images: [image], provider: null };
expected.fullProfile = { schema: 'm1a-gateway-profile-v1', classification: 'PRODUCTION', controllerSha: expected.controllerSha, candidate: expected.candidate, session: expected.session, authorityFingerprint: fingerprint, candidateUid: 1234, dockerBinary: '/protected/bin/docker', endpoint: 'unix:///protected/docker.sock', composePath: '/protected/compose.json', composeSha256: 'e'.repeat(64), project: 'campaign1', timeoutMs: 1000, cleanupExpiresAt: 300, provider: null, services: [{ name: 'worker', dependencies: [], image, containers: ['1'.repeat(64)], mounts: [], devices: [], privileged: false, hostNamespaces: false, restartPolicy: 'no' }], payloads: [{ id: 'probe', service: 'worker', argv: ['/usr/bin/node', '-'], maxStdinBytes: 32768 }], validatedRelationships: [] };
expected.profileSha256 = module.gatewayProfileHash(expected.fullProfile);
expected.fullProfile.profileSha256 = expected.profileSha256;
const policy = () => ({ schema: 'm1a-gateway-policy-v1', classification: 'PRODUCTION', controllerSha: expected.controllerSha, candidate: expected.candidate, session: expected.session, profileSha256: expected.profileSha256, authorityFingerprint: fingerprint, notBefore: 100, expiresAt: 200, images: [structuredClone(image)], provider: null });
function verify(value = policy(), overrides = {}, raw = Buffer.from(JSON.stringify(value))) {
  return module.verifyGatewayAuthority({ signedPolicyBytes: raw, signatureBytes: sign(null, raw, privateKey), trustedPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }), expected, now: 150, revocation: { available: true, checkedAt: 150, validUntil: 151, revoked: [] }, ...overrides });
}
test('verifier exists and returns deeply frozen own data with exact byte hashes', () => {
  assert.equal(typeof module.verifyGatewayAuthority, 'function');
  const value = policy(); const verdict = verify(value);
  assert.equal(verdict.policySha256, hash(Buffer.from(JSON.stringify(value))));
  assert.equal(verdict.policy.session, 'session1');
  assert(Object.isFrozen(verdict.policy.images[0]));
  assert(!('trustedPublicKeyPem' in verdict));
  assert.equal(verdict.verifiedAt, 150);
  assert.equal(verdict.revocationCheckedAt, 150);
  assert.equal(verdict.revocationValidUntil, 151);
});
test('signature authenticates exact bytes with independent Ed25519 root', () => {
  const wrong = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  for (const overrides of [{ trustedPublicKeyPem: wrong }, { signatureBytes: Buffer.alloc(64) }, { signedPolicyBytes: Buffer.alloc(1048577) }]) assert.throws(() => verify(policy(), overrides), /gateway-authority-refused/);
});
test('closed production envelope rejects TEST, candidate roots, wrong identities and inventories', () => {
  for (const patch of [{ schema: 'test' }, { classification: 'TEST' }, { publicKey: 'candidate root' }, { controllerSha: 'e'.repeat(40) }, { candidate: 'e'.repeat(40) }, { session: 'other' }, { profileSha256: 'e'.repeat(64) }, { authorityFingerprint: 'e'.repeat(64) }, { images: [] }, { provider: { kind: 'e2b' } }]) assert.throws(() => verify({ ...policy(), ...patch }), /gateway-authority-refused/);
});
test('fresh epoch time and fresh available revocation are mandatory', () => {
  for (const now of [99, 200, true, NaN, undefined]) assert.throws(() => verify(policy(), { now }), /gateway-authority-refused/);
  for (const revocation of [null, { available: false }, { available: true, checkedAt: 149, validUntil: 150, revoked: [] }, { available: true, checkedAt: 150, validUntil: 151, revoked: [fingerprint] }]) assert.throws(() => verify(policy(), { revocation }), /gateway-authority-refused/);
  for (const patch of [{ notBefore: true }, { expiresAt: 100 }]) assert.throws(() => verify({ ...policy(), ...patch }), /gateway-authority-refused/);
});
test('canonical schema ordering, duplicate keys and strict UTF8 are enforced after authentication', () => {
  const canonical = JSON.stringify(policy());
  for (const raw of [Buffer.from(` ${canonical}`), Buffer.from(canonical.replace('"session":"session1"', '"session":"other","session":"session1"')), Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(policy()).reverse()))), Buffer.from([0xff])]) assert.throws(() => verify(policy(), {}, raw), /gateway-authority-refused/);
});
test('OCI relationship must be independently validated against complete protected inventory', () => {
  const oci = { ...image, kind: 'oci-manifest', digest: `sha256:${'e'.repeat(64)}`, relationship: { manifestDigest: `sha256:${'e'.repeat(64)}`, configId: image.configId } };
  const value = { ...policy(), images: [oci] };
  assert.throws(() => verify(value, { expected: { ...expected, images: [oci] } }), /gateway-authority-refused/);
  const fullProfile = structuredClone(expected.fullProfile);
  fullProfile.services[0].image = oci;
  fullProfile.validatedRelationships = [oci.relationship];
  fullProfile.profileSha256 = module.gatewayProfileHash(fullProfile);
  const admitted = { ...expected, profileSha256: fullProfile.profileSha256, fullProfile, images: [oci], validatedRelationships: [oci.relationship] };
  value.profileSha256 = fullProfile.profileSha256;
  assert.equal(verify(value, { expected: admitted }).policy.images[0].kind, 'oci-manifest');
  assert.throws(() => verify({ ...value, images: [{ ...oci, configId: oci.digest }] }, { expected: admitted }), /gateway-authority-refused/);
});
test('independently protected full profile is required and hash-bound, never supplied by policy', () => {
  assert.throws(() => verify(policy(), { expected: { ...expected, fullProfile: undefined } }), /gateway-authority-refused/);
  const fullProfile = structuredClone(expected.fullProfile);
  fullProfile.endpoint = 'unix:///other.sock';
  assert.throws(() => verify(policy(), { expected: { ...expected, fullProfile } }), /gateway-authority-refused/);
});
test('cleanup verifier uses signed full-profile deadline with fresh revocation, not execution expiry', () => {
  assert.equal(typeof module.verifyGatewayCleanupAuthority, 'function');
  const signedPolicyBytes = Buffer.from(JSON.stringify(policy()));
  const input = { signedPolicyBytes, signatureBytes: sign(null, signedPolicyBytes, privateKey), trustedPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }), expected, now: 250, revocation: { available: true, checkedAt: 250, validUntil: 251, revoked: [] } };
  assert.throws(() => module.verifyGatewayAuthority(input), /gateway-authority-refused/);
  assert.equal(module.verifyGatewayCleanupAuthority(input).verifiedAt, 250);
  assert.throws(() => module.verifyGatewayCleanupAuthority({ ...input, now: 300, revocation: { ...input.revocation, checkedAt: 300, validUntil: 301 } }), /gateway-authority-refused/);
  assert.throws(() => module.verifyGatewayCleanupAuthority({ ...input, revocation: { ...input.revocation, revoked: [fingerprint] } }), /gateway-authority-refused/);
});
test('malformed verifier entrypoints return only typed fixed errors', () => {
  for (const value of [undefined, null, {}, { signedPolicyBytes: 'policy' }]) {
    for (const verify of [module.verifyGatewayAuthority, module.verifyGatewayCleanupAuthority]) assert.throws(() => verify(value), (error) => error instanceof module.GatewayAuthorityError && error.message === 'gateway-authority-refused');
  }
});

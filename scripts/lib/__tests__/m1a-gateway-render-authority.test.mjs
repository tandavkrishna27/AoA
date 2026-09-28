import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { renderProfileHash, verifyGatewayRenderAuthority } from '../m1a-gateway-render-authority.mjs';
import { verifyGatewayAuthority } from '../m1a-gateway-authority.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const fingerprint = hash(publicKey.export({ type: 'spki', format: 'der' }));
const services = ['adapter-manager', 'control-plane', 'control-plane-b',
  'm1-worker-a', 'm1-worker-b', 'm1-worker-c', 'migrate', 'minio', 'postgres',
  'worker-a1', 'worker-a2', 'worker-b1', 'worker-b2'];
function profile() {
  const value = { schema: 'm1a-gateway-render-profile-offline-v1', classification: 'OFFLINE_TEST_ONLY',
    controllerSha: 'a'.repeat(40), candidate: 'b'.repeat(40), session: 'session1',
    candidateUid: 102, authorityFingerprint: fingerprint, composeSha256: 'd'.repeat(64),
    inputIdentitySha256: 'e'.repeat(64),
    project: 'aoa-m1-boot', services: services.map((name) => ({ name,
      dependencies: name === 'control-plane' ? ['migrate'] : [] })) };
  value.profileSha256 = renderProfileHash(value);
  return value;
}
function policy(p) {
  return { schema: 'm1a-gateway-render-policy-offline-v1', classification: 'OFFLINE_TEST_ONLY',
    mode: 'render-only', controllerSha: p.controllerSha, candidate: p.candidate,
    session: p.session, profileSha256: p.profileSha256,
    authorityFingerprint: p.authorityFingerprint, notBefore: 100, expiresAt: 200 };
}
function verify(overrides = {}) {
  const p = profile();
  const bytes = Buffer.from(JSON.stringify(policy(p)));
  return verifyGatewayRenderAuthority({ signedPolicyBytes: bytes,
    signatureBytes: sign(null, bytes, privateKey),
    trustedPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    expected: { fullProfile: p, controllerSha: p.controllerSha, candidate: p.candidate,
      session: p.session, profileSha256: p.profileSha256,
      authorityFingerprint: p.authorityFingerprint, candidateUid: p.candidateUid,
      composeSha256: p.composeSha256, maxAgeSeconds: 30,
      inputIdentitySha256: p.inputIdentitySha256,
      installationId: 'install1', generation: 1, minimumRevocationSequence: 4 },
    now: 150, revocation: verifyRevocation(),
    ...overrides });
}
test('separate signed render-only policy admits an uncreated adapter-manager without execution images', () => {
  const verdict = verify();
  assert.equal(verdict.offlineOnly, true);
  assert.equal(verdict.policy.mode, 'render-only');
  assert.equal(verdict.policy.profileSha256, profile().profileSha256);
  assert(Object.isFrozen(verdict.policy));
});
test('render profile hash agrees with the Python fixture', () => {
  const p = profile();
  p.authorityFingerprint = 'c'.repeat(64);
  assert.equal(renderProfileHash(p), '031070302664aedf226a4c135827e92d5fc46b835dc114fb5af05cef750ed699');
});
test('wrong root, signature, revoked or stale authority refuse', () => {
  const wrong = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  for (const patch of [
    { trustedPublicKeyPem: wrong }, { signatureBytes: Buffer.alloc(64) },
    { now: 200 }, { now: 149, revocation: { ...verifyRevocation(), checkedAt: 100, validUntil: 200 } },
    { revocation: { ...verifyRevocation(), revoked: [fingerprint] } },
    { revocation: { ...verifyRevocation(), installationId: 'other' } },
    { revocation: { ...verifyRevocation(), generation: 2 } },
    { revocation: { ...verifyRevocation(), sequence: 3 } },
  ]) assert.throws(() => verify(patch), /gateway-render-authority-refused/);
});
test('profile changes, mode confusion and unreviewed fields refuse', () => {
  const p = profile(); p.services[1].dependencies = [];
  for (const patch of [
    { expected: { ...verifyExpected(), fullProfile: p } },
    { expected: { ...verifyExpected(), candidateUid: 999 } },
    { expected: { ...verifyExpected(), fullProfile: { ...profile(), extra: true } } },
  ]) assert.throws(() => verify(patch), /gateway-render-authority-refused/);
  const bytes = Buffer.from(JSON.stringify({ ...policy(profile()), mode: 'execution' }));
  assert.throws(() => verify({ signedPolicyBytes: bytes, signatureBytes: sign(null, bytes, privateKey) }), /gateway-render-authority-refused/);
  const production = Buffer.from(JSON.stringify({ ...policy(profile()), classification: 'PRODUCTION' }));
  assert.throws(() => verify({ signedPolicyBytes: production, signatureBytes: sign(null, production, privateKey) }), /gateway-render-authority-refused/);
  const offline = Buffer.from(JSON.stringify(policy(profile())));
  assert.throws(() => verifyGatewayAuthority({ signedPolicyBytes: offline,
    signatureBytes: sign(null, offline, privateKey),
    trustedPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    expected: verifyExpected(), now: 150, revocation: verifyRevocation() }),
  /gateway-authority-refused/);
});
test('signed noncanonical bytes and cyclic service graph refuse', () => {
  const value = policy(profile());
  const canonical = JSON.stringify(value);
  for (const raw of [Buffer.from(` ${canonical}`),
    Buffer.from(canonical.replace('"session":"session1"', '"session":"other","session":"session1"')),
    Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(value).reverse()))), Buffer.from([0xff])]) {
    assert.throws(() => verify({ signedPolicyBytes: raw, signatureBytes: sign(null, raw, privateKey) }), /gateway-render-authority-refused/);
  }
  const cyclic = profile();
  cyclic.services[6].dependencies = ['control-plane'];
  cyclic.profileSha256 = renderProfileHash(cyclic);
  assert.throws(() => verify({ expected: { ...verifyExpected(), fullProfile: cyclic,
    profileSha256: cyclic.profileSha256 } }), /gateway-render-authority-refused/);
});
function verifyExpected() {
  const p = profile();
  return { fullProfile: p, controllerSha: p.controllerSha, candidate: p.candidate,
    session: p.session, profileSha256: p.profileSha256,
    authorityFingerprint: p.authorityFingerprint, candidateUid: p.candidateUid,
    composeSha256: p.composeSha256, maxAgeSeconds: 30,
    inputIdentitySha256: p.inputIdentitySha256,
    installationId: 'install1', generation: 1, minimumRevocationSequence: 4 };
}
function verifyRevocation() {
  return { schema: 'm1a-gateway-revocation-v1', installationId: 'install1',
    generation: 1, sequence: 4, available: true, checkedAt: 150, validUntil: 151, revoked: [] };
}

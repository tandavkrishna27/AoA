import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { renderProfileHash } from '../m1a-gateway-render-authority.mjs';

const bridge = fileURLToPath(new URL('../m1a-gateway-render-authority-bridge.mjs', import.meta.url));
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const fingerprint = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
function fixture() {
  const p = { schema: 'm1a-gateway-render-profile-offline-v1', classification: 'OFFLINE_TEST_ONLY',
    controllerSha: 'a'.repeat(40), candidate: 'b'.repeat(40), session: 'session1',
    candidateUid: 102, authorityFingerprint: fingerprint, composeSha256: 'd'.repeat(64),
    inputIdentitySha256: 'e'.repeat(64),
    project: 'aoa-m1-boot', services: [{ name: 'adapter-manager', dependencies: [] }] };
  p.profileSha256 = renderProfileHash(p);
  const policy = { schema: 'm1a-gateway-render-policy-offline-v1', classification: 'OFFLINE_TEST_ONLY',
    mode: 'render-only', controllerSha: p.controllerSha, candidate: p.candidate,
    session: p.session, profileSha256: p.profileSha256,
    authorityFingerprint: fingerprint, notBefore: 100, expiresAt: 200 };
  const bytes = Buffer.from(JSON.stringify(policy));
  return { schema: 'm1a-gateway-render-bridge-v1', now: 150,
    policyBase64: bytes.toString('base64'),
    signatureBase64: sign(null, bytes, privateKey).toString('base64'),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    expected: { fullProfile: p, controllerSha: p.controllerSha, candidate: p.candidate,
      session: p.session, profileSha256: p.profileSha256,
      authorityFingerprint: fingerprint, candidateUid: 102,
      composeSha256: p.composeSha256, maxAgeSeconds: 30,
      inputIdentitySha256: p.inputIdentitySha256,
      installationId: 'install1', generation: 1, minimumRevocationSequence: 4 },
    revocation: { schema: 'm1a-gateway-revocation-v1', installationId: 'install1',
      generation: 1, sequence: 4, available: true, checkedAt: 150, validUntil: 151, revoked: [] } };
}
function run(value) {
  return spawnSync(process.execPath, [bridge], { input: typeof value === 'string' ? value : JSON.stringify(value),
    encoding: 'utf8', env: {}, maxBuffer: 3 * 1048576 });
}
test('fixed bridge verifies ephemeral render policy and returns closed metadata', () => {
  const child = run(fixture());
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  const verdict = JSON.parse(child.stdout);
  assert.equal(verdict.offlineOnly, true);
  assert.equal(verdict.policy.mode, 'render-only');
  assert(!('fullProfile' in verdict));
});
test('bridge refuses malformed envelope, stale revocation and secret canary without echo', () => {
  const invalid = fixture(); invalid.revocation.available = false;
  const canary = fixture(); canary.extra = 'PRIVATE_CANARY';
  for (const input of ['{}', '{"schema":1,"schema":1}', invalid, canary]) {
    const child = run(input);
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.equal(child.stderr, 'gateway-render-authority-refused\n');
  }
});

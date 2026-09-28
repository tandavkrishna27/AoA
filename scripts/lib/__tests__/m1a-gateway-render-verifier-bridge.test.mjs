import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseYaml } from '../yaml-lite.mjs';
import { mergeComposeModel, DISTRIBUTED_EXECUTION_ROLLOUT_ENV } from '../staging-manifest-invariants.mjs';
import { renderProfileHash } from '../m1a-gateway-render-authority.mjs';

const bridge = fileURLToPath(new URL('../m1a-gateway-render-verifier-bridge.mjs', import.meta.url));
const root = path.resolve(path.dirname(bridge), '../..');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fingerprint = hash(publicKey.export({ type: 'spki', format: 'der' }));
function fixture() {
  const base = parseYaml(readFileSync(path.join(root, 'docker-compose.staging.yml'), 'utf8'));
  const overlay = parseYaml(readFileSync(path.join(root, 'docker/m1-boot/docker-compose.m1-boot.yml'), 'utf8'));
  const render = mergeComposeModel(base, overlay);
  for (const service of Object.values(render.services)) {
    if (typeof service.image === 'string' && service.image.includes('WORKER_IMAGE'))
      service.image = 'localhost/aoa/worker:0123abc';
  }
  for (const name of ['control-plane', 'control-plane-b'])
    render.services[name].environment[DISTRIBUTED_EXECUTION_ROLLOUT_ENV] = '{"organizations":{}}';
  render.services['adapter-manager'].environment.E2B_API_KEY = 'SECRET_CANARY';
  const profile = { schema: 'm1a-gateway-render-profile-offline-v1', classification: 'OFFLINE_TEST_ONLY',
    controllerSha: 'a'.repeat(40), candidate: 'b'.repeat(40), session: 'session1', candidateUid: 102,
    authorityFingerprint: fingerprint, composeSha256: 'c'.repeat(64), inputIdentitySha256: 'd'.repeat(64),
    project: 'aoa-m1-boot',
    services: Object.keys(render.services).sort().map((name) => ({ name,
      dependencies: Object.keys(render.services[name].depends_on ?? {}).sort() })) };
  profile.profileSha256 = renderProfileHash(profile);
  const raw = Buffer.from(JSON.stringify(render));
  const policy = { schema: 'm1a-gateway-render-policy-offline-v1', classification: 'OFFLINE_TEST_ONLY',
    mode: 'render-only', controllerSha: profile.controllerSha, candidate: profile.candidate,
    session: profile.session, profileSha256: profile.profileSha256,
    authorityFingerprint: fingerprint, notBefore: 100, expiresAt: 200 };
  const policyBytes = Buffer.from(JSON.stringify(policy));
  const authority = { schema: 'm1a-gateway-render-bridge-v1', now: 150,
    policyBase64: policyBytes.toString('base64'),
    signatureBase64: sign(null, policyBytes, privateKey).toString('base64'),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    expected: { fullProfile: profile, controllerSha: profile.controllerSha, candidate: profile.candidate,
      session: profile.session, profileSha256: profile.profileSha256,
      authorityFingerprint: fingerprint, candidateUid: profile.candidateUid,
      composeSha256: profile.composeSha256, inputIdentitySha256: profile.inputIdentitySha256,
      maxAgeSeconds: 30, installationId: 'install1', generation: 1, minimumRevocationSequence: 4 },
    revocation: { schema: 'm1a-gateway-revocation-v1', installationId: 'install1', generation: 1,
      sequence: 4, available: true, checkedAt: 150, validUntil: 151, revoked: [] } };
  return { schema: 'm1a-gateway-render-verifier-bridge-offline-v1', rawBase64: raw.toString('base64'),
    rawSha256: hash(raw), authority };
}
function run(value) {
  return spawnSync(process.execPath, [bridge], { input: typeof value === 'string' ? value : JSON.stringify(value),
    encoding: 'utf8', env: {}, maxBuffer: 2097152 });
}

test('fixed bridge returns closed offline metadata, never raw render or private values', () => {
  const child = run(fixture());
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  const verdict = JSON.parse(child.stdout);
  assert.equal(verdict.offlineOnly, true);
  assert.equal(verdict.code, 'OFFLINE_RENDER_CHECK_PASS');
  assert.equal(verdict.scopedPass, true);
  assert.equal(verdict.dispatchDefaultRed, true);
  assert.equal(JSON.stringify(verdict).includes('SECRET_CANARY'), false);
  assert.equal(Object.hasOwn(verdict, 'rawBase64'), false);
});

test('bridge refuses changed digest, malformed envelope and extra fields without echo', () => {
  const changed = fixture(); changed.rawSha256 = 'f'.repeat(64);
  const extra = fixture(); extra.private = 'SECRET_CANARY';
  const invalid = fixture(); invalid.rawBase64 = '@@@';
  const unsigned = fixture(); unsigned.authority.signatureBase64 = Buffer.alloc(64).toString('base64');
  const selfProfile = fixture(); selfProfile.authority.expected.fullProfile.services.pop();
  for (const input of [changed, extra, invalid, unsigned, selfProfile, '{"schema":1,"schema":1}']) {
    const child = run(input);
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.equal(child.stderr, 'gateway-render-verifier-refused\n');
  }
});

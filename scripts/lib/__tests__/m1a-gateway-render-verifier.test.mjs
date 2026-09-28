import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseYaml } from '../yaml-lite.mjs';
import { mergeComposeModel, DISTRIBUTED_EXECUTION_ROLLOUT_ENV,
  SHIPPED_BOOT_OVERLAY_WORKERS, SHIPPED_BOOT_ADMITTED_DISPATCH_ENV } from '../staging-manifest-invariants.mjs';
import { evaluateGatewayRender, GatewayRenderVerifierError } from '../m1a-gateway-render-verifier.mjs';
import { renderProfileHash } from '../m1a-gateway-render-authority.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
function fixture() {
  const base = parseYaml(readFileSync(path.join(root, 'docker-compose.staging.yml'), 'utf8'));
  const overlay = parseYaml(readFileSync(path.join(root, 'docker/m1-boot/docker-compose.m1-boot.yml'), 'utf8'));
  const rendered = mergeComposeModel(base, overlay);
  for (const service of Object.values(rendered.services)) {
    if (typeof service.image === 'string' && service.image.includes('WORKER_IMAGE'))
      service.image = 'localhost/aoa/worker:0123abc';
  }
  for (const name of ['control-plane', 'control-plane-b'])
    rendered.services[name].environment[DISTRIBUTED_EXECUTION_ROLLOUT_ENV] = '{"organizations":{}}';
  rendered.services['adapter-manager'].environment.E2B_API_KEY = '';
  const profile = { schema: 'm1a-gateway-render-profile-offline-v1', classification: 'OFFLINE_TEST_ONLY',
    services: Object.keys(rendered.services).sort().map((name) => ({ name,
      dependencies: Object.keys(rendered.services[name].depends_on ?? {}).sort() })) };
  profile.profileSha256 = renderProfileHash(profile);
  return { rendered, profile };
}
const bytes = (rendered) => Buffer.from(JSON.stringify(rendered));
const refuses = (raw, profile) => assert.throws(() => evaluateGatewayRender(raw, profile), GatewayRenderVerifierError);

test('one exact synthetic source merge passes scoped DEP-015 and reds the unscoped dispatch control', () => {
  const { rendered, profile } = fixture();
  const raw = bytes(rendered);
  const verdict = evaluateGatewayRender(raw, profile);
  assert.equal(verdict.offlineOnly, true);
  assert.equal(verdict.code, 'OFFLINE_RENDER_CHECK_PASS');
  assert.equal(verdict.scopedPass, true);
  assert.equal(verdict.dispatchDefaultRed, true);
  assert.equal(verdict.services.length, profile.services.length);
  assert.notEqual(evaluateGatewayRender(Buffer.concat([raw, Buffer.from(' ')]), profile).renderSha256, verdict.renderSha256);
});

test('membership, malformed input and production classification refuse closed', () => {
  const { rendered, profile } = fixture();
  const missing = structuredClone(rendered);
  delete missing.services.minio;
  refuses(bytes(missing), profile);
  refuses(Buffer.from('{"services":{},"services":{}}'), profile);
  const hiddenExtra = Buffer.from(JSON.stringify(rendered).replace('"services":{', '"services":{"__proto__":{},'));
  refuses(hiddenExtra, profile);
  refuses(Buffer.from('{"services":{"x":{"value":1e999}}}'), profile);
  refuses(Buffer.from([0xff]), profile);
  refuses(bytes(rendered), { ...profile, classification: 'PRODUCTION' });
  refuses(bytes(rendered), { ...profile, profileSha256: 'a'.repeat(64) });
  const changedEdge = structuredClone(rendered);
  changedEdge.services['control-plane'].depends_on = {};
  refuses(bytes(changedEdge), profile);
});

test('scoped violation is a stable code without private bytes or validator prose', () => {
  const { rendered, profile } = fixture();
  rendered.services['control-plane'].environment.AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED = 'secret-canary';
  const verdict = evaluateGatewayRender(bytes(rendered), profile);
  assert.equal(verdict.code, 'OFFLINE_RENDER_SCOPED_RED');
  assert.equal(verdict.scopedPass, false);
  assert.equal(JSON.stringify(verdict).includes('secret-canary'), false);
  assert.equal(Object.hasOwn(verdict, 'violations'), false);
});

test('an unrelated unscoped red never substitutes for the dispatch-default positive control', () => {
  const { rendered, profile } = fixture();
  for (const name of SHIPPED_BOOT_OVERLAY_WORKERS) {
    for (const key of Object.keys(SHIPPED_BOOT_ADMITTED_DISPATCH_ENV))
      delete rendered.services[name].environment[key];
  }
  rendered.services['control-plane'].environment.AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED = 'true';
  const verdict = evaluateGatewayRender(bytes(rendered), profile);
  assert.equal(verdict.scopedPass, false);
  assert.equal(verdict.dispatchDefaultRed, false);
  assert.equal(verdict.dispatchDefaultCount, 0);
  assert.notEqual(verdict.code, 'OFFLINE_RENDER_CHECK_PASS');
});

test('provider-control placement and wrong dispatch flags cannot pass scoped admission', () => {
  const { rendered, profile } = fixture();
  rendered.services['m1-worker-a'].environment.E2B_API_KEY = 'secret-canary';
  const provider = evaluateGatewayRender(bytes(rendered), profile);
  assert.equal(provider.scopedPass, false);
  assert.equal(JSON.stringify(provider).includes('secret-canary'), false);
  delete rendered.services['m1-worker-a'].environment.E2B_API_KEY;
  rendered.services['m1-worker-a'].environment.AOA_WORKER_DISPATCH_ENABLED = 'true';
  assert.equal(evaluateGatewayRender(bytes(rendered), profile).scopedPass, false);
});

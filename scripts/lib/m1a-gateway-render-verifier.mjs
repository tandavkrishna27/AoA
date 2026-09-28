import { createHash } from 'node:crypto';

import { parseJsonStrict } from '../check-distributed-execution-foundation.mjs';
import { renderProfileHash } from './m1a-gateway-render-authority.mjs';
import {
  evaluateShippedBootOverlayInvariants,
  evaluateStagingManifestInvariants,
  SHIPPED_BOOT_OVERLAY_PATH,
} from './staging-manifest-invariants.mjs';

export class GatewayRenderVerifierError extends Error {
  constructor() { super('gateway-render-verifier-refused'); this.name = 'GatewayRenderVerifierError'; }
}

const refuse = () => { throw new GatewayRenderVerifierError(); };
const validName = (name) => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name);
function finiteTree(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteTree);
  if (value && typeof value === 'object') return Object.values(value).every(finiteTree);
  return true;
}

export function evaluateGatewayRender(rawBytes, expectedProfile) {
  try {
    if (!(rawBytes instanceof Uint8Array) || rawBytes.byteLength === 0 || rawBytes.byteLength > 1048576) refuse();
    if (expectedProfile?.schema !== 'm1a-gateway-render-profile-offline-v1'
      || expectedProfile.classification !== 'OFFLINE_TEST_ONLY'
      || !/^[0-9a-f]{64}$/.test(expectedProfile.profileSha256)
      || !Array.isArray(expectedProfile.services)) refuse();
    if (renderProfileHash(expectedProfile) !== expectedProfile.profileSha256) refuse();
    const raw = Buffer.from(rawBytes);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    parseJsonStrict(text);
    // JSON.parse retains own '__proto__' keys; the strict parser's object assignment does not.
    const rendered = JSON.parse(text);
    if (!finiteTree(rendered)) refuse();
    if (!rendered || typeof rendered !== 'object' || Array.isArray(rendered)
      || !rendered.services || typeof rendered.services !== 'object' || Array.isArray(rendered.services)) refuse();
    const names = Object.keys(rendered.services).sort();
    const protectedNames = expectedProfile.services.map((service) => service?.name);
    if (names.length === 0 || names.length > 32 || !names.every(validName)
      || JSON.stringify(names) !== JSON.stringify(protectedNames)) refuse();
    for (const protectedService of expectedProfile.services) {
      const dependencies = protectedService?.dependencies;
      if (!Array.isArray(dependencies) || dependencies.some((name) => !validName(name))
        || JSON.stringify(dependencies) !== JSON.stringify([...new Set(dependencies)].sort())) refuse();
      const actual = rendered.services[protectedService.name]?.depends_on;
      const actualDependencies = actual === undefined ? [] : Array.isArray(actual) ? actual :
        actual && typeof actual === 'object' ? Object.keys(actual) : null;
      if (!actualDependencies || JSON.stringify(actualDependencies.sort()) !== JSON.stringify(dependencies)) refuse();
    }
    const scoped = evaluateShippedBootOverlayInvariants(rendered, null, {
      overlayPath: SHIPPED_BOOT_OVERLAY_PATH, rendered: true,
    }).violations;
    const unscopedDispatch = evaluateStagingManifestInvariants(rendered).violations
      .filter((violation) => /DISPATCH-DEFAULT/.test(violation));
    const digest = createHash('sha256').update(raw).digest('hex');
    const scopedPass = scoped.length === 0;
    const dispatchDefaultRed = unscopedDispatch.length > 0;
    return Object.freeze({
      schema: 'm1a-gateway-render-verdict-offline-v1', offlineOnly: true,
      renderSha256: digest, profileSha256: expectedProfile.profileSha256,
      services: Object.freeze(names), scopedPass, dispatchDefaultRed,
      scopedCount: Math.min(scoped.length, 255),
      dispatchDefaultCount: Math.min(unscopedDispatch.length, 255),
      code: scopedPass && dispatchDefaultRed ? 'OFFLINE_RENDER_CHECK_PASS' :
        !scopedPass ? 'OFFLINE_RENDER_SCOPED_RED' : 'OFFLINE_RENDER_CONTROL_MISSING',
    });
  } catch {
    refuse();
  }
}

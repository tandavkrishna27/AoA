import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { parseJsonStrict } from '../check-distributed-execution-foundation.mjs';
import { evaluateGatewayRender } from './m1a-gateway-render-verifier.mjs';
import { decodeRenderBridgeInput } from './m1a-gateway-render-authority-bridge.mjs';
import { verifyGatewayRenderAuthority } from './m1a-gateway-render-authority.mjs';

const refuse = () => { throw new Error('gateway-render-verifier-refused'); };

export function decodeRenderVerifierInput(raw) {
  try {
    if (!Buffer.isBuffer(raw) || raw.length === 0 || raw.length > 2097152) refuse();
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    parseJsonStrict(text);
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join() !== ['schema', 'rawBase64', 'rawSha256', 'authority'].sort().join()
      || value.schema !== 'm1a-gateway-render-verifier-bridge-offline-v1'
      || !/^[0-9a-f]{64}$/.test(value.rawSha256)
      || typeof value.rawBase64 !== 'string' || value.rawBase64.length > 1398104) refuse();
    const bytes = Buffer.from(value.rawBase64, 'base64');
    if (bytes.length === 0 || bytes.length > 1048576 || bytes.toString('base64') !== value.rawBase64
      || createHash('sha256').update(bytes).digest('hex') !== value.rawSha256) refuse();
    const authority = decodeRenderBridgeInput(Buffer.from(JSON.stringify(value.authority)));
    const verified = verifyGatewayRenderAuthority(authority);
    if (verified.offlineOnly !== true || verified.policy.profileSha256 !== authority.expected.fullProfile.profileSha256) refuse();
    return { bytes, profile: authority.expected.fullProfile };
  } catch { refuse(); }
}

export async function bridgeMain() {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 2097152) refuse();
      chunks.push(chunk);
    }
    const { bytes, profile } = decodeRenderVerifierInput(Buffer.concat(chunks));
    const verdict = evaluateGatewayRender(bytes, profile);
    process.stdout.write(JSON.stringify(verdict));
  } catch {
    process.stderr.write('gateway-render-verifier-refused\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await bridgeMain();

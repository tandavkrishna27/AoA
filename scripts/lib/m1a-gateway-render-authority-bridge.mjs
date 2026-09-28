import { pathToFileURL } from 'node:url';
import { verifyGatewayRenderAuthority } from './m1a-gateway-render-authority.mjs';

const refused = () => { throw new Error('gateway-render-authority-refused'); };
function decodeBase64(value, maximum) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4) refused();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maximum || bytes.toString('base64') !== value) refused();
  return bytes;
}
export function decodeRenderBridgeInput(raw) {
  try {
    if (!Buffer.isBuffer(raw) || !raw.length || raw.length > 2097152) refused();
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw));
    const fields = ['schema', 'now', 'policyBase64', 'signatureBase64', 'publicKeyPem', 'expected', 'revocation'];
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join() !== fields.sort().join()
        || !Buffer.from(JSON.stringify(value)).equals(raw)
        || value.schema !== 'm1a-gateway-render-bridge-v1'
        || !Number.isSafeInteger(value.now) || value.now < 0
        || typeof value.publicKeyPem !== 'string' || value.publicKeyPem.length > 16384) refused();
    return { signedPolicyBytes: decodeBase64(value.policyBase64, 1048576),
      signatureBytes: decodeBase64(value.signatureBase64, 64),
      trustedPublicKeyPem: value.publicKeyPem, expected: value.expected,
      now: value.now, revocation: value.revocation };
  } catch { refused(); }
}

export async function bridgeMain() {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 2097152) refused();
      chunks.push(chunk);
    }
    const verdict = verifyGatewayRenderAuthority(decodeRenderBridgeInput(Buffer.concat(chunks)));
    const output = Buffer.from(JSON.stringify(verdict));
    if (output.length > 1114112) refused();
    process.stdout.write(output);
  } catch {
    process.stderr.write('gateway-render-authority-refused\n');
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await bridgeMain();

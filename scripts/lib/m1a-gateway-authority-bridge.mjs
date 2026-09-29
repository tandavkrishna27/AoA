import { pathToFileURL } from 'node:url';
import { verifyGatewayAuthority, verifyGatewayCleanupAuthority } from './m1a-gateway-authority.mjs';

const refused = () => { throw new Error('gateway-authority-refused'); };
export function decodeBridgeInput(raw) {
  try {
    if (!Buffer.isBuffer(raw) || !raw.length || raw.length > 2097152) refused();
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw));
    const fields = ['schema', 'cleanup', 'now', 'policyBase64', 'signatureBase64', 'publicKeyPem', 'expected', 'revocation'];
    if (!value || Object.keys(value).sort().join() !== fields.sort().join() ||
        !Buffer.from(JSON.stringify(value)).equals(raw) || value.schema !== 'm1a-gateway-bridge-v1' ||
        typeof value.cleanup !== 'boolean' || !Number.isSafeInteger(value.now) || value.now < 0 ||
        typeof value.publicKeyPem !== 'string' || value.publicKeyPem.length > 16384) refused();
    const decode = (s, maximum) => {
      if (typeof s !== 'string' || s.length > Math.ceil(maximum / 3) * 4) refused();
      const bytes = Buffer.from(s, 'base64');
      if (bytes.length > maximum || bytes.toString('base64') !== s) refused();
      return bytes;
    };
    return { cleanup: value.cleanup, input: { signedPolicyBytes: decode(value.policyBase64, 1048576),
      signatureBytes: decode(value.signatureBase64, 64), trustedPublicKeyPem: value.publicKeyPem,
      expected: value.expected, now: value.now, revocation: value.revocation } };
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
    const { cleanup, input } = decodeBridgeInput(Buffer.concat(chunks));
    const verdict = (cleanup ? verifyGatewayCleanupAuthority : verifyGatewayAuthority)(input);
    const result = Buffer.from(JSON.stringify(verdict));
    if (result.length > 1114112) refused();
    process.stdout.write(result);
  } catch {
    process.stderr.write('gateway-authority-refused\n');
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await bridgeMain();

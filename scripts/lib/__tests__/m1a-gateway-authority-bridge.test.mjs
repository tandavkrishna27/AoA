import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { gatewayProfileHash } from '../m1a-gateway-authority.mjs';

const bridge = fileURLToPath(new URL('../m1a-gateway-authority-bridge.mjs', import.meta.url));
test('bridge refuses malformed input privately with a fixed code', () => {
  for (const input of ['{}', '{"schema":1,"schema":1}', 'x'.repeat(2097153)]) {
    const child = spawnSync(process.execPath, [bridge], { input, encoding: 'utf8', env: {}, maxBuffer: 3*1048576 });
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.equal(child.stderr, 'gateway-authority-refused\n');
  }
});
test('bridge exports a closed pure codec with no policy-selected roots', async () => {
  const { decodeBridgeInput } = await import('../m1a-gateway-authority-bridge.mjs');
  assert.throws(() => decodeBridgeInput(Buffer.from('{}')), /gateway-authority-refused/);
  assert.throws(() => decodeBridgeInput(Buffer.from('{"x":1,"x":2}')), /gateway-authority-refused/);
});

test('real bridge verifies ephemeral exact bytes and refuses fresh revocation loss', () => {
  const {publicKey,privateKey} = generateKeyPairSync('ed25519');
  const fingerprint = createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
  const image = {service:'worker',kind:'docker-config-id',digest:`sha256:${'a'.repeat(64)}`,configId:`sha256:${'a'.repeat(64)}`,relationship:null};
  const p = {schema:'m1a-gateway-profile-v1',classification:'PRODUCTION',controllerSha:'b'.repeat(40),candidate:'c'.repeat(40),
    session:'session1',authorityFingerprint:fingerprint,candidateUid:1234,dockerBinary:'/protected/docker',endpoint:'unix:///protected/daemon',
    composePath:'/protected/compose',composeSha256:'e'.repeat(64),project:'campaign1',timeoutMs:1000,cleanupExpiresAt:300,provider:null,
    services:[{name:'worker',dependencies:[],image,containers:['1'.repeat(64)],mounts:[],devices:[],privileged:false,hostNamespaces:false,restartPolicy:'no'}],
    payloads:[],validatedRelationships:[]};
  p.profileSha256 = gatewayProfileHash(p);
  const policy = {schema:'m1a-gateway-policy-v1',classification:'PRODUCTION',controllerSha:p.controllerSha,candidate:p.candidate,
    session:p.session,profileSha256:p.profileSha256,authorityFingerprint:fingerprint,notBefore:100,expiresAt:200,images:[image],provider:null};
  const bytes = Buffer.from(JSON.stringify(policy));
  const expected = {controllerSha:p.controllerSha,candidate:p.candidate,session:p.session,profileSha256:p.profileSha256,
    authorityFingerprint:fingerprint,images:[image],provider:null,fullProfile:p,validatedRelationships:[]};
  const input = {schema:'m1a-gateway-bridge-v1',cleanup:false,now:150,policyBase64:bytes.toString('base64'),
    signatureBase64:sign(null,bytes,privateKey).toString('base64'),publicKeyPem:publicKey.export({type:'spki',format:'pem'}),expected,
    revocation:{available:true,checkedAt:150,validUntil:151,revoked:[]}};
  const child = spawnSync(process.execPath,[bridge],{input:JSON.stringify(input),encoding:'utf8',env:{}});
  assert.equal(child.status,0); assert.equal(child.stderr,'');
  assert.equal(JSON.parse(child.stdout).verifiedAt,150);
  input.revocation.available = false;
  const denied = spawnSync(process.execPath,[bridge],{input:JSON.stringify(input),encoding:'utf8',env:{}});
  assert.equal(denied.status,1);assert.equal(denied.stdout,'');assert.equal(denied.stderr,'gateway-authority-refused\n');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readdir, readFile, writeFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createS3ArchiveStore, createProductionS3ArchiveStore } from './s3-store.mjs';

const account = '010438509726';
const bucket = 'aoa-platform-evidence-010438509726-us-east-1-an';
const bytes = Buffer.from('synthetic archive');
const checksum = createHash('sha256').update(bytes).digest('base64');
const key = `replatform/m1a/e3/123-r1/a1/${createHash('sha256').update(bytes).digest('hex')}.json`;
const ref = { key, versionId: 'version-1' };
const metadata = { VersionId: 'version-1', ChecksumSHA256: checksum, ContentLength: bytes.length,
  ServerSideEncryption: 'AES256', LastModified: '2026-09-27T00:00:00Z' };
const privateWindowsFacts = () => ({ sid: 'S-1-5-21-123', owner: 'S-1-5-21-123', protected: true,
  rules: [{ sid: 'S-1-5-21-123', allow: true, rights: 2032127 }], syncRoots: [] });

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'm1a-synthetic-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (process.platform !== 'win32') await chmod(root, 0o700);
  const privacy = process.platform === 'win32' ? { inspectWindowsPrivacy: async () => privateWindowsFacts() } : {};
  const calls = [];
  const runAws = async (args) => {
    calls.push(args);
    const op = args[1];
    if (overrides[op]) return overrides[op](args);
    let value = metadata;
    if (op === 'get-caller-identity') value = { Account: account, Arn: `arn:aws:iam::${account}:user/aoa-s3-artifacts` };
    if (op === 'get-bucket-versioning') value = { Status: 'Enabled' };
    if (op === 'get-bucket-encryption') value = { ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] } };
    if (op === 'get-object-lock-configuration') value = { ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 180 } } } };
    if (op === 'get-object-retention') value = { Retention: { Mode: 'COMPLIANCE', RetainUntilDate: '2027-03-26T00:00:00Z' } };
    if (op === 'get-object') await writeFile(args.at(-1), bytes);
    return { code: 0, stdout: JSON.stringify(value), stderr: '' };
  };
  return { root, calls, runAws, privacy, store: createS3ArchiveStore({ mode: 'upload', privateScratch: root, runAws, ...privacy }) };
}

test('pins_account_region_bucket_prefix', async (t) => {
  const { store, calls } = await fixture(t);
  assert.equal((await store.identify()).account, account);
  await store.inspectConfiguration(); await store.head(ref); await store.get(ref); await store.retention(ref);
  for (const args of calls) {
    assert.equal(args[args.indexOf('--region') + 1], 'us-east-1');
    if (args[0] === 's3api') {
      assert.equal(args[args.indexOf('--bucket') + 1], bucket);
      assert.equal(args[args.indexOf('--expected-bucket-owner') + 1], account);
    }
  }
  await assert.rejects(store.head({ ...ref, key: 'elsewhere/x' }), { code: 'INVALID_INPUT' });
});

test('rejects_transport_overrides', async (t) => {
  const { root, runAws } = await fixture(t);
  for (const option of ['endpoint', 'bucket', 'region', 'profile', 'executable', 'env']) {
    assert.throws(() => createS3ArchiveStore({ mode: 'verify', privateScratch: root, runAws, [option]: 'unsafe' }), { code: 'INVALID_INPUT' });
    assert.throws(() => createProductionS3ArchiveStore({ mode: 'verify', privateScratch: root, [option]: 'unsafe' }), { code: 'INVALID_INPUT' });
  }
});

test('only_approved_operations', async (t) => {
  const { store, calls } = await fixture(t);
  await store.identify(); await store.inspectConfiguration(); await store.put({ key, bytes, checksumSha256: checksum });
  await store.head(ref); await store.get(ref); await store.retention(ref);
  assert.deepEqual(calls.map(a => a[1]), ['get-caller-identity', 'get-bucket-versioning', 'get-bucket-encryption',
    'get-object-lock-configuration', 'put-object', 'head-object', 'get-object', 'get-object-retention']);
  assert.equal(store.delete, undefined);
  for (const args of calls.filter(a => ['head-object', 'get-object'].includes(a[1]))) {
    assert.equal(args[args.indexOf('--version-id') + 1], 'version-1');
    assert.equal(args[args.indexOf('--checksum-mode') + 1], 'ENABLED');
  }
});

test('inherits_default_retention', async (t) => {
  const { store, calls } = await fixture(t);
  const configuration = await store.inspectConfiguration();
  assert.equal(configuration.objectLock.Rule.DefaultRetention.Days, 180);
  await store.put({ key, bytes, checksumSha256: checksum });
  assert.equal(calls.at(-1).some(a => /object-lock|retention|legal-hold/.test(a)), false);
  assert.deepEqual(await store.retention(ref), { mode: 'COMPLIANCE', retainUntil: '2027-03-26T00:00:00.000Z' });
});

test('conditional_checksum_upload', async (t) => {
  let uploaded;
  const { store, calls, root } = await fixture(t, { 'put-object': async (args) => {
    uploaded = await readFile(args[args.indexOf('--body') + 1]);
    return { code: 0, stdout: JSON.stringify(metadata), stderr: '' };
  } });
  assert.deepEqual(await store.put({ key, bytes, checksumSha256: checksum }), { versionId: 'version-1', checksumSha256: checksum });
  assert.deepEqual(uploaded, bytes);
  const args = calls.at(-1);
  for (const [flag, value] of [['--if-none-match', '*'], ['--checksum-sha256', checksum], ['--server-side-encryption', 'AES256']]) {
    assert.equal(args[args.indexOf(flag) + 1], value);
  }
  assert.deepEqual(await readdir(root), []);
  await assert.rejects(store.put({ key, bytes, checksumSha256: Buffer.alloc(32).toString('base64') }), { code: 'INVALID_INPUT' });
});

test('read_only_has_no_put', async (t) => {
  const { root, runAws, privacy } = await fixture(t);
  const store = createS3ArchiveStore({ mode: 'verify', privateScratch: root, runAws, ...privacy });
  assert.equal('put' in store, false);
  assert.deepEqual(await store.get(ref), { versionId: 'version-1', bytes, checksumSha256: checksum, encryption: 'AES256' });
});

test('uncertain_upload_is_not_retried', async (t) => {
  for (const response of [{ code: 409 }, { code: 412 }, { code: 1 }, { code: 0, stdout: '{}' },
    { code: 0, stdout: JSON.stringify({ ...metadata, VersionId: 'null' }) }]) {
    const { store, calls, root } = await fixture(t, { 'put-object': async () => ({ stdout: 'secret', stderr: 'credential', ...response }) });
    await assert.rejects(store.put({ key, bytes, checksumSha256: checksum }), e => {
      assert.match(e.code, /^[A-Z_]+$/); assert.equal(/secret|credential/.test(String(e)), false); return true;
    });
    assert.equal(calls.filter(a => a[1] === 'put-object').length, 1);
    assert.deepEqual(await readdir(root), []);
  }
});

test('rejects_invalid_refs_checksums_and_responses', async (t) => {
  const { store, calls } = await fixture(t);
  for (const bad of ['', 'null', '\n', '--endpoint-url']) await assert.rejects(store.head({ key, versionId: bad }), { code: 'INVALID_INPUT' });
  for (const bad of [key.replace('/e3/', '/../'), key.replace('/e3/', '/%65/'), key + '/extra', key.replace('/a1/', '/a0/')]) {
    await assert.rejects(store.get({ key: bad, versionId: 'v' }), { code: 'INVALID_INPUT' });
  }
  assert.equal(calls.length, 0);
  for (const value of ['not JSON', JSON.stringify({ ...metadata, ChecksumSHA256: checksum.replace(/=$/, '') }),
    JSON.stringify({ ...metadata, VersionId: 'other' }), JSON.stringify({ ...metadata, ContentLength: -1 })]) {
    const f = await fixture(t, { 'head-object': async () => ({ code: 0, stdout: value, stderr: '' }) });
    await assert.rejects(f.store.head(ref));
  }
});

test('refuses_git_sync_aliases_and_nonprivate_scratch_before_writes', async (t) => {
  const { root, runAws, calls, privacy } = await fixture(t);
  const git = join(root, 'git'); await mkdir(git); await writeFile(join(git, '.git'), 'synthetic');
  const sync = join(root, 'OneDrive'); await mkdir(sync);
  const alias = join(root, 'alias'); await symlink(sync, alias, process.platform === 'win32' ? 'junction' : 'dir');
  for (const privateScratch of [git, sync, alias]) {
    const store = createS3ArchiveStore({ mode: 'upload', privateScratch, runAws, ...privacy });
    await assert.rejects(store.put({ key, bytes, checksumSha256: checksum }), { code: 'UNSAFE_SCRATCH' });
  }
  if (process.platform !== 'win32') {
    await chmod(root, 0o755);
    await assert.rejects(createS3ArchiveStore({ mode: 'upload', privateScratch: root, runAws }).put({ key, bytes, checksumSha256: checksum }));
  } else {
    const inherited = join(root, 'inherited'); await mkdir(inherited);
    await assert.rejects(createS3ArchiveStore({ mode: 'upload', privateScratch: inherited, runAws,
      inspectWindowsPrivacy: async () => ({ ...privateWindowsFacts(), protected: false })
    }).put({ key, bytes, checksumSha256: checksum }), { code: 'SCRATCH_NOT_PRIVATE' });
  }
  assert.equal(calls.length, 0);
});

test('library_privacy_facts_are_validated_and_unavailable_inventory_refuses_without_aws', async (t) => {
  const { root, runAws, calls } = await fixture(t);
  for (const [facts, code] of [
    [{ ...privateWindowsFacts(), syncRoots: [root] }, 'UNSAFE_SCRATCH'],
    [{ ...privateWindowsFacts(), syncRoots: [join(root, '..')] }, 'UNSAFE_SCRATCH'],
    [{ ...privateWindowsFacts(), protected: false }, 'SCRATCH_NOT_PRIVATE'],
    [{ ...privateWindowsFacts(), owner: 'S-1-5-21-456' }, 'SCRATCH_NOT_PRIVATE'],
    [{ ...privateWindowsFacts(), rules: [{ sid: 'S-1-1-0', allow: true, rights: 2032127 }] }, 'SCRATCH_NOT_PRIVATE'],
    [{ ...privateWindowsFacts(), rules: [{ sid: 'S-1-5-21-123', allow: true, rights: 1 }] }, 'SCRATCH_NOT_PRIVATE'],
    [{ ...privateWindowsFacts(), syncRoots: null }, 'SCRATCH_PRIVACY_UNAVAILABLE'],
  ]) {
    const store = createS3ArchiveStore({ mode: 'upload', privateScratch: root, runAws, inspectWindowsPrivacy: async () => facts });
    await assert.rejects(store.put({ key, bytes, checksumSha256: checksum }), { code });
    await assert.rejects(store.get(ref), { code });
    assert.deepEqual(await readdir(root), []);
  }
  const store = createS3ArchiveStore({ mode: 'upload', privateScratch: root, runAws,
    inspectWindowsPrivacy: async () => { throw Error('Requested registry access is not allowed.'); } });
  await assert.rejects(store.put({ key, bytes, checksumSha256: checksum }), { code: 'SCRATCH_PRIVACY_UNAVAILABLE' });
  await assert.rejects(store.get(ref), { code: 'SCRATCH_PRIVACY_UNAVAILABLE' });
  assert.equal(calls.length, 0);
  assert.deepEqual(await readdir(root), []);
});

test('production_rejects_all_caller_capabilities', () => {
  for (const capability of ['inspectWindowsPrivacy', 'runAws']) {
    const options = { mode: 'verify', privateScratch: tmpdir(), [capability]: () => privateWindowsFacts() };
    assert.throws(() => createProductionS3ArchiveStore(options), { code: 'INVALID_INPUT' });
    Object.defineProperty(options, capability, { enumerable: false });
    assert.throws(() => createProductionS3ArchiveStore(options), { code: 'INVALID_INPUT' });
    assert.throws(() => createProductionS3ArchiveStore(Object.assign(Object.create({ [capability]: options[capability] }),
      { mode: 'verify', privateScratch: tmpdir() })), { code: 'INVALID_INPUT' });
  }
});

test('production_uses_real_privacy_boundary_and_refuses_unavailable_inventory_without_aws', async (t) => {
  const { root } = await fixture(t);
  const script = `
    import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
    const calls=[];
    cp.execFile=()=>{throw Error('unmocked execution forbidden');};
    cp.execFile[Symbol.for('nodejs.util.promisify.custom')]=async(exe,args,options)=>{
      calls.push({exe,args});
      if(!exe.toLowerCase().endsWith('powershell.exe')) throw Error('AWS must not be invoked');
      throw Error('Requested registry access is not allowed.');
    };
    syncBuiltinESMExports();
    const {createProductionS3ArchiveStore}=await import(${JSON.stringify(new URL('./s3-store.mjs', import.meta.url).href)});
    const store=createProductionS3ArchiveStore({mode:'upload',privateScratch:${JSON.stringify(root)}});
    let error;try{await store.put({key:${JSON.stringify(key)},bytes:Buffer.from('synthetic archive'),checksumSha256:${JSON.stringify(checksum)}});}
    catch(e){error={code:e.code,message:e.message};}
    console.log(JSON.stringify({calls,error}));
  `;
  // This characterizes the Windows executable boundary, not real inventory availability.
  if (process.platform !== 'win32') { t.skip('Windows boundary; POSIX requires real CI verification'); return; }
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
      AWS_ACCESS_KEY_ID: 'SYNTHETIC_TEST_KEY', AWS_SECRET_ACCESS_KEY: 'SYNTHETIC_TEST_SECRET' }, windowsHide: true,
  }));
  assert.deepEqual(result.error, { code: 'SCRATCH_PRIVACY_UNAVAILABLE', message: 'SCRATCH_PRIVACY_UNAVAILABLE' });
  assert.equal(result.calls.length, 1);
  assert.match(result.calls[0].exe, /powershell\.exe$/i);
  assert.match(result.calls[0].args.at(-1), /SyncRootManager/);
  assert.deepEqual(await readdir(root), []);
});

test('incomplete_downloads_are_removed_without_removing_source_files', async (t) => {
  const { store, root } = await fixture(t, { 'get-object': async args => {
    await writeFile(args.at(-1), 'partial'); return { code: 1, stdout: 'private raw', stderr: 'private diagnostic' };
  } });
  await writeFile(join(root, 'source'), 'retained');
  await assert.rejects(store.get(ref), { code: 'AWS_FAILED' });
  assert.deepEqual(await readdir(root), ['source']);
  assert.equal(await readFile(join(root, 'source'), 'utf8'), 'retained');
});

test('key_digest_must_match_uploaded_bytes', async (t) => {
  const { store, calls } = await fixture(t);
  await assert.rejects(store.put({ key: key.replace(/[a-f0-9]{64}\.json$/, `${'0'.repeat(64)}.json`), bytes, checksumSha256: checksum }), { code: 'INVALID_INPUT' });
  assert.equal(calls.length, 0);
});

test('upload_snapshots_validated_inputs_before_async_scratch_checks', async (t) => {
  const { store, calls } = await fixture(t);
  const input = { key, bytes: Buffer.from(bytes), checksumSha256: checksum };
  const pending = store.put(input);
  input.key = 'outside/prefix'; input.checksumSha256 = 'changed'; input.bytes.fill(0);
  assert.deepEqual(await pending, { versionId: 'version-1', checksumSha256: checksum });
  const args = calls.at(-1);
  assert.equal(args[args.indexOf('--key') + 1], key);
  assert.equal(args[args.indexOf('--checksum-sha256') + 1], checksum);
});

test('production_runner_is_private_bounded_and_capability_checked', () => {
  const script = `
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const calls=[];
    cp.execFile=(exe,args,opts,cb)=>{
      if(exe!=='aws') throw Error('unexpected executable');
      calls.push({exe,args,opts});
      const stdout=args[0]==='--version' ? 'aws-cli/2.31.0 Python/test' :
        args.includes('--generate-cli-skeleton') ? JSON.stringify({IfNoneMatch:'',ChecksumSHA256:''}) :
        JSON.stringify({Account:'010438509726',Arn:'arn:aws:iam::010438509726:user/aoa-s3-artifacts'});
      cb(null,stdout,'');
    };
    cp.execFile[Symbol.for('nodejs.util.promisify.custom')]=(...args)=>new Promise((resolve,reject)=>{
      cp.execFile(...args,(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr}));
    });
    syncBuiltinESMExports();
    const {createProductionS3ArchiveStore}=await import(${JSON.stringify(new URL('./s3-store.mjs', import.meta.url).href)});
    const store=createProductionS3ArchiveStore({mode:'verify',privateScratch:${JSON.stringify(tmpdir())}});
    await store.identify();await store.identify();
    console.log(JSON.stringify(calls));
  `;
  const calls = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
      AWS_ACCESS_KEY_ID: 'SYNTHETIC_TEST_KEY', AWS_SECRET_ACCESS_KEY: 'SYNTHETIC_TEST_SECRET' }, windowsHide: true,
  }));
  assert.deepEqual(calls.map(c => c.args[1] ?? c.args[0]), ['--version', 'put-object', 'get-caller-identity', 'get-caller-identity']);
  for (const { opts } of calls) {
    assert.equal(opts.shell, false); assert.equal(opts.windowsHide, true);
    assert.equal(opts.timeout, 60_000); assert.equal(opts.maxBuffer, 1048576);
    assert.equal(opts.env.AWS_MAX_ATTEMPTS, '1'); assert.equal(opts.env.AWS_EC2_METADATA_DISABLED, 'true');
    assert.equal(opts.env.AWS_PAGER, ''); assert.equal(opts.env.AWS_REGION, 'us-east-1');
    assert.equal(opts.env.AWS_SECRET_ACCESS_KEY, 'SYNTHETIC_TEST_SECRET');
    assert.equal(opts.env.HOME, undefined); assert.equal(opts.env.USERPROFILE, undefined);
  }
});

test('production_rejects_unsafe_environment_without_executing', () => {
  const script = `
    import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
    cp.execFile=()=>{throw Error('must never execute');};syncBuiltinESMExports();
    const {createProductionS3ArchiveStore}=await import(${JSON.stringify(new URL('./s3-store.mjs', import.meta.url).href)});
    const codes=[];
    for(const name of ['AWS_ENDPOINT_URL','AWS_PROFILE','AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE','HTTPS_PROXY','NODE_TLS_REJECT_UNAUTHORIZED','LD_PRELOAD']){
      process.env[name]='synthetic';
      try{createProductionS3ArchiveStore({mode:'verify',privateScratch:${JSON.stringify(tmpdir())}});codes.push('unexpected');}
      catch(e){codes.push(e.code);}finally{delete process.env[name];}
    }
    console.log(JSON.stringify(codes));
  `;
  const codes = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
      AWS_ACCESS_KEY_ID: 'SYNTHETIC_TEST_KEY', AWS_SECRET_ACCESS_KEY: 'SYNTHETIC_TEST_SECRET' }, windowsHide: true,
  }));
  assert.deepEqual(codes, Array(7).fill('UNSAFE_ENVIRONMENT'));
});

test('configuration_and_identity_mismatches_fail_closed', async (t) => {
  for (const [op, value] of [
    ['get-caller-identity', { Account: '999999999999', Arn: 'arn:aws:iam::999999999999:user/aoa-s3-artifacts' }],
    ['get-caller-identity', { Account: account, Arn: `arn:aws:iam::${account}:user/other` }],
    ['get-bucket-versioning', { Status: 'Suspended' }],
    ['get-bucket-encryption', { ServerSideEncryptionConfiguration: { Rules: [] } }],
    ['get-object-lock-configuration', { ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'GOVERNANCE', Days: 180 } } } }],
  ]) {
    const { store } = await fixture(t, { [op]: async () => ({ code: 0, stdout: JSON.stringify(value), stderr: '' }) });
    await assert.rejects(op === 'get-caller-identity' ? store.identify() : store.inspectConfiguration(),
      { code: op === 'get-caller-identity' ? 'IDENTITY_MISMATCH' : 'CONFIGURATION_MISMATCH' });
  }
});

test('successful_but_incomplete_download_fails_integrity_and_cleans_up', async (t) => {
  const { store, root } = await fixture(t, { 'get-object': async args => {
    await writeFile(args.at(-1), 'partial'); return { code: 0, stdout: JSON.stringify(metadata), stderr: '' };
  } });
  await assert.rejects(store.get(ref), { code: 'INVALID_RESPONSE' });
  assert.deepEqual(await readdir(root), []);
});

test('production_missing_cli_or_capabilities_never_reaches_network_operation', () => {
  for (const scenario of ['missing', 'v1', 'fields', 'nonjson']) {
    const script = `
      import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
      const calls=[];const scenario=${JSON.stringify(scenario)};
      cp.execFile=()=>{throw Error('unexpected unmocked execution');};
      cp.execFile[Symbol.for('nodejs.util.promisify.custom')]=async(exe,args,opts)=>{
        calls.push(args);
        if(scenario==='missing') throw Error('sensitive diagnostic');
        if(args[0]==='--version')return {stdout:scenario==='v1'?'aws-cli/1.0':'aws-cli/2.31.0',stderr:''};
        if(!args.includes('--generate-cli-skeleton')) throw Error('network operation attempted');
        return {stdout:scenario==='nonjson'?'private raw output':'{}',stderr:''};
      };
      syncBuiltinESMExports();
      const {createProductionS3ArchiveStore}=await import(${JSON.stringify(new URL('./s3-store.mjs', import.meta.url).href)});
      const store=createProductionS3ArchiveStore({mode:'verify',privateScratch:${JSON.stringify(tmpdir())}});
      let error;try{await store.identify();}catch(e){error={code:e.code,message:e.message};}
      console.log(JSON.stringify({calls,error}));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
        AWS_ACCESS_KEY_ID: 'SYNTHETIC_TEST_KEY', AWS_SECRET_ACCESS_KEY: 'SYNTHETIC_TEST_SECRET' }, windowsHide: true,
    }));
    assert.equal(result.error.code, 'AWS_FAILED');
    assert.equal(result.error.message, 'AWS_FAILED');
    assert.equal(result.calls.some(args => args.includes('get-caller-identity')), false);
    assert.equal(result.calls.length, ['missing', 'v1'].includes(scenario) ? 1 : 2);
  }
});

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, realpath, access, open, unlink } from 'node:fs/promises';
import { resolve, dirname, join, parse, isAbsolute, sep } from 'node:path';

const execute = promisify(execFile);
const ACCOUNT = '010438509726';
const REGION = 'us-east-1';
const BUCKET = 'aoa-platform-evidence-010438509726-us-east-1-an';
const UPLOADER = `arn:aws:iam::${ACCOUNT}:user/aoa-s3-artifacts`;
const LIMIT = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const systemVariables = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'LANG', 'LC_ALL']);
const credentialVariables = new Set(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']);

function fail(code) { throw Object.assign(new Error(code), { code }); }
function closed(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).some(k => !keys.includes(k))) fail('INVALID_INPUT');
}
function version(value) {
  if (typeof value !== 'string' || !value.trim() || value === 'null' || value.startsWith('-') || /[\x00-\x20\x7f]/.test(value)) fail('INVALID_INPUT');
  return value;
}
function keyValid(key) {
  if (typeof key !== 'string' || !/^replatform\/m1a\/[a-z0-9]+(?:-[a-z0-9]+)*\/[1-9][0-9]*-r[1-9][0-9]*\/a[1-9][0-9]*\/[a-f0-9]{64}\.json$/.test(key)) fail('INVALID_INPUT');
}
function checksum(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, 'base64').toString('base64') !== value) fail('INVALID_RESPONSE');
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('INVALID_RESPONSE');
  return new Date(value).toISOString();
}
function json(result) {
  if (!result || result.code !== 0) fail('AWS_FAILED');
  if (typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > LIMIT || typeof result.stderr !== 'string' || Buffer.byteLength(result.stderr) > LIMIT) fail('INVALID_RESPONSE');
  let data;
  try { data = JSON.parse(result.stdout); } catch { fail('INVALID_RESPONSE'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('INVALID_RESPONSE');
  return data;
}
function systemEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => systemVariables.has(k.toUpperCase())));
}

// No ambient credential/config files, endpoints, proxies, or executable loaders.
function productionEnv() {
  const env = systemEnv();
  for (const [name, value] of Object.entries(process.env)) {
    const k = name.toUpperCase();
    if (credentialVariables.has(k)) env[k] = value;
    else if (['AWS_REGION', 'AWS_DEFAULT_REGION'].includes(k)) {
      if (value !== REGION) fail('UNSAFE_ENVIRONMENT');
    } else if (k.startsWith('AWS_') || /PROXY|^NODE_OPTIONS$|^NODE_PATH$|^LD_|^DYLD_|^PYTHON|^SSL_CERT|^REQUESTS_CA_BUNDLE$|^CURL_CA_BUNDLE$|^NODE_TLS_REJECT_UNAUTHORIZED$/.test(k)) {
      fail('UNSAFE_ENVIRONMENT');
    }
  }
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) fail('CREDENTIALS_REQUIRED');
  return { ...env, AWS_REGION: REGION, AWS_DEFAULT_REGION: REGION, AWS_EC2_METADATA_DISABLED: 'true',
    AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off', AWS_MAX_ATTEMPTS: '1', AWS_RETRY_MODE: 'standard',
    AWS_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null',
    AWS_SHARED_CREDENTIALS_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null' };
}

function privateRunner() {
  const env = productionEnv();
  const options = { shell: false, windowsHide: true, timeout: 60_000, maxBuffer: LIMIT, encoding: 'utf8', env };
  async function invoke(args) {
    try { const { stdout, stderr } = await execute('aws', args, options); return { code: 0, stdout, stderr }; }
    catch { fail('AWS_EXECUTION_FAILED'); }
  }
  let ready;
  return async (args) => {
    ready ??= (async () => {
      const v = await invoke(['--version']);
      if (!/^aws-cli\/2\./.test(v.stdout.trim())) fail('AWS_CAPABILITY_UNAVAILABLE');
      const skeleton = json(await invoke(['s3api', 'put-object', '--generate-cli-skeleton', 'input', '--region', REGION, '--output', 'json', '--no-cli-pager']));
      if (!Object.hasOwn(skeleton, 'IfNoneMatch') || !Object.hasOwn(skeleton, 'ChecksumSHA256')) fail('AWS_CAPABILITY_UNAVAILABLE');
    })();
    await ready;
    return invoke(args);
  };
}

async function readWindowsPrivacy(path) {
  // SID comparisons avoid localized account names. Unknown ACL capability fails closed.
  const script = '$ErrorActionPreference="Stop";$p=$env:M1A_PRIVATE_PATH;' +
    '$s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;' +
    '$a=Get-Acl -LiteralPath $p;$o=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;' +
    '$r=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])|ForEach-Object {' +
    '@{sid=$_.IdentityReference.Value;allow=($_.AccessControlType -eq "Allow");rights=[int]$_.FileSystemRights;' +
    'inheritanceFlags=[int]$_.InheritanceFlags;propagationFlags=[int]$_.PropagationFlags}});' +
    '$roots=@();$reg="Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\SyncRootManager";' +
    'if(Test-Path -LiteralPath $reg){foreach($provider in Get-ChildItem -LiteralPath $reg){' +
    '$u=Join-Path $provider.PSPath "UserSyncRoots";if(Test-Path -LiteralPath $u){' +
    '$key=Get-Item -LiteralPath $u;foreach($n in $key.GetValueNames()){$roots+=([string]$key.GetValue($n))}}}};' +
    '@{sid=$s;owner=$o;protected=$a.AreAccessRulesProtected;rules=$r;syncRoots=@($roots)}|ConvertTo-Json -Depth 5 -Compress';
  try {
    const { stdout } = await execute(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { shell: false, windowsHide: true, timeout: 60_000, maxBuffer: LIMIT, env: { ...systemEnv(), M1A_PRIVATE_PATH: path } });
    return JSON.parse(stdout);
  } catch { fail('SCRATCH_PRIVACY_UNAVAILABLE'); }
}

function validateWindowsPrivacy(path, acl, kind) {
  if (!acl || !Array.isArray(acl.syncRoots) || acl.syncRoots.some(root => typeof root !== 'string' || !isAbsolute(root))) fail('SCRATCH_PRIVACY_UNAVAILABLE');
  if (acl.syncRoots.some(root => {
    const sync = resolve(root).toLowerCase();
    return path.toLowerCase() === sync || path.toLowerCase().startsWith(sync.endsWith(sep) ? sync : sync + sep);
  })) fail('UNSAFE_SCRATCH');
  if ((kind === 'directory' && acl.protected !== true) || typeof acl.sid !== 'string' || !/^S-1-[0-9-]+$/.test(acl.sid) || acl.owner !== acl.sid || !Array.isArray(acl.rules) || !acl.rules.length ||
    acl.rules.some(r => !r || typeof r.sid !== 'string' || typeof r.allow !== 'boolean' || !Number.isSafeInteger(r.rights) ||
      !Number.isInteger(r.inheritanceFlags) || r.inheritanceFlags < 0 || r.inheritanceFlags > 3 ||
      !Number.isInteger(r.propagationFlags) || r.propagationFlags < 0 || r.propagationFlags > 3) ||
    acl.rules.some(r => r.allow && ![acl.sid, 'S-1-5-18', 'S-1-5-32-544'].includes(r.sid)) ||
    !acl.rules.some(r => r.allow && r.sid === acl.sid && (r.rights & 2032127) === 2032127 &&
      (kind === 'directory' ? r.inheritanceFlags === 3 && r.propagationFlags === 0 : (r.propagationFlags & 2) === 0))) fail('SCRATCH_NOT_PRIVATE');
}

async function checkWindowsPrivacy(path, kind, inspector) {
  let facts;
  try { facts = await (inspector ?? readWindowsPrivacy)(path, { kind }); }
  catch { fail('SCRATCH_PRIVACY_UNAVAILABLE'); }
  validateWindowsPrivacy(path, facts, kind);
}

async function privateFile(path, handle, inspector) {
  await privateDirectory(dirname(path), inspector);
  const actual = await lstat(path);
  const held = await handle.stat();
  if (!actual.isFile() || actual.isSymbolicLink() || actual.ino !== held.ino || actual.dev !== held.dev) fail('UNSAFE_SCRATCH');
  if (process.platform !== 'win32' && ((held.mode & 0o077) !== 0 || held.uid !== process.getuid())) fail('SCRATCH_NOT_PRIVATE');
  if (process.platform === 'win32' || inspector) await checkWindowsPrivacy(path, 'file', inspector);
  return held;
}

async function boundedRead(handle, expectedSize) {
  // Size is checked before allocation and across reads; no readFile/stream accumulation.
  if ((await handle.stat()).size !== expectedSize) fail('INVALID_RESPONSE');
  const bytes = Buffer.alloc(expectedSize);
  let offset = 0;
  while (offset < expectedSize) {
    if ((await handle.stat()).size !== expectedSize) fail('INVALID_RESPONSE');
    const { bytesRead } = await handle.read(bytes, offset, Math.min(READ_CHUNK_BYTES, expectedSize - offset), offset);
    if (bytesRead === 0) fail('INVALID_RESPONSE');
    offset += bytesRead;
    if ((await handle.stat()).size !== expectedSize) fail('INVALID_RESPONSE');
  }
  const end = await handle.read(Buffer.alloc(1), 0, 1, expectedSize);
  if (end.bytesRead !== 0 || (await handle.stat()).size !== expectedSize) fail('INVALID_RESPONSE');
  return bytes;
}

async function privateDirectory(input, inspectWindowsPrivacy) {
  try {
    const path = resolve(input);
    const canonical = await realpath(path);
    if (process.platform === 'win32' ? canonical.toLowerCase() !== path.toLowerCase() : canonical !== path) fail('UNSAFE_SCRATCH');
    for (const [k, value] of Object.entries(process.env)) {
      if (/onedrive|dropbox|googledrive|google_drive|icloud|box_sync/i.test(k) && value) {
        if (!isAbsolute(value)) fail('UNSAFE_SCRATCH');
        const roots = [resolve(value), await realpath(value)];
        if (roots.some(root => {
          const sync = root.toLowerCase(), candidate = canonical.toLowerCase();
          return candidate === sync || candidate.startsWith(sync.endsWith(sep) ? sync : sync + sep);
        })) fail('UNSAFE_SCRATCH');
      }
    }
    let child;
    for (let p = path;; p = dirname(p)) {
      const stat = await lstat(p);
      if (stat.isSymbolicLink() || !stat.isDirectory() || /(?:^|[\\/])(onedrive[^\\/]*|dropbox|google drive|googledrive|box sync|icloud[^\\/]*|cloudstorage)(?:[\\/]|$)/i.test(p)) fail('UNSAFE_SCRATCH');
      if (process.platform !== 'win32') {
        // Sticky protects only a trusted, non-writable direct child's name.
        if (![0, process.getuid()].includes(stat.uid) ||
          (stat.mode & 0o022) !== 0 && (!(stat.mode & 0o1000) || !child ||
            ![0, process.getuid()].includes(child.uid) || (child.mode & 0o022) !== 0)) fail('SCRATCH_NOT_PRIVATE');
      }
      if (process.platform === 'win32' || inspectWindowsPrivacy) await checkWindowsPrivacy(p, 'directory', inspectWindowsPrivacy);
      try { await access(join(p, '.git')); fail('UNSAFE_SCRATCH'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      child = stat;
      if (p === parse(p).root) break;
    }
    const stat = await lstat(path);
    if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())) fail('SCRATCH_NOT_PRIVATE');
    return path;
  } catch (e) {
    if (['UNSAFE_SCRATCH', 'SCRATCH_NOT_PRIVATE', 'SCRATCH_PRIVACY_UNAVAILABLE'].includes(e.code)) throw e;
    fail('UNSAFE_SCRATCH');
  }
}

/** @typedef {{key:string,versionId:string}} VersionRef */
/** Real privacy only; production callers supply the OS-opened handle. */
export async function assertPrivateArchiveOutputRoot(path) {
  if (arguments.length !== 1 || typeof path !== 'string' || !isAbsolute(path)) fail('INVALID_INPUT');
  return privateDirectory(path);
}
export async function assertPrivateArchiveOutputFile(path, handle) {
  if (arguments.length !== 2 || typeof path !== 'string' || !isAbsolute(path)) fail('INVALID_INPUT');
  return privateFile(path, handle);
}

/** @typedef {{account:string,arn:string}} Identity */
/**
 * Fixed-destination Store. checksumSha256 is canonical SHA-256 base64 throughout.
 * runAws and inspectWindowsPrivacy are library-test boundaries only.
 * inspectWindowsPrivacy(path,{kind:'directory'|'file'}) returns ACL/inventory facts;
 * rules include inheritanceFlags and propagationFlags (Windows enum integers).
 * facts still pass the real validator and never bypass filesystem/path checks.
 * put errors after a validated service VersionId carry knownVersionRef:{key,versionId},
 * including checksum/encryption refusal and scratch cleanup failure. No inferred ref.
 */
export function createS3ArchiveStore(options) {
  closed(options, ['mode', 'runAws', 'privateScratch', 'now', 'inspectWindowsPrivacy']);
  const { mode, runAws, privateScratch, now = () => new Date(), inspectWindowsPrivacy } = options;
  if (!['upload', 'verify'].includes(mode) || typeof runAws !== 'function' || typeof privateScratch !== 'string' || !isAbsolute(privateScratch) || typeof now !== 'function' ||
    inspectWindowsPrivacy !== undefined && typeof inspectWindowsPrivacy !== 'function') fail('INVALID_INPUT');
  const base = ['--region', REGION, '--output', 'json', '--no-cli-pager'];
  async function call(op, args = [], service = 's3api') {
    const argv = [service, op, ...base, ...(service === 's3api' ? ['--bucket', BUCKET, '--expected-bucket-owner', ACCOUNT] : []), ...args];
    let result;
    try { result = await runAws(argv); } catch { fail('AWS_FAILED'); }
    return json(result);
  }
  function reference(ref) {
    closed(ref, ['key', 'versionId']);
    const { key, versionId } = ref;
    keyValid(key); version(versionId);
    return { key, versionId };
  }
  const referenceArgs = ref => ['--key', ref.key, '--version-id', ref.versionId];
  function readMetadata(data, ref) {
    let v;
    try { v = version(data.VersionId); } catch { fail('INVALID_RESPONSE'); }
    if (v !== ref.versionId || !Number.isSafeInteger(data.ContentLength) || data.ContentLength <= 0 || data.ContentLength > MAX_ARCHIVE_BYTES || data.ServerSideEncryption !== 'AES256') fail('INVALID_RESPONSE');
    return { versionId: v, size: data.ContentLength, checksumSha256: checksum(data.ChecksumSHA256),
      encryption: data.ServerSideEncryption, lastModified: timestamp(data.LastModified) };
  }
  async function scratch(action) {
    const root = await privateDirectory(privateScratch, inspectWindowsPrivacy);
    const path = join(root, `m1a-${randomUUID()}.tmp`);
    let handle;
    let identity;
    try {
      handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
      identity = await handle.stat();
      await privateFile(path, handle, inspectWindowsPrivacy);
      return await action(path, handle);
    } catch (e) {
      if (['INVALID_INPUT', 'INVALID_RESPONSE', 'AWS_FAILED', 'UNSAFE_SCRATCH', 'SCRATCH_NOT_PRIVATE', 'SCRATCH_PRIVACY_UNAVAILABLE'].includes(e.code)) throw e;
      fail('SCRATCH_IO_FAILED');
    } finally {
      if (handle) {
        try {
          await privateDirectory(root, inspectWindowsPrivacy);
          const actual = await lstat(path);
          if (!identity || !actual.isFile() || actual.isSymbolicLink() || actual.dev !== identity.dev || actual.ino !== identity.ino) fail('SCRATCH_CLEANUP_FAILED');
          await unlink(path);
        } catch { fail('SCRATCH_CLEANUP_FAILED'); }
        finally { await handle.close().catch(() => fail('SCRATCH_CLEANUP_FAILED')); }
      }
    }
  }
  const store = {
    async identify() {
      const data = await call('get-caller-identity', [], 'sts');
      if (data.Account !== ACCOUNT || typeof data.Arn !== 'string' || !data.Arn.startsWith(`arn:aws:iam::${ACCOUNT}:`) && !data.Arn.startsWith(`arn:aws:sts::${ACCOUNT}:`)) fail('IDENTITY_MISMATCH');
      if (mode === 'upload' && data.Arn !== UPLOADER) fail('IDENTITY_MISMATCH');
      return { account: data.Account, arn: data.Arn };
    },
    async inspectConfiguration() {
      const versioning = await call('get-bucket-versioning');
      const encryption = (await call('get-bucket-encryption')).ServerSideEncryptionConfiguration;
      const objectLock = (await call('get-object-lock-configuration')).ObjectLockConfiguration;
      if (versioning.Status !== 'Enabled' || encryption?.Rules?.length !== 1 ||
        encryption.Rules[0].ApplyServerSideEncryptionByDefault?.SSEAlgorithm !== 'AES256' ||
        objectLock?.ObjectLockEnabled !== 'Enabled' || objectLock.Rule?.DefaultRetention?.Mode !== 'COMPLIANCE' ||
        objectLock.Rule.DefaultRetention.Days !== 180 || Object.hasOwn(objectLock.Rule.DefaultRetention, 'Years')) fail('CONFIGURATION_MISMATCH');
      return { versioning, encryption, objectLock };
    },
    async head(ref) {
      const pinned = reference(ref);
      return readMetadata(await call('head-object', [...referenceArgs(pinned), '--checksum-mode', 'ENABLED']), pinned);
    },
    async get(ref) {
      const pinned = reference(ref);
      return scratch(async (path, handle) => {
        const before = await handle.stat();
        const args = referenceArgs(pinned);
        const expected = readMetadata(await call('head-object', [...args, '--checksum-mode', 'ENABLED']), pinned);
        await privateFile(path, handle, inspectWindowsPrivacy);
        const data = readMetadata(await call('get-object', [...args, '--checksum-mode', 'ENABLED', path]), pinned);
        if (data.size !== expected.size || data.checksumSha256 !== expected.checksumSha256) fail('INVALID_RESPONSE');
        const after = await privateFile(path, handle, inspectWindowsPrivacy);
        if (after.ino !== before.ino || after.dev !== before.dev || after.size !== data.size) fail('INVALID_RESPONSE');
        const bytes = await boundedRead(handle, data.size);
        const final = await privateFile(path, handle, inspectWindowsPrivacy);
        if (final.ino !== before.ino || final.dev !== before.dev || final.size !== data.size) fail('INVALID_RESPONSE');
        if (bytes.length !== data.size || createHash('sha256').update(bytes).digest('base64') !== data.checksumSha256) fail('INVALID_RESPONSE');
        return { versionId: data.versionId, bytes, checksumSha256: data.checksumSha256, encryption: data.encryption };
      });
    },
    async retention(ref) {
      const data = (await call('get-object-retention', referenceArgs(reference(ref)))).Retention;
      if (!data || !['COMPLIANCE', 'GOVERNANCE'].includes(data.Mode)) fail('INVALID_RESPONSE');
      return { mode: data.Mode, retainUntil: timestamp(data.RetainUntilDate) };
    },
  };
  if (mode === 'upload') store.put = async (input) => {
    closed(input, ['key', 'bytes', 'checksumSha256']); keyValid(input.key);
    if (!Buffer.isBuffer(input.bytes) || !input.bytes.length || input.bytes.length > MAX_ARCHIVE_BYTES || createHash('sha256').update(input.bytes).digest('base64') !== input.checksumSha256) fail('INVALID_INPUT');
    const bytes = Buffer.from(input.bytes);
    const { key, checksumSha256 } = input;
    if (!key.endsWith(`/${createHash('sha256').update(bytes).digest('hex')}.json`)) fail('INVALID_INPUT');
    let knownVersionId;
    try { return await scratch(async (path, handle) => {
      await handle.writeFile(bytes); await handle.sync();
      await privateFile(path, handle, inspectWindowsPrivacy);
      const data = await call('put-object', ['--key', key, '--body', path, '--if-none-match', '*',
        '--checksum-sha256', checksumSha256, '--server-side-encryption', 'AES256']);
      let v;
      try { v = version(data.VersionId); } catch { fail('INVALID_RESPONSE'); }
      knownVersionId = v;
      if (checksum(data.ChecksumSHA256) !== checksumSha256 || data.ServerSideEncryption !== 'AES256') fail('INVALID_RESPONSE');
      return { versionId: v, checksumSha256: data.ChecksumSHA256 };
    }); } catch (error) {
      if (!knownVersionId) throw error;
      const code = ['INVALID_RESPONSE', 'SCRATCH_CLEANUP_FAILED', 'SCRATCH_IO_FAILED'].includes(error?.code) ? error.code : 'INVALID_RESPONSE';
      throw Object.assign(new Error(code), { code, knownVersionRef: { key, versionId: knownVersionId } });
    }
  };
  return Object.freeze(store);
}

/** Production constructor: callers cannot select the executable, endpoint, or runner. */
export function createProductionS3ArchiveStore(options) {
  closed(options, ['mode', 'privateScratch', 'now']);
  if ('inspectWindowsPrivacy' in options || 'runAws' in options) fail('INVALID_INPUT');
  const { mode, privateScratch, now } = options;
  return createS3ArchiveStore({ mode, privateScratch, now, runAws: privateRunner() });
}

import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { lstat, realpath, opendir, open } from 'node:fs/promises';
import { resolve, dirname, join, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW_LIMIT = 64 * 1024 * 1024;
const BUNDLE_LIMIT = 128 * 1024 * 1024;
const OUTPUT_LIMIT = 2 * RAW_LIMIT + 2 * 1024 * 1024;
const HELPER = fileURLToPath(new URL('./inspect-zip.py', import.meta.url));
const execute = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const HASH = /^[a-f0-9]{64}$/;
const CONTRACT_KEYS = ['schema', 'classification', 'candidate', 'campaignId', 'runId', 'runAttempt', 'qaAttempt',
  'completedAt', 'requiredRetainUntil', 'members', 'finalObservations', 'redactionReview'];
const MEMBER_KEYS = ['path', 'sha256', 'size', 'format', 'artifactId', 'category'];
const OBSERVATION_KEYS = ['job', 'conclusion', 'cleanupObserved', 'evidencePath'];
const REVIEW_KEYS = ['reviewerId', 'reviewedAt', 'sourceInventorySha256'];
const IDENTITY_KEYS = ['candidate', 'campaignId', 'runId', 'runAttempt', 'qaAttempt'];
const SECRET = /(?:AKIA|ASIA)[0-9A-Z]{16}|\bBearer\s+\S+|-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|(?:password|passwd|pwd|aws_access_key_id|aws_secret_access_key|aws_session_token|api[_-]?key|access[_-]?token|client[_-]?secret)\s*["']?\s*[:=]\s*\S+|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/i;

function fail(code) { throw Object.assign(new Error(code), { code }); }
function closed(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k)) ||
    Reflect.ownKeys(value).some(k => !keys.includes(k) || !Object.getOwnPropertyDescriptor(value, k)?.enumerable ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), 'value'))) fail('M1A_INVALID_INPUT');
}
function token(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\x00-\x1f\x7f]/.test(value) ||
    Buffer.from(value, 'utf8').toString('utf8') !== value) fail('M1A_INVALID_INPUT');
}
function sha(value) { if (typeof value !== 'string' || !HASH.test(value)) fail('M1A_INVALID_INPUT'); }
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) || ![new Date(value).toISOString(), new Date(value).toISOString().replace('.000Z', 'Z')].includes(value)) fail('M1A_INVALID_INPUT');
}
function safePath(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[^\x20-\x7e]|[\\%:*?"<>|]/.test(value)) fail('M1A_UNSAFE_PATH');
  const parts = value.split('/');
  if (parts.some(p => !p || p.length > 255 || p === '.' || p === '..' || /[. ]$/.test(p) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) fail('M1A_UNSAFE_PATH');
  return value;
}
function strings(value) {
  if (!Array.isArray(value) || !value.length || value.length > 128 || new Set(value).size !== value.length) fail('M1A_EXPECTATIONS_REQUIRED');
  value.forEach(token); return [...value].sort(compare);
}
function canaries(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128 || value.some(s => typeof s !== 'string' || !s || s.length > 4096)) fail('M1A_INVALID_INPUT');
  return [...value];
}
function scan(text, supplied) {
  if (SECRET.test(text) || supplied.some(s => text.includes(s))) fail('M1A_SECRET_REFUSED');
}
function text(bytes) {
  try {
    const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail('M1A_UNSUPPORTED_BINARY');
    return value;
  } catch (e) { if (e.code === 'M1A_UNSUPPORTED_BINARY') throw e; fail('M1A_INVALID_UTF_EIGHT'); }
}
function namedPaths(members) {
  const paths = new Set(), spellings = new Map();
  for (const m of members) {
    const key = m.path.toLowerCase();
    if (paths.has(key)) fail('M1A_DUPLICATE_MEMBER'); paths.add(key);
    const parts = m.path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const name = parts.slice(0, i).join('/'), folded = name.toLowerCase();
      if (spellings.has(folded) && spellings.get(folded) !== name) fail('M1A_DUPLICATE_MEMBER');
      spellings.set(folded, name);
    }
  }
  for (const key of paths) {
    const parts = key.split('/');
    for (let i = 1; i < parts.length; i++) if (paths.has(parts.slice(0, i).join('/'))) fail('M1A_UNSAFE_PATH');
  }
}
function ordered(value, keys) { return Object.fromEntries(keys.map(k => [k, value[k]])); }

/**
 * Canonical hash preimages (UTF-8 JSON.stringify, no spaces/newline):
 * inventory = descriptors with MEMBER_KEYS order, sorted by path using JS < / >
 * (code units, not locale); contract = CONTRACT_KEYS order, members as above,
 * observations with OBSERVATION_KEYS order sorted by job using the same comparison,
 * redactionReview with REVIEW_KEYS order. Dates/strings are validated, not rewritten.
 * The inventory hash excludes redactionReview; contract hash includes it and all fields.
 */
function canonicalContract(input, expectedHash, jobsInput, categoriesInput, supplied) {
  const jobs = strings(jobsInput), categories = strings(categoriesInput);
  closed(input, CONTRACT_KEYS); sha(expectedHash);
  if (input.schema !== 1 || input.classification !== 'M1A_ARCHIVE_INPUT' || typeof input.candidate !== 'string' ||
    !/^[a-f0-9]{40}$/.test(input.candidate) || typeof input.campaignId !== 'string' || input.campaignId.length > 128 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.campaignId) || typeof input.runId !== 'string' ||
    !/^[1-9][0-9]{0,31}$/.test(input.runId) || !Number.isSafeInteger(input.runAttempt) || input.runAttempt < 1 ||
    typeof input.qaAttempt !== 'string' || !/^a[1-9][0-9]{0,31}$/.test(input.qaAttempt)) fail('M1A_INVALID_INPUT');
  timestamp(input.completedAt); timestamp(input.requiredRetainUntil);
  if (Date.parse(input.requiredRetainUntil) <= Date.parse(input.completedAt)) fail('M1A_INVALID_INPUT');
  if (!Array.isArray(input.members) || !input.members.length || input.members.length > 128) fail('M1A_SIZE_BOUND');
  let total = 0;
  const members = input.members.map(m => {
    closed(m, MEMBER_KEYS); safePath(m.path); sha(m.sha256); token(m.artifactId); token(m.category);
    if (!Number.isSafeInteger(m.size) || m.size < 1 || m.size > RAW_LIMIT || !['utf8', 'zip'].includes(m.format)) fail('M1A_SIZE_BOUND');
    total += m.size; if (total > RAW_LIMIT) fail('M1A_SIZE_BOUND');
    return ordered(m, MEMBER_KEYS);
  }).sort((a, b) => compare(a.path, b.path));
  namedPaths(members);
  if (categories.some(category => !members.some(m => m.category === category))) fail('M1A_INVENTORY_MISMATCH');
  closed(input.redactionReview, REVIEW_KEYS);
  token(input.redactionReview.reviewerId); timestamp(input.redactionReview.reviewedAt); sha(input.redactionReview.sourceInventorySha256);
  if (digest(JSON.stringify(members)) !== input.redactionReview.sourceInventorySha256) fail('M1A_INVENTORY_MISMATCH');
  if (!Array.isArray(input.finalObservations) || input.finalObservations.length !== jobs.length) fail('M1A_OBSERVATION_MISMATCH');
  const observations = input.finalObservations.map(o => {
    closed(o, OBSERVATION_KEYS); token(o.job); safePath(o.evidencePath);
    if (!['success', 'failure', 'cancelled'].includes(o.conclusion) || typeof o.cleanupObserved !== 'boolean' ||
      !members.some(m => m.path === o.evidencePath)) fail('M1A_OBSERVATION_MISMATCH');
    return ordered(o, OBSERVATION_KEYS);
  }).sort((a, b) => compare(a.job, b.job));
  if (observations.some((o, i) => o.job !== jobs[i])) fail('M1A_OBSERVATION_MISMATCH');
  const contract = ordered(input, CONTRACT_KEYS);
  contract.members = members; contract.finalObservations = observations; contract.redactionReview = ordered(input.redactionReview, REVIEW_KEYS);
  // Inspect string values themselves as well as serialization (JSON escaping is not redaction).
  for (const value of [contract.candidate, contract.campaignId, contract.runId, contract.qaAttempt,
    contract.completedAt, contract.requiredRetainUntil, ...members.flatMap(m => [m.path, m.sha256, m.format, m.artifactId, m.category]),
    ...observations.flatMap(o => [o.job, o.conclusion, o.evidencePath]), ...Object.values(contract.redactionReview)]) scan(value, supplied);
  scan(JSON.stringify(contract), supplied);
  if (digest(JSON.stringify(contract)) !== expectedHash) fail('M1A_CONTRACT_MISMATCH');
  return contract;
}
function systemEnv() {
  const allowed = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL']);
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => allowed.has(k.toUpperCase())));
}
async function inspectZip(bytes, remaining, remainingEntries, supplied) {
  // Raw-byte patterns also cover uncompressed ZIP comments/metadata; entry content
  // still requires strict UTF-8 decompression via the standard library helper.
  if (supplied.some(s => bytes.includes(Buffer.from(s, 'utf8')))) fail('M1A_SECRET_REFUSED');
  scan(bytes.toString('latin1'), []);
  const output = await new Promise((resolveOutput, reject) => {
    const child = spawn(process.platform === 'win32' ? 'python' : 'python3', ['-I', '-S', HELPER, String(remaining), String(remainingEntries)],
      { shell: false, windowsHide: true, env: systemEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0, errorSize = 0, failed = false;
    const stop = () => { failed = true; child.kill(); };
    const timer = setTimeout(stop, 60_000);
    child.on('error', () => { failed = true; }); child.stdin.on('error', () => { failed = true; });
    child.stdout.on('data', chunk => { size += chunk.length; if (size > OUTPUT_LIMIT) stop(); else chunks.push(chunk); });
    child.stderr.on('data', chunk => { errorSize += chunk.length; if (errorSize > 64 * 1024) stop(); });
    child.on('close', code => {
      clearTimeout(timer);
      if (failed || code !== 0 || errorSize) reject(Object.assign(new Error('M1A_ZIP_REFUSED'), { code: 'M1A_ZIP_REFUSED' }));
      else resolveOutput(Buffer.concat(chunks));
    });
    child.stdin.end(bytes);
  });
  let result;
  try { result = JSON.parse(text(output)); } catch { fail('M1A_ZIP_REFUSED'); }
  closed(result, ['entries', 'inflatedBytes', 'comment']);
  if (!Array.isArray(result.entries) || result.entries.length > remainingEntries || !Number.isSafeInteger(result.inflatedBytes) ||
    result.inflatedBytes < 0 || result.inflatedBytes > remaining || typeof result.comment !== 'string') fail('M1A_ZIP_REFUSED');
  let total = 0; scan(result.comment, supplied);
  for (const entry of result.entries) {
    closed(entry, ['name', 'text', 'comment']);
    if (typeof entry.name !== 'string' || typeof entry.text !== 'string' || typeof entry.comment !== 'string') fail('M1A_ZIP_REFUSED');
    safePath(entry.name.endsWith('/') ? entry.name.slice(0, -1) : entry.name);
    total += Buffer.byteLength(entry.text); if (total > remaining) fail('M1A_SIZE_BOUND');
    scan(entry.name, supplied); scan(entry.text, supplied); scan(entry.comment, supplied);
  }
  if (total !== result.inflatedBytes) fail('M1A_ZIP_REFUSED');
  return { inflated: total, entries: result.entries.length };
}
async function inspectMembers(contract, members, supplied) {
  if (!Array.isArray(members) || members.length !== contract.members.length) fail('M1A_INVENTORY_MISMATCH');
  let inflated = 0, entries = 0;
  for (let i = 0; i < members.length; i++) {
    const raw = members[i], declared = contract.members[i];
    closed(raw, ['path', 'sha256', 'size', 'base64']);
    if (raw.path !== declared.path || raw.sha256 !== declared.sha256 || raw.size !== declared.size ||
      typeof raw.base64 !== 'string' || raw.base64.length !== 4 * Math.ceil(declared.size / 3) ||
      /[^A-Za-z0-9+/=]/.test(raw.base64)) fail('M1A_INVENTORY_MISMATCH');
    // Linear character check above; canonical re-encoding checks padding/pad bits.
    const bytes = Buffer.from(raw.base64, 'base64');
    if (bytes.length !== declared.size || bytes.toString('base64') !== raw.base64 || digest(bytes) !== declared.sha256) fail('M1A_MEMBER_MISMATCH');
    if (declared.format === 'zip') {
      const inspected = await inspectZip(bytes, RAW_LIMIT - inflated, 4096 - entries, supplied);
      inflated += inspected.inflated; entries += inspected.entries;
    }
    else {
      if (/\.(?:zip|gz|bz2|xz|7z|rar|tar|tgz|pdf|png|jpe?g|exe|dll)$/i.test(declared.path)) fail('M1A_UNSUPPORTED_BINARY');
      const content = text(bytes);
      if (content.startsWith('%PDF-')) fail('M1A_UNSUPPORTED_BINARY');
      scan(content, supplied);
    }
  }
}
function serialize(contract, contractSha256, members) {
  const json = JSON.stringify({ format: 'aoa-m1a-archive-v1', contractSha256, contract, members });
  if (Buffer.byteLength(json) > BUNDLE_LIMIT) fail('M1A_SIZE_BOUND');
  return Buffer.from(json, 'utf8');
}
function prepared(bytes, contract, contractSha256) {
  return { bytes, sha256: digest(bytes), size: bytes.length, contractSha256,
    identity: ordered(contract, IDENTITY_KEYS), requiredRetainUntil: contract.requiredRetainUntil };
}

/** @typedef {{path:string,sha256:string,size:number,format:'utf8'|'zip',artifactId:string,category:string}} Member */
/** @typedef {{job:string,conclusion:'success'|'failure'|'cancelled',cleanupObserved:boolean,evidencePath:string}} Observation */
/** @typedef {{schema:1,classification:'M1A_ARCHIVE_INPUT',candidate:string,campaignId:string,runId:string,runAttempt:number,qaAttempt:string,completedAt:string,requiredRetainUntil:string,members:Member[],finalObservations:Observation[],redactionReview:{reviewerId:string,reviewedAt:string,sourceInventorySha256:string}}} ArchiveContract */
/** @typedef {{bytes:Buffer,sha256:string,size:number,contractSha256:string,identity:{candidate:string,campaignId:string,runId:string,runAttempt:number,qaAttempt:string},requiredRetainUntil:string}} PreparedArchive */
/**
 * Offline readback also requires independently supplied nonempty expectedJobs and
 * requiredCategories on expected, alongside ExpectedArchive's hash/identity fields.
 * secretCanaries is an optional array on expected; no evidence bytes are logged.
 * @param {{bytes:Buffer,expected:{contractSha256:string,sha256:string,size:number,identity:object,requiredRetainUntil:string,expectedJobs:string[],requiredCategories:string[],secretCanaries?:string[]}}} options
 * @returns {Promise<PreparedArchive>}
 */
export async function validateArchiveBytes(options) {
  try { return await validateBytes(options); }
  catch (e) { fail(/^M1A_[A-Z_]+$/.test(e?.code) ? e.code : 'M1A_INVALID_INPUT'); }
}
async function validateBytes({ bytes, expected } = {}) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > BUNDLE_LIMIT) fail('M1A_SIZE_BOUND');
  if (!expected || typeof expected !== 'object') fail('M1A_EXPECTATIONS_REQUIRED');
  sha(expected.sha256); sha(expected.contractSha256);
  if (!Number.isSafeInteger(expected.size) || expected.size !== bytes.length || digest(bytes) !== expected.sha256) fail('M1A_ARCHIVE_MISMATCH');
  // Copy the independently supplied expectations before the first asynchronous work.
  const supplied = canaries(expected.secretCanaries);
  closed(expected.identity, IDENTITY_KEYS);
  const identity = ordered(expected.identity, IDENTITY_KEYS), retainUntil = expected.requiredRetainUntil;
  let archive;
  try { archive = JSON.parse(text(bytes)); } catch { fail('M1A_INVALID_BUNDLE'); }
  closed(archive, ['format', 'contractSha256', 'contract', 'members']);
  if (archive.format !== 'aoa-m1a-archive-v1' || archive.contractSha256 !== expected.contractSha256) fail('M1A_CONTRACT_MISMATCH');
  const contract = canonicalContract(archive.contract, expected.contractSha256, expected.expectedJobs, expected.requiredCategories, supplied);
  if (IDENTITY_KEYS.some(k => identity[k] !== contract[k]) || retainUntil !== contract.requiredRetainUntil) fail('M1A_ARCHIVE_MISMATCH');
  if (!Array.isArray(archive.members) || archive.members.length !== contract.members.length) fail('M1A_INVENTORY_MISMATCH');
  // Exact wire equality rejects duplicate JSON keys, noncanonical ordering and aliases.
  const members = archive.members.map(m => { closed(m, ['path', 'sha256', 'size', 'base64']); return ordered(m, ['path', 'sha256', 'size', 'base64']); });
  const canonical = serialize(contract, archive.contractSha256, members);
  if (!canonical.equals(bytes)) fail('M1A_NONCANONICAL_BUNDLE');
  await inspectMembers(contract, members, supplied);
  return prepared(canonical, contract, archive.contractSha256);
}

async function windowsPrivacy(path) {
  // Read-only ACL, reparse and full registered sync-root inventory; inaccessible
  // provider children are a refusal, never evidence that a path is unsynchronized.
  const script = '$ErrorActionPreference="Stop";$p=$env:M1A_SOURCE_PATH;' +
    '$s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$a=Get-Acl -LiteralPath $p;' +
    '$r=@($a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])|ForEach-Object {' +
    '@{sid=$_.IdentityReference.Value;allow=($_.AccessControlType -eq "Allow");rights=[int]$_.FileSystemRights}});' +
    '$reparse=$false;$v=Get-Item -LiteralPath $p -Force;while($null -ne $v){' +
    'if(([int]$v.Attributes -band 1024) -ne 0){$reparse=$true};if($v -is [System.IO.FileInfo]){$v=$v.Directory}else{$v=$v.Parent}};' +
    '$roots=@();$reg="Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\SyncRootManager";' +
    'if(Test-Path -LiteralPath $reg){foreach($provider in Get-ChildItem -LiteralPath $reg){' +
    '$u=Join-Path $provider.PSPath "UserSyncRoots";if(Test-Path -LiteralPath $u){' +
    '$key=Get-Item -LiteralPath $u;foreach($n in $key.GetValueNames()){$roots+=([string]$key.GetValue($n))}}}};' +
    '@{sid=$s;owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;rules=$r;reparse=$reparse;syncRoots=@($roots)}|ConvertTo-Json -Depth 5 -Compress';
  let facts;
  try {
    const { stdout, stderr } = await execute(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script], { shell: false, windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024,
        env: { ...systemEnv(), M1A_SOURCE_PATH: path } });
    if (stderr) fail('M1A_SOURCE_PRIVACY_UNAVAILABLE'); facts = JSON.parse(stdout);
  } catch { fail('M1A_SOURCE_PRIVACY_UNAVAILABLE'); }
  if (!facts || !Array.isArray(facts.syncRoots) || facts.syncRoots.some(r => typeof r !== 'string' || !isAbsolute(r)) ||
    typeof facts.sid !== 'string' || !/^S-1-[0-9-]+$/.test(facts.sid) || !Array.isArray(facts.rules) || !facts.rules.length ||
    facts.rules.some(r => !r || typeof r.sid !== 'string' || typeof r.allow !== 'boolean' || !Number.isInteger(r.rights)) ||
    typeof facts.reparse !== 'boolean') fail('M1A_SOURCE_PRIVACY_UNAVAILABLE');
  if (facts.reparse || facts.owner !== facts.sid || facts.rules.some(r => r.allow && ![facts.sid, 'S-1-5-18', 'S-1-5-32-544'].includes(r.sid)) ||
    facts.syncRoots.some(r => contained(path, r))) fail('M1A_SOURCE_NOT_PRIVATE');
}
function contained(path, root) {
  const p = resolve(path).toLowerCase(), r = resolve(root).toLowerCase();
  return p === r || p.startsWith(r.endsWith(sep) ? r : r + sep);
}
async function privateStat(path, directory) {
  await privateRoot(dirname(path));
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) ||
    (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()))) fail('M1A_SOURCE_NOT_PRIVATE');
  if (process.platform === 'win32') await windowsPrivacy(path);
  return stat;
}
async function privateRoot(input) {
  if (typeof input !== 'string' || !isAbsolute(input)) fail('M1A_SOURCE_NOT_PRIVATE');
  const path = resolve(input), actual = await realpath(path);
  if (process.platform === 'win32' ? path.toLowerCase() !== actual.toLowerCase() : path !== actual) fail('M1A_SOURCE_NOT_PRIVATE');
  let child;
  for (let p = path;; p = dirname(p)) {
    const stat = await lstat(p);
    if (!stat.isDirectory() || stat.isSymbolicLink() || /(?:^|[\\/])(onedrive[^\\/]*|dropbox|google drive|googledrive|box sync|icloud[^\\/]*|cloudstorage)(?:[\\/]|$)/i.test(p)) fail('M1A_SOURCE_NOT_PRIVATE');
    if (process.platform !== 'win32' && (![0, process.getuid()].includes(stat.uid) ||
      (stat.mode & 0o022) !== 0 && (!(stat.mode & 0o1000) || !child ||
        ![0, process.getuid()].includes(child.uid) || (child.mode & 0o022) !== 0))) fail('M1A_SOURCE_NOT_PRIVATE');
    if (process.platform === 'win32') await windowsPrivacy(p);
    try { await lstat(join(p, '.git')); fail('M1A_SOURCE_NOT_PRIVATE'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    child = stat;
    if (p === dirname(p)) break;
  }
  if (Object.entries(process.env).some(([k, v]) => /onedrive|dropbox|googledrive|google_drive|icloud|box_sync/i.test(k) && v && contained(path, v))) fail('M1A_SOURCE_NOT_PRIVATE');
  const stat = await lstat(path);
  if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())) fail('M1A_SOURCE_NOT_PRIVATE');
  return path;
}
/** Real privacy only; no caller-selected inspector or extra arguments. */
export async function assertPrivateArchiveInputRoot(path) {
  if (arguments.length !== 1) fail('M1A_INVALID_INPUT');
  return privateRoot(path);
}
export async function assertPrivateArchiveInputFile(path) {
  if (arguments.length !== 1 || typeof path !== 'string' || !isAbsolute(path)) fail('M1A_INVALID_INPUT');
  return privateStat(path, false);
}
async function sourceInventory(root, expectedPaths) {
  const found = [], allPaths = new Set();
  const allowedDirs = new Set(expectedPaths.flatMap(p => p.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))));
  async function walk(relative) {
    for await (const entry of await opendir(join(root, relative))) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      safePath(path); const key = path.toLowerCase();
      if (allPaths.has(key)) fail('M1A_DUPLICATE_MEMBER'); allPaths.add(key);
      if (entry.isDirectory()) {
        if (!allowedDirs.has(path)) fail('M1A_INVENTORY_MISMATCH');
        await privateStat(join(root, path), true); await walk(path);
      } else {
        if (!entry.isFile() || !expectedPaths.includes(path)) fail('M1A_INVENTORY_MISMATCH');
        await privateStat(join(root, path), false); found.push(path);
      }
    }
  }
  await walk(''); found.sort(compare);
  if (found.length !== expectedPaths.length || found.some((p, i) => p !== expectedPaths[i])) fail('M1A_INVENTORY_MISMATCH');
}
async function sourceBytes(root, member) {
  const path = join(root, member.path), before = await privateStat(path, false);
  if (before.size !== member.size) fail('M1A_MEMBER_MISMATCH');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const held = await handle.stat();
    if (!held.isFile() || held.ino !== before.ino || held.dev !== before.dev || held.size !== member.size) fail('M1A_MEMBER_MISMATCH');
    const bytes = Buffer.alloc(member.size); let offset = 0;
    while (offset < bytes.length) {
      if ((await handle.stat()).size !== member.size) fail('M1A_MEMBER_MISMATCH');
      const { bytesRead } = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
      if (!bytesRead) fail('M1A_MEMBER_MISMATCH'); offset += bytesRead;
    }
    if ((await handle.read(Buffer.alloc(1), 0, 1, member.size)).bytesRead) fail('M1A_MEMBER_MISMATCH');
    const after = await privateStat(path, false), end = await handle.stat();
    if (after.ino !== held.ino || after.dev !== held.dev || end.size !== member.size || after.size !== member.size ||
      end.mtimeMs !== held.mtimeMs || end.ctimeMs !== held.ctimeMs || digest(bytes) !== member.sha256) fail('M1A_MEMBER_MISMATCH');
    return bytes;
  } finally { await handle.close(); }
}
/**
 * Sources must be private, outside Git/sync roots. No Store calls or disk writes.
 * Windows privacy/registry capability failures refuse source reads without bypass.
 * @param {{contract:ArchiveContract,expectedContractSha256:string,expectedJobs:string[],requiredCategories:string[],root:string,secretCanaries?:string[]}} options
 * @returns {Promise<PreparedArchive>}
 */
export async function prepareArchive(options) {
  try { return await prepareSource(options); }
  catch (e) { fail(/^M1A_[A-Z_]+$/.test(e?.code) ? e.code : 'M1A_INVALID_INPUT'); }
}
async function prepareSource({ contract: input, expectedContractSha256, expectedJobs, requiredCategories, root: inputRoot, secretCanaries } = {}) {
  const supplied = canaries(secretCanaries);
  const contract = canonicalContract(input, expectedContractSha256, expectedJobs, requiredCategories, supplied);
  let root, members;
  try {
    root = await privateRoot(inputRoot);
    const paths = contract.members.map(m => m.path); await sourceInventory(root, paths);
    members = [];
    for (const member of contract.members) {
      const bytes = await sourceBytes(root, member);
      members.push({ path: member.path, sha256: member.sha256, size: member.size, base64: bytes.toString('base64') });
    }
    await sourceInventory(root, paths); await privateRoot(root);
  } catch (e) { if (/^M1A_[A-Z_]+$/.test(e.code)) throw e; fail('M1A_SOURCE_REFUSED'); }
  await inspectMembers(contract, members, supplied);
  return prepared(serialize(contract, expectedContractSha256, members), contract, expectedContractSha256);
}

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve, dirname, basename, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareArchive as prepareSource, assertPrivateArchiveInputRoot, assertPrivateArchiveInputFile } from './lib/m1a-archive/evidence.mjs';
import { createProductionS3ArchiveStore, assertPrivateArchiveOutputRoot, assertPrivateArchiveOutputFile } from './lib/m1a-archive/s3-store.mjs';
import { uploadPreparedArchive } from './lib/m1a-archive/readback.mjs';

const INPUT_LIMIT = 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = code => { throw Object.assign(new Error(code), { code }); };

export function closedInput(value, required, optional = []) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || required.some(k => !Object.hasOwn(value, k)) ||
    Reflect.ownKeys(value).some(k => ![...required, ...optional].includes(k) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), 'value'))) fail('M1A_INPUT_REFUSED');
}
export function parseFlags(argv, names, upload = false) {
  if (!Array.isArray(argv) || argv.some(x => typeof x !== 'string')) fail('M1A_SYNTAX');
  const flags = Object.create(null);
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!names.includes(name) || Object.hasOwn(flags, name)) fail('M1A_SYNTAX');
    if (upload && name === '--allow-upload') flags[name] = true;
    else {
      const value = argv[++i];
      if (!value || value.startsWith('--') || /[\x00-\x1f\x7f]/.test(value) || value.length > 4096) fail('M1A_SYNTAX');
      flags[name] = value;
    }
  }
  if (names.some(k => !Object.hasOwn(flags, k))) fail('M1A_SYNTAX');
  if (upload && !/^[a-f0-9]{64}$/.test(flags['--expected-contract-sha256'])) fail('M1A_SYNTAX');
  return flags;
}
function absoluteFile(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path) || resolve(path) !== path ||
    /[:*?"<>|]/.test(process.platform === 'win32' ? path.slice(2) : path) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)|[. ]$/i.test(basename(path))) fail('M1A_PATH_REFUSED');
  return path;
}
const sameFile = (a, b) => a.ino === b.ino && a.dev === b.dev && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
/** Fixed real private bounded JSON reader, shared by both production entrypoints. */
export async function readPrivateInput(input) {
  if (arguments.length !== 1) fail('M1A_INPUT_REFUSED');
  const path = absoluteFile(input);
  await assertPrivateArchiveInputRoot(dirname(path));
  const before = await assertPrivateArchiveInputFile(path);
  if (before.nlink !== 1 || before.size < 1 || before.size > INPUT_LIMIT) fail('M1A_INPUT_BOUND');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const held = await handle.stat();
    if (!sameFile(before, held)) fail('M1A_INPUT_CHANGED');
    const bytes = Buffer.alloc(held.size); let offset = 0;
    while (offset < bytes.length) {
      if (!sameFile(held, await handle.stat())) fail('M1A_INPUT_CHANGED');
      const { bytesRead } = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (!bytesRead) fail('M1A_INPUT_CHANGED'); offset += bytesRead;
    }
    if ((await handle.read(Buffer.alloc(1), 0, 1, held.size)).bytesRead || !sameFile(held, await handle.stat()) ||
      !sameFile(held, await assertPrivateArchiveInputFile(path))) fail('M1A_INPUT_CHANGED');
    await assertPrivateArchiveInputRoot(dirname(path));
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); }
    catch { fail('M1A_INPUT_REFUSED'); }
  } finally { await handle.close(); }
}
/** Reserves an empty file before store construction. Never removes or overwrites it. */
export async function reservePrivateOutput(input) {
  if (arguments.length !== 1) fail('M1A_INPUT_REFUSED');
  const path = absoluteFile(input), parent = dirname(path);
  await assertPrivateArchiveOutputRoot(parent);
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  let initial;
  try {
    initial = await assertPrivateArchiveOutputFile(path, handle);
    if (initial.nlink !== 1 || initial.size !== 0) fail('M1A_OUTPUT_REFUSED');
    await assertPrivateArchiveOutputRoot(parent);
  } catch (e) { await handle.close(); throw e; }
  let written = false;
  return {
    async write(value) {
      if (written) fail('M1A_OUTPUT_REFUSED'); written = true;
      const bytes = Buffer.from(JSON.stringify(value) + '\n');
      if (bytes.length > INPUT_LIMIT) fail('M1A_OUTPUT_REFUSED');
      await assertPrivateArchiveOutputRoot(parent);
      if (!sameFile(initial, await assertPrivateArchiveOutputFile(path, handle))) fail('M1A_OUTPUT_REFUSED');
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
        if (!bytesWritten) fail('M1A_OUTPUT_REFUSED'); offset += bytesWritten;
      }
      await handle.sync();
      const final = await assertPrivateArchiveOutputFile(path, handle);
      if (final.nlink !== 1 || final.size !== bytes.length) fail('M1A_OUTPUT_REFUSED');
      await assertPrivateArchiveOutputRoot(parent);
    },
    async close() { await handle.close(); }
  };
}
export function commandFailure(exitCode, ref) {
  return { exitCode, result: { error: exitCode === 2 ? 'M1A_SYNTAX' : 'M1A_COMMAND_REFUSED', ...ref ? { ref: { ...ref } } : {} } };
}
function knownRef(ref, expected) {
  const i = expected?.identity;
  if (!i || !ref || Object.keys(ref).length !== 2 || ref.key !== `replatform/m1a/${i.campaignId}/${i.runId}-r${i.runAttempt}/${i.qaAttempt}/${expected.sha256}.json` ||
    typeof ref.versionId !== 'string' || !ref.versionId.trim() || ref.versionId === 'null' || ref.versionId.startsWith('-') || /[\x00-\x20\x7f]/.test(ref.versionId)) return undefined;
  return { key: ref.key, versionId: ref.versionId };
}
function inventory(input, contract) {
  closedInput(input, ['sourceInventorySha256', 'expectedJobs', 'requiredCategories'], ['secretCanaries']);
  for (const k of ['expectedJobs', 'requiredCategories']) {
    if (!Array.isArray(input[k]) || !input[k].length || input[k].length > 128 || new Set(input[k]).size !== input[k].length ||
      input[k].some(s => typeof s !== 'string' || !s.trim() || s.length > 256 || /[\x00-\x1f\x7f]/.test(s))) fail('M1A_INPUT_REFUSED');
  }
  if (input.secretCanaries !== undefined && (!Array.isArray(input.secretCanaries) || input.secretCanaries.length > 128 ||
    input.secretCanaries.some(s => typeof s !== 'string' || !s || s.length > 4096))) fail('M1A_INPUT_REFUSED');
  if (contract?.classification !== 'M1A_ARCHIVE_INPUT' || !Array.isArray(contract.members) || contract.members.length > 128 ||
    typeof input.sourceInventorySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sourceInventorySha256)) fail('M1A_INPUT_REFUSED');
  const descriptors = contract.members.map(m => Object.fromEntries(['path', 'sha256', 'size', 'format', 'artifactId', 'category'].map(k => [k, m[k]])))
    .sort((a, b) => compare(a.path, b.path));
  if (hash(JSON.stringify(descriptors)) !== input.sourceInventorySha256 || contract.redactionReview?.sourceInventorySha256 !== input.sourceInventorySha256) fail('M1A_INPUT_REFUSED');
  return { expectedJobs: [...input.expectedJobs], requiredCategories: [...input.requiredCategories],
    ...input.secretCanaries !== undefined ? { secretCanaries: [...input.secretCanaries] } : {} };
}
/** Injected capabilities are offline library seams only. writeExclusive reserves before store creation. */
export async function runArchiveCommand(argv, dependencies) {
  let flags;
  try { flags = parseFlags(argv, ['--contract', '--expected-contract-sha256', '--inventory', '--input-root', '--scratch-root', '--output', '--allow-upload'], true); }
  catch { return commandFailure(2); }
  let expected, ref;
  try {
    closedInput(dependencies, ['readInput', 'prepareArchive', 'createStore', 'writeExclusive', 'now']);
    const { readInput, prepareArchive, createStore, writeExclusive, now } = dependencies;
    const contract = structuredClone(await readInput(flags['--contract']));
    const policy = inventory(structuredClone(await readInput(flags['--inventory'])), contract);
    const source = await prepareArchive({ contract, expectedContractSha256: flags['--expected-contract-sha256'], ...policy, root: flags['--input-root'] });
    const prepared = { ...structuredClone({ ...source, bytes: undefined }), bytes: Buffer.from(source.bytes) };
    expected = { contractSha256: prepared.contractSha256, sha256: prepared.sha256, size: prepared.size,
      identity: structuredClone(prepared.identity), requiredRetainUntil: prepared.requiredRetainUntil, ...policy };
    const reservation = await writeExclusive(flags['--output']);
    try {
      const store = await createStore({ privateScratch: flags['--scratch-root'], now });
      const facts = await uploadPreparedArchive({ store, prepared, expected, now });
      ref = knownRef({ key: facts.destination.key, versionId: facts.destination.versionId }, expected);
      await reservation.write(facts);
      return { exitCode: 0, result: facts };
    } catch (error) {
      ref ??= knownRef(error?.ref, expected);
      throw error;
    } finally { await reservation.close(); }
  } catch (error) { return commandFailure(1, ref ?? knownRef(error?.ref, expected)); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outcome = await runArchiveCommand(process.argv.slice(2), { readInput: readPrivateInput, prepareArchive: prepareSource,
    createStore: async ({ privateScratch, now }) => {
      await assertPrivateArchiveOutputRoot(privateScratch);
      return createProductionS3ArchiveStore({ mode: 'upload', privateScratch, now });
    }, writeExclusive: reservePrivateOutput, now: () => new Date() });
  process.stdout.write(JSON.stringify(outcome.result) + '\n'); process.exitCode = outcome.exitCode;
}

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createProductionS3ArchiveStore, assertPrivateArchiveOutputRoot } from './lib/m1a-archive/s3-store.mjs';
import { verifyStoredArchive } from './lib/m1a-archive/readback.mjs';
import { closedInput, parseFlags, readPrivateInput, reservePrivateOutput, commandFailure } from './m1a-archive.mjs';

/** Expected input is {ref,expected}, pinned externally rather than derived from facts. */
export async function runVerifyArchiveCommand(argv, dependencies) {
  let flags;
  try { flags = parseFlags(argv, ['--facts', '--expected', '--authority', '--scratch-root', '--output']); }
  catch { return commandFailure(2); }
  try {
    closedInput(dependencies, ['readInput', 'createReadOnlyStore', 'writeExclusive', 'now']);
    const { readInput, createReadOnlyStore, writeExclusive, now } = dependencies;
    const uploadFacts = structuredClone(await readInput(flags['--facts']));
    const pinned = structuredClone(await readInput(flags['--expected']));
    closedInput(pinned, ['ref', 'expected']);
    const authority = structuredClone(await readInput(flags['--authority']));
    if (uploadFacts?.classification !== 'M1A_ARCHIVE_FACTS') return commandFailure(1);
    const reservation = await writeExclusive(flags['--output']);
    try {
      const store = await createReadOnlyStore({ privateScratch: flags['--scratch-root'], now });
      const result = await verifyStoredArchive({ store, ...pinned, authority, uploadFacts, now });
      await reservation.write(result); return { exitCode: 0, result };
    } finally { await reservation.close(); }
  } catch { return commandFailure(1); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outcome = await runVerifyArchiveCommand(process.argv.slice(2), { readInput: readPrivateInput,
    createReadOnlyStore: async ({ privateScratch, now }) => {
      await assertPrivateArchiveOutputRoot(privateScratch);
      return createProductionS3ArchiveStore({ mode: 'verify', privateScratch, now });
    }, writeExclusive: reservePrivateOutput, now: () => new Date() });
  process.stdout.write(JSON.stringify(outcome.result) + '\n'); process.exitCode = outcome.exitCode;
}

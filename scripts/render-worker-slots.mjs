import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { renderWorkerSlots } from './lib/worker-slot-inventory.mjs';

export function renderWorkerSlotsFile(filename) {
  if (!filename || !statSync(filename).isFile() || statSync(filename).size > 1024 * 1024) throw new Error('invalid inventory file');
  return renderWorkerSlots(JSON.parse(readFileSync(filename, 'utf8')));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('usage');
    process.stdout.write(renderWorkerSlotsFile(process.argv[2]));
  } catch { process.stderr.write('Worker slot inventory rejected; no manifest emitted.\n'); process.exitCode = 1; }
}

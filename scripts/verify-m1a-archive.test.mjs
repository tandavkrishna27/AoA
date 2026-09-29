import test from 'node:test';
import assert from 'node:assert/strict';

const args = ['--facts', '/facts', '--expected', '/expected', '--authority', '/authority', '--scratch-root', '/scratch', '--output', '/review'];
test('verify_closed_flags_refuse_missing_duplicate_and_cloud_write_intents', async () => {
  const { runVerifyArchiveCommand } = await import('./verify-m1a-archive.mjs');
  for (const argv of [args.slice(0, -1), [...args, '--facts', '/other'], [...args, '--allow-upload'], [...args, '--endpoint', 'x'], [...args, '--promote']]) {
    let touched = false;
    const r = await runVerifyArchiveCommand(argv, { readInput: async () => { touched = true; }, createReadOnlyStore: async () => { touched = true; }, writeExclusive: async () => { touched = true; }, now: () => new Date() });
    assert.equal(r.exitCode, 2); assert.equal(touched, false);
  }
});
test('verify_cli_has_no_write_cloud_operation_and_requires_external_ref', async () => {
  const { runVerifyArchiveCommand } = await import('./verify-m1a-archive.mjs');
  let writes = 0;
  const r = await runVerifyArchiveCommand(args, { readInput: async p => p === '/facts' ? { classification: 'DEV_ONLY' } : {},
    createReadOnlyStore: async () => ({ put: async () => { writes++; } }), writeExclusive: async () => ({ write: async () => { writes++; }, close: async () => {} }), now: () => new Date() });
  assert.equal(r.exitCode, 1); assert.equal(writes, 0);
});

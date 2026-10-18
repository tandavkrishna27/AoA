import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runProbe } from '../../d4-service-availability.mjs';

const cli = fileURLToPath(new URL('../../d4-service-availability.mjs', import.meta.url));
test('CLI freezes actual time, preserves immutable attempts and reports suppressed probes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aoa-d4-cli-'));
  try {
    const start = Math.ceil((Date.now() + 60_000) / 60_000) * 60_000;
    const input = { campaignId: 'cli', candidate: 'revision', timezone: 'UTC', start: new Date(start).toISOString(), end: new Date(start + 120_000).toISOString(),
      frozenAt: '2000-01-01T00:00:00.000Z', dimensions: [{ organizationId: 'org', workload: 'service', target: 'target', provider: 'local', revision: 'revision' }], workloadSlosMs: { service: 60_000 } };
    const inputPath = join(dir, 'input.json'), manifestPath = join(dir, 'manifest.json'), samplesPath = join(dir, 'samples.ndjson'), reportPath = join(dir, 'report.json');
    await writeFile(inputPath, JSON.stringify(input));
    const invoke = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true });
    const freeze = invoke(['freeze', inputPath, manifestPath]); assert.equal(freeze.status, 0, freeze.stderr);
    const m = JSON.parse(await readFile(manifestPath, 'utf8')); assert.ok(Date.parse(m.frozenAt) > Date.parse(input.frozenAt));
    assert.equal(invoke(['freeze', inputPath, manifestPath]).status, 1, 'must not overwrite a committed attempt');
    await writeFile(samplesPath, '');
    const evaluate = invoke(['evaluate', manifestPath, samplesPath, reportPath]); assert.equal(evaluate.status, 1);
    const r = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.deepEqual([r.expected, r.observed, r.missing, r.numerator, r.denominator], [2, 0, 2, 0, 2]);
    assert.equal(r.fullD4Acceptance, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
for (const [name, source, reason] of [
  ['timeout', 'setInterval(() => {}, 1000);', 'probe_timeout'],
  ['exit failure', 'process.exit(2);', 'probe_exit_failure'],
  ['invalid JSON', 'console.log("broken");', 'probe_invalid_json'],
]) test('actual subprocess ' + name + ' is retained as failed evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aoa-d4-probe-'));
  try {
    const path = join(dir, 'probe.mjs'); await writeFile(path, source);
    const result = await runProbe(path, { sampleId: 'test', scheduledAt: new Date().toISOString(), dimensions: {} }, name === 'timeout' ? 100 : 5000);
    assert.equal(result.success, false); assert.equal(result.telemetryComplete, false); assert.equal(result.reason, reason); assert.ok(result.observedAt);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('adapter cannot rewrite its frozen sample identity/dimensions or submission timestamp', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aoa-d4-probe-'));
  try {
    const path = join(dir, 'probe.mjs');
    await writeFile(path, 'console.log(JSON.stringify({ success: true, sampleId: "forged", dimensions: {}, submittedAt: "2000-01-01T00:00:00.000Z" }));');
    const expected = { sampleId: 'original', scheduledAt: new Date().toISOString(), dimensions: { organizationId: 'org' } };
    const result = await runProbe(path, expected);
    assert.equal(result.sampleId, expected.sampleId); assert.deepEqual(result.dimensions, expected.dimensions); assert.notEqual(result.submittedAt, '2000-01-01T00:00:00.000Z');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

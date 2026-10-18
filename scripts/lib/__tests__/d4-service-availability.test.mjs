import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runProbe } from '../../d4-service-availability.mjs';
import { freezeAvailabilitySchedule, evaluateAvailability } from '../availability-measurements.mjs';

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
test('adapter cannot rewrite frozen identity and backdated operation submission fails closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aoa-d4-probe-'));
  try {
    const path = join(dir, 'probe.mjs');
    await writeFile(path, 'console.log(JSON.stringify({ success: true, sampleId: "forged", dimensions: {}, submittedAt: "2000-01-01T00:00:00.000Z" }));');
    const expected = { sampleId: 'original', scheduledAt: new Date().toISOString(), dimensions: { organizationId: 'org' } };
    const result = await runProbe(path, expected);
    assert.equal(result.sampleId, expected.sampleId); assert.deepEqual(result.dimensions, expected.dimensions);
    assert.equal(result.submittedAt, '2000-01-01T00:00:00.000Z');
    assert.equal(result.success, false); assert.equal(result.telemetryComplete, false); assert.ok(result.driverStartedAt);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
for (const [name, submittedOffset, expectedNumerator] of [['actual submission after scheduled minute', 60_010, 0], ['honest actual submission in scheduled minute', 59_950, 1]]) {
  test(name + ' retains actual timestamp and evaluates operation timing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aoa-d4-submission-'));
    try {
      const start = Date.parse('2026-10-19T00:00:00.000Z');
      const m = freezeAvailabilitySchedule({ campaignId: 'actual-submit', mode: 'D4', candidate: 'rev', timezone: 'UTC', frozenAt: '2026-10-18T00:00:00.000Z',
        start: new Date(start).toISOString(), end: new Date(start + 60_000).toISOString(), workloadSlosMs: { service: 60_000 },
        dimensions: [{ organizationId: 'org', workload: 'service', target: 'target', provider: 'local', revision: 'rev' }] });
      const actual = new Date(start + submittedOffset).toISOString();
      const resultBody = { success: true, reason: 'durable_readback', telemetryComplete: true, submittedAt: actual,
        readbackAt: new Date(start + submittedOffset + 10).toISOString(), durableSuccess: true, authorizedReadback: true,
        fencedInstanceCount: 1, healthCurrent: true, generation: 'g1', desiredGeneration: 'g1' };
      const path = join(dir, 'probe.mjs'); await writeFile(path, `console.log(${JSON.stringify(JSON.stringify(resultBody))});`);
      let clockCalls = 0;
      const result = await runProbe(path, m.expected[0], 5000, { now: () => start + (clockCalls++ === 0 ? 59_900 : 60_100) });
      assert.equal(result.driverStartedAt, new Date(start + 59_900).toISOString());
      assert.equal(result.submittedAt, actual, 'must preserve adapter actual operation submission');
      const report = evaluateAvailability(m, [result]);
      assert.equal(report.numerator, expectedNumerator); assert.equal(report.denominator, 1); assert.equal(report.passed, expectedNumerator === 1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
for (const submittedAt of [undefined, 'invalid', '2099-01-01T00:00:00.000Z']) test('missing/invalid/future actual submission cannot count as successful: ' + submittedAt, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aoa-d4-invalid-submission-'));
  try {
    const path = join(dir, 'probe.mjs'); await writeFile(path, `console.log(${JSON.stringify(JSON.stringify({ success: true, telemetryComplete: true, submittedAt }))});`);
    const result = await runProbe(path, { sampleId: 'test', scheduledAt: new Date().toISOString(), dimensions: {} });
    assert.equal(result.success, false); assert.equal(result.telemetryComplete, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

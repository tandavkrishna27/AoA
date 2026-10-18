#!/usr/bin/env node
// A schedule/collection/SLI driver, not a complete D4 acceptance campaign.
import { readFile, writeFile, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { freezeAvailabilitySchedule, evaluateAvailability, scheduleHash } from './lib/availability-measurements.mjs';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const exclusiveJson = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
export async function runProbe(probePath, expected, timeoutMs = 60_000) {
  const submittedAt = new Date().toISOString();
  return new Promise(resolveProbe => {
    const child = spawn(process.execPath, [resolve(probePath)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '', overflow = false, completed = false;
    const timer = setTimeout(() => { child.kill(); finish({ success: false, telemetryComplete: false, reason: 'probe_timeout' }); }, timeoutMs);
    function finish(result) {
      if (completed) return; completed = true; clearTimeout(timer);
      resolveProbe({ ...result, ...expected, submittedAt, observedAt: new Date().toISOString() });
    }
    child.stdout.on('data', chunk => { if (output.length + chunk.length > 1024 * 1024) { overflow = true; child.kill(); } else output += chunk; });
    // Drain stderr without persisting credentials or unbounded adapter diagnostics.
    child.stderr.on('data', () => {});
    child.on('error', () => finish({ success: false, telemetryComplete: false, reason: 'probe_start_failed' }));
    child.on('close', code => {
      if (code !== 0 || overflow) return finish({ success: false, telemetryComplete: false, reason: overflow ? 'probe_output_limit' : 'probe_exit_failure' });
      try { const result = JSON.parse(output); if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error(); finish(result); }
      catch { finish({ success: false, telemetryComplete: false, reason: 'probe_invalid_json' }); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ ...expected, submittedAt }) + '\n');
  });
}
export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (command === 'freeze' && args.length === 2) {
    const input = await readJson(args[0]);
    // The CLI timestamps the actual freeze; callers cannot backdate this field.
    const m = freezeAvailabilitySchedule({ ...input, mode: 'D4', frozenAt: new Date().toISOString() });
    await exclusiveJson(args[1], m); return;
  }
  if (command === 'evaluate' && args.length >= 3 && args.length <= 4) {
    const [manifestPath, samplesPath, reportPath, faultsPath] = args;
    const m = await readJson(manifestPath);
    const samples = (await readFile(samplesPath, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const report = evaluateAvailability(m, samples, { faults: faultsPath ? await readJson(faultsPath) : [] });
    await exclusiveJson(reportPath, report);
    process.exitCode = report.passed ? 0 : 1;
    return;
  }
  if (command === 'collect' && args.length === 3) {
    const [manifestPath, samplesPath, probePath] = args;
    const m = await readJson(manifestPath);
    if (m.mode !== 'D4' || m.scheduleHash !== scheduleHash(m)) throw Error('D4 frozen schedule hash mismatch');
    // Reconstruct and validate before collecting. Missing samples are expected here.
    evaluateAvailability(m, [], { faults: m.scheduledExclusions.map(f => ({ faultId: f.faultId, effectiveAt: f.scheduledAt, removedAt: new Date(Date.parse(f.scheduledAt) + f.durationMs).toISOString() })) });
    if (Date.now() >= Date.parse(m.start)) throw Error('Collection must start before the frozen campaign start; create a new attempt');
    const raw = await open(samplesPath, 'wx');
    try {
      for (let i = 0; i < m.expected.length;) {
        const scheduledAt = m.expected[i].scheduledAt;
        while (Date.now() < Date.parse(scheduledAt)) await new Promise(r => setTimeout(r, Math.min(1000, Date.parse(scheduledAt) - Date.now())));
        const cohort = [];
        while (i < m.expected.length && m.expected[i].scheduledAt === scheduledAt) cohort.push(m.expected[i++]);
        // Never silently backfill a suppressed/late minute. Its absence fails SLI-04.
        if (Date.now() >= Date.parse(scheduledAt) + 60_000) continue;
        const results = await Promise.all(cohort.map(expected => runProbe(probePath, expected)));
        for (const result of results) { await raw.write(JSON.stringify(result) + '\n'); await raw.sync(); }
      }
    } finally { await raw.close(); }
    return;
  }
  throw Error('Usage: d4-service-availability.mjs freeze input.json manifest.json | collect manifest.json samples.ndjson probe.mjs | evaluate manifest.json samples.ndjson report.json [actual-faults.json]');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });

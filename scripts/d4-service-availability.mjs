#!/usr/bin/env node
// A schedule/collection/SLI driver, not a complete D4 acceptance campaign.
import { readFile, writeFile, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { freezeAvailabilitySchedule, evaluateAvailability, scheduleHash } from './lib/availability-measurements.mjs';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const exclusiveJson = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
export async function runProbe(probePath, expected, timeoutMs, { now = Date.now } = {}) {
  const driverStartedAt = new Date(now()).toISOString();
  // Submission may occur anywhere in the scheduled minute; its readback then
  // has its own 60s SLO. Allow bounded local reporting after the last admissible
  // readback. This collection limit never changes the verdict's actual 60s SLO.
  const collectionDeadline = Date.parse(expected.scheduledAt) + 60_000 + 60_000 + 5000;
  const adapterTimeoutMs = timeoutMs ?? Math.max(1, collectionDeadline - Date.parse(driverStartedAt));
  return new Promise(resolveProbe => {
    const child = spawn(process.execPath, [resolve(probePath)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '', overflow = false, completed = false;
    const timer = setTimeout(() => { child.kill(); finish({ success: false, telemetryComplete: false, reason: 'probe_timeout' }); }, adapterTimeoutMs);
    function finish(result) {
      if (completed) return; completed = true; clearTimeout(timer);
      const observedAt = new Date(now()).toISOString();
      const submitted = typeof result.submittedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result.submittedAt) ? Date.parse(result.submittedAt) : NaN;
      const validSubmission = Number.isFinite(submitted) && submitted >= Date.parse(driverStartedAt) && submitted <= Date.parse(observedAt);
      if ((result.success === true || result.telemetryComplete === true) && !validSubmission) {
        result = { ...result, success: false, telemetryComplete: false, reason: 'probe_invalid_actual_submission' };
      }
      resolveProbe({ ...result, ...expected, driverStartedAt, observedAt });
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
    child.stdin.end(JSON.stringify({ ...expected, driverStartedAt }) + '\n');
  });
}
export async function collectAvailabilitySamples(expected, execute, persist, { now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const pending = new Set();
  let writes = Promise.resolve(), failure;
  try {
    for (const sample of expected) {
      const scheduled = Date.parse(sample.scheduledAt);
      while (now() < scheduled) await sleep(Math.min(1000, scheduled - now()));
      if (failure) throw failure;
      // Never backfill suppressed minutes. A prior adapter may still be inside
      // its valid readback window, so it cannot hold the next scheduled probe.
      if (now() >= scheduled + 60_000) continue;
      const collecting = Promise.resolve(execute(sample)).then(result => {
        writes = writes.then(() => persist(result));
        return writes;
      }).catch(error => { failure ??= error; });
      pending.add(collecting);
      collecting.then(() => pending.delete(collecting));
    }
  } finally {
    // Keep the raw file open until every bounded adapter and serialized write
    // settles, including the last minute's legitimate post-boundary readback.
    await Promise.all(pending);
  }
  if (failure) throw failure;
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
      await collectAvailabilitySamples(m.expected, expected => runProbe(probePath, expected), async result => {
        await raw.write(JSON.stringify(result) + '\n'); await raw.sync();
      });
    } finally { await raw.close(); }
    return;
  }
  throw Error('Usage: d4-service-availability.mjs freeze input.json manifest.json | collect manifest.json samples.ndjson probe.mjs | evaluate manifest.json samples.ndjson report.json [actual-faults.json]');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });

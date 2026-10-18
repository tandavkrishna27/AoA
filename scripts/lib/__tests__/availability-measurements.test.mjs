import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeAvailabilitySchedule, evaluateAvailability, scheduleHash } from '../availability-measurements.mjs';

const start = '2026-10-19T00:00:00.000Z';
const dimensions = { organizationId: 'org-a', workload: 'service', target: 'worker-a', provider: 'device', revision: 'a'.repeat(40) };
function manifest(minutes = 200, extra = {}) {
  return freezeAvailabilitySchedule({ campaignId: 'test', candidate: dimensions.revision, mode: 'D4', start,
    end: new Date(Date.parse(start) + minutes * 60_000).toISOString(), frozenAt: '2026-10-18T23:00:00.000Z',
    timezone: 'UTC', dimensions: [dimensions], workloadSlosMs: { service: 60_000 }, ...extra });
}
function samples(m) {
  return m.expected.map(e => ({ ...e, observedAt: new Date(Date.parse(e.scheduledAt) + 1000).toISOString(),
    submittedAt: e.scheduledAt, readbackAt: new Date(Date.parse(e.scheduledAt) + 1000).toISOString(),
    success: true, reason: 'durable_authorized_readback', telemetryComplete: true, durableSuccess: true,
    authorizedReadback: true, fencedInstanceCount: 1, generation: 'g1', desiredGeneration: 'g1', healthCurrent: true }));
}
test('frozen schedule has every UTC minute, dimensions and independently reproducible hash', () => {
  const m = manifest();
  assert.equal(m.expected.length, 200);
  assert.equal(m.scheduleHash, scheduleHash(m));
  assert.equal(m.expected[199].scheduledAt, '2026-10-19T03:19:00.000Z');
  const r = evaluateAvailability(m, samples(m));
  assert.deepEqual([r.expected, r.observed, r.missing, r.numerator, r.denominator, r.excluded], [200, 200, 0, 200, 200, 0]);
  assert.equal(r.passed, true);
  assert.equal(r.fullD4Acceptance, false);
});
for (const [name, mutate] of [
  ['suppressed probe', s => s.splice(30, 1)],
  ['missing dimension', s => delete s[0].dimensions.provider],
  ['telemetry gap', s => s[0].telemetryComplete = false],
  ['missing observation timestamp', s => delete s[0].observedAt],
  ['missing submission timestamp', s => delete s[0].submittedAt],
  ['missing successful readback timestamp', s => delete s[0].readbackAt],
  ['readback after observation', s => s[0].readbackAt = new Date(Date.parse(start) + 2000).toISOString()],
  ['candidate mismatch', s => s[0].dimensions.revision = 'other'],
]) test(name + ' fails evidence integrity', () => {
  const m = manifest(); const s = structuredClone(samples(m)); mutate(s);
  const r = evaluateAvailability(m, s);
  assert.equal(r.passed, false); assert.equal(r.evidenceComplete, false);
  assert.equal(r.denominator, 200); assert.equal(r.numerator, 199);
});
test('late success remains a failed normal sample and exact 99.5 percent passes', () => {
  const m = manifest(); const s = samples(m); s[0].readbackAt = new Date(Date.parse(start) + 60_001).toISOString(); s[0].observedAt = s[0].readbackAt;
  const r = evaluateAvailability(m, s);
  assert.deepEqual([r.numerator, r.denominator, r.missing], [199, 200, 0]);
  assert.equal(r.evidenceComplete, true); assert.equal(r.passed, true);
});
test('below threshold cohort fails unchanged 99.5 percent gate', () => {
  const m = manifest(); const s = samples(m); s[0].success = false; s[1].success = false;
  const r = evaluateAvailability(m, s); assert.equal(r.numerator, 198); assert.equal(r.passed, false);
});
test('identical duplicates do not inflate numerator, denominator or observed', () => {
  const m = manifest(); const s = samples(m); s.push(structuredClone(s[0])); const r = evaluateAvailability(m, s);
  assert.deepEqual([r.observed, r.duplicateReports, r.numerator, r.denominator], [200, 1, 200, 200]); assert.equal(r.passed, true);
});
test('conflicting duplicate fails evidence instead of choosing the favourable report', () => {
  const m = manifest(); const s = samples(m); s.push({ ...s[0], success: false });
  const r = evaluateAvailability(m, s); assert.equal(r.evidenceComplete, false); assert.equal(r.numerator, 199);
});
for (const [name, field, value] of [
  ['overlapping fences', 'fencedInstanceCount', 2], ['no fence', 'fencedInstanceCount', 0],
  ['wrong generation', 'generation', 'old'], ['stale health', 'healthCurrent', false],
  ['unauthorized readback', 'authorizedReadback', false], ['non-durable result', 'durableSuccess', false],
  ['before scheduled minute', 'submittedAt', '2026-10-18T23:59:59.999Z'],
  ['outside scheduled minute', 'submittedAt', '2026-10-19T00:01:00.000Z'],
  ['readback precedes submission', 'readbackAt', '2026-10-18T23:59:59.999Z'],
]) test(name + ' is never a successful minute', () => {
  const m = manifest(1); const s = samples(m); s[0][field] = value;
  const r = evaluateAvailability(m, s); assert.equal(r.numerator, 0); assert.equal(r.denominator, 1); assert.equal(r.passed, false);
});
test('schedule omission cannot be hidden by recomputing hash', () => {
  const m = manifest(); m.expected.splice(0, 1); m.scheduleHash = scheduleHash(m);
  assert.throws(() => evaluateAvailability(m, samples(m)), /schedule/);
});
test('changing frozen dimensions or hash is rejected', () => {
  const m = manifest(); m.dimensions[0].provider = 'changed';
  assert.throws(() => evaluateAvailability(m, samples(m)), /hash/);
});
for (const extra of [ { start: '2026-10-19T00:00:01.000Z' }, { timezone: 'Asia/Kolkata' },
  { frozenAt: '2026-10-19T00:00:00.001Z' }, { workloadSlosMs: { service: 61_000 } },
  { dimensions: [{ ...dimensions, provider: '' }] } ]) test('invalid manifest fails closed: ' + JSON.stringify(extra), () => assert.throws(() => manifest(200, extra)));

const scheduledExclusions = [
  { faultId: 'partition', kind: 'worker_control_plane_partition', scheduledAt: '2026-10-19T00:10:00.000Z', durationMs: 900_000 },
  { faultId: 'provider', kind: 'provider_pause_or_forced_outage', scheduledAt: '2026-10-19T00:40:00.000Z', durationMs: 900_000 },
];
const faults = scheduledExclusions.map(f => ({ faultId: f.faultId, effectiveAt: f.scheduledAt, removedAt: new Date(Date.parse(f.scheduledAt) + f.durationMs).toISOString() }));
test('only measured scheduled 15 minute fault intervals exclude minutes, half-open boundaries', () => {
  const m = manifest(200, { scheduledExclusions }); const s = samples(m); s[10].success = false; s[24].success = false;
  const r = evaluateAvailability(m, s, { faults });
  assert.deepEqual([r.expected, r.observed, r.missing, r.excluded, r.denominator, r.numerator], [200, 200, 0, 30, 170, 170]);
  assert.equal(r.passed, true); assert.equal(r.exclusionReasons.partition, 15);
  s[25].success = false; const boundary = evaluateAvailability(m, s, { faults });
  assert.equal(boundary.numerator, 169); assert.equal(boundary.denominator, 170); assert.equal(boundary.passed, false);
});
test('missing sample even in exclusion fails SLI-04', () => {
  const m = manifest(200, { scheduledExclusions }); const s = samples(m); s.splice(10, 1);
  const r = evaluateAvailability(m, s, { faults }); assert.equal(r.missing, 1); assert.equal(r.passed, false);
});
test('actual fault timestamps control exclusions, including sub-minute boundaries', () => {
  const m = manifest(200, { scheduledExclusions });
  const actual = structuredClone(faults); actual[0].effectiveAt = '2026-10-19T00:10:00.001Z'; actual[0].removedAt = '2026-10-19T00:25:00.001Z';
  const s = samples(m); s[10].success = false; s[25].success = false;
  const r = evaluateAvailability(m, s, { faults: actual }); assert.equal(r.numerator, 169); assert.equal(r.denominator, 170);
});
test('unscheduled faults and widened actual exclusions fail closed', () => {
  const m = manifest(200, { scheduledExclusions });
  assert.throws(() => evaluateAvailability(m, samples(m), { faults: [...faults, { faultId: 'restart', ...faults[0] }] .map((f,i) => i === 2 ? { ...f, faultId:'restart' } : f) }), /exclusion/);
  assert.throws(() => evaluateAvailability(m, samples(m), { faults: [{ ...faults[0], removedAt: '2026-10-19T00:26:00.000Z' }, faults[1]] }), /15.minute/);
});
for (const kind of ['restart', 'drain', 'generation_update', 'checkpoint_restore', 'budget_stop']) test(kind + ' cannot become an exclusion', () => {
  assert.throws(() => manifest(200, { scheduledExclusions: [{ ...scheduledExclusions[0], kind }] }), /exclusion/);
});
test('separate cohort cannot hide below threshold availability', () => {
  const m = manifest(200, { dimensions: [dimensions, { ...dimensions, organizationId: 'org-b' }] }); const s = samples(m);
  const bad = s.filter(x => x.dimensions.organizationId === 'org-b'); bad[0].success = false; bad[1].success = false;
  const r = evaluateAvailability(m, s); assert.equal(r.numerator, 398); assert.equal(r.denominator, 400); assert.equal(r.passed, false);
});

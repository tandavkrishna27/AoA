import { createHash } from 'node:crypto';

const MINUTE = 60_000;
const DIMENSIONS = ['organizationId', 'workload', 'target', 'provider', 'revision'];
const EXCLUSIONS = ['worker_control_plane_partition', 'provider_pause_or_forced_outage'];
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])]));
  return value;
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error('Invalid UTC timestamp');
  return Date.parse(value);
}
function check(condition, message) { if (!condition) throw Error(message); }
export function scheduleHash(manifest) {
  const { scheduleHash: ignored, ...body } = manifest;
  return createHash('sha256').update(canonical(body)).digest('hex');
}
function expectedSamples(manifest) {
  const expected = [];
  const interval = manifest.mode === 'D4' ? MINUTE : manifest.intervalMs;
  for (let time = instant(manifest.start); time < instant(manifest.end); time += interval) {
    for (let i = 0; i < manifest.dimensions.length; i++) expected.push({ sampleId: `${time}:${i}`, scheduledAt: new Date(time).toISOString(), dimensions: structuredClone(manifest.dimensions[i]) });
  }
  return expected;
}
function validateBody(m) {
  check(m.version === 1 && ['D4', 'D6'].includes(m.mode), 'Invalid schedule version/mode');
  check(typeof m.campaignId === 'string' && m.campaignId.length > 0 && typeof m.candidate === 'string' && m.candidate.length > 0, 'Missing campaign/candidate');
  const start = instant(m.start), end = instant(m.end);
  check(m.timezone === 'UTC' && start % MINUTE === 0 && end % MINUTE === 0 && end > start, 'Schedule requires UTC-aligned minutes');
  check(instant(m.frozenAt) <= start, 'Schedule must be frozen before campaign start');
  check(Array.isArray(m.dimensions) && m.dimensions.length > 0, 'Missing dimensions');
  check(new Set(m.dimensions.map(canonical)).size === m.dimensions.length, 'Duplicate schedule dimensions');
  for (const d of m.dimensions) {
    const keys = m.mode === 'D6' ? [...DIMENSIONS, 'rowId', 'os', 'osVersion', 'credentialBindingMode', 'localityMode', 'fallbackMode', 'mobilityMode', 'handoffDirection'] : DIMENSIONS;
    check(keys.every(k => typeof d[k] === 'string' && d[k].trim().length > 0) && d.revision === m.candidate, 'Missing/invalid schedule dimension or candidate');
    check(Number.isFinite(m.workloadSlosMs[d.workload]) && m.workloadSlosMs[d.workload] > 0, 'Missing workload SLO');
    if (m.mode === 'D4') check(d.workload === 'service' && m.workloadSlosMs[d.workload] === MINUTE, 'D4 requires the 60s service SLO');
  }
  if (m.mode === 'D6') check(Number.isInteger(m.intervalMs) && m.intervalMs > 0 && m.intervalMs <= 5 * MINUTE && m.intervalMs % MINUTE === 0, 'D6 schedule interval must be 1..5 minutes');
  check(Array.isArray(m.scheduledExclusions), 'Missing exclusion schedule');
  check(m.mode !== 'D6' || m.scheduledExclusions.length === 0, 'D6 permits no exclusions');
  check(m.scheduledExclusions.length <= 2 && new Set(m.scheduledExclusions.map(f => f.kind)).size === m.scheduledExclusions.length && new Set(m.scheduledExclusions.map(f => f.faultId)).size === m.scheduledExclusions.length, 'Duplicate/extra exclusion');
  for (const f of m.scheduledExclusions) {
    check(EXCLUSIONS.includes(f.kind) && typeof f.faultId === 'string' && f.faultId.length > 0, 'Disallowed exclusion');
    check(f.durationMs === 15 * MINUTE, 'Only scheduled 15-minute exclusions permitted');
    check(instant(f.scheduledAt) >= start && instant(f.scheduledAt) + f.durationMs <= end, 'Exclusion outside campaign');
  }
}
export function freezeAvailabilitySchedule(input) {
  const m = structuredClone({ version: 1, scheduledExclusions: [], ...input });
  delete m.expected; delete m.scheduleHash;
  validateBody(m);
  m.expected = expectedSamples(m);
  m.scheduleHash = scheduleHash(m);
  return m;
}
function exclusionWindows(m, faults) {
  check(Array.isArray(faults) && faults.length === m.scheduledExclusions.length && new Set(faults.map(f => f.faultId)).size === faults.length, 'Missing/duplicate/unscheduled exclusion observations');
  const windows = faults.map(f => {
    const planned = m.scheduledExclusions.find(p => p.faultId === f.faultId);
    check(planned, 'Unscheduled exclusion');
    const start = instant(f.effectiveAt), end = instant(f.removedAt);
    check(end - start === 15 * MINUTE, 'Actual exclusion must last exactly 15 minutes');
    check(start >= instant(planned.scheduledAt) && start >= instant(m.start) && end <= instant(m.end), 'Actual exclusion outside scheduled campaign');
    return { faultId: f.faultId, start, end, kind: planned.kind };
  }).sort((a,b) => a.start - b.start);
  check(windows.every((w,i) => i === 0 || w.start >= windows[i-1].end), 'Overlapping exclusions');
  return windows;
}
function success(sample, expected, m) {
  try {
    const start = instant(expected.scheduledAt), submitted = instant(sample.submittedAt), readback = instant(sample.readbackAt);
    if (!(sample.success === true && sample.durableSuccess === true && sample.authorizedReadback === true && submitted >= start && submitted < start + (m.mode === 'D4' ? MINUTE : m.intervalMs) && readback >= submitted && readback - submitted <= m.workloadSlosMs[expected.dimensions.workload] && instant(sample.observedAt) >= submitted)) return false;
    if (m.mode === 'D4') return sample.fencedInstanceCount === 1 && sample.healthCurrent === true && typeof sample.generation === 'string' && sample.generation.length > 0 && sample.generation === sample.desiredGeneration;
    return sample.placement === true && sample.lease === true && sample.execution === true;
  } catch { return false; }
}
function reconstructable(sample) {
  try {
    const observed = instant(sample.observedAt), submitted = instant(sample.submittedAt);
    if (sample.driverStartedAt !== undefined && submitted < instant(sample.driverStartedAt)) return false;
    if (sample.success === true) {
      const readback = instant(sample.readbackAt);
      if (observed < readback || readback < submitted) return false;
    }
    if (observed < submitted) return false;
    return typeof sample.success === 'boolean';
  } catch { return false; }
}
export function evaluateAvailability(m, samples, { faults = [] } = {}) {
  check(m.scheduleHash === scheduleHash(m), 'Frozen schedule hash mismatch');
  validateBody(m);
  check(canonical(m.expected) === canonical(expectedSamples(m)), 'Incomplete or altered expected schedule');
  check(Array.isArray(samples), 'Raw samples must be an array');
  const windows = exclusionWindows(m, faults);
  const expectedById = new Map(m.expected.map(e => [e.sampleId, e]));
  const byId = new Map(), errors = [], conflicts = new Set(); let duplicateReports = 0;
  for (const sample of samples) {
    if (!expectedById.has(sample?.sampleId)) { errors.push('Unexpected sample identity'); continue; }
    if (byId.has(sample.sampleId)) {
      duplicateReports++;
      if (canonical(sample) !== canonical(byId.get(sample.sampleId))) { conflicts.add(sample.sampleId); errors.push(`Conflicting duplicate: ${sample.sampleId}`); }
    } else byId.set(sample.sampleId, sample);
  }
  const total = { expected: m.expected.length, observed: byId.size, missing: m.expected.length - byId.size, numerator: 0, denominator: 0, excluded: 0 };
  const cohorts = {}, exclusionReasons = {};
  for (const e of m.expected) {
    const key = canonical(e.dimensions);
    const cohort = cohorts[key] ??= { dimensions: e.dimensions, expected: 0, observed: 0, missing: 0, numerator: 0, denominator: 0, excluded: 0 };
    cohort.expected++;
    const sample = byId.get(e.sampleId);
    if (sample) cohort.observed++; else { cohort.missing++; errors.push(`Missing sample: ${e.sampleId}`); }
    const valid = sample && canonical(sample.dimensions) === canonical(e.dimensions) && sample.scheduledAt === e.scheduledAt && sample.telemetryComplete === true && typeof sample.reason === 'string' && sample.reason.length > 0 && reconstructable(sample) && !conflicts.has(e.sampleId);
    if (sample && !valid) errors.push(`Incomplete evidence: ${e.sampleId}`);
    const exclusion = windows.find(w => instant(e.scheduledAt) >= w.start && instant(e.scheduledAt) < w.end);
    if (exclusion) { total.excluded++; cohort.excluded++; exclusionReasons[exclusion.faultId] = (exclusionReasons[exclusion.faultId] ?? 0) + 1; }
    else {
      total.denominator++; cohort.denominator++;
      if (valid && success(sample, e, m)) { total.numerator++; cohort.numerator++; }
    }
  }
  const ratio = c => c.denominator ? c.numerator / c.denominator : null;
  const passes = c => c.denominator > 0 && c.numerator * 1000 >= c.denominator * 995;
  for (const c of Object.values(cohorts)) { c.availability = ratio(c); c.passed = passes(c) && c.missing === 0; }
  return { ...total, duplicateReports, scheduleHash: m.scheduleHash, candidate: m.candidate, mode: m.mode,
    availability: ratio(total), threshold: 0.995, evidenceComplete: errors.length === 0, errors, exclusionReasons,
    exclusions: windows, cohorts: Object.values(cohorts), passed: errors.length === 0 && passes(total) && Object.values(cohorts).every(c => c.passed),
    fullD4Acceptance: false, scope: 'Availability SLI only; duration, fault execution, security invariants, convergence and final cleanup require independent evidence.' };
}

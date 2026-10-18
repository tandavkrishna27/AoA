import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as measurements from '../m4-load-measurements.mjs';

const phase = (extra = {}) => ({durationMs: 1000, observedUntilMs: 2000, tenantKeys: ['quiet'],
  requestStarts: [], requests: [], jobs: [], completions: [], ...extra});
const start = (id, extra = {}) => ({requestId:id, tenantKey:'quiet', kind:'poll', startedAtMs:10, deadlineAtMs:110, ...extra});
const finish = (id, extra = {}) => ({requestId:id, status:200, completedAtMs:20, latencyMs:10, ...extra});

test('a request lost before finally remains in the start denominator and fails coverage', () => {
  const summary = measurements.summarizeLoadPhase(phase({requestStarts:[start('lost')]}));
  assert.equal(summary.totalRequests, 1);
  assert.equal(summary.censoredRequests, 1);
  assert.equal(summary.requestAccountingComplete, false);
  assert.equal(summary.pollP95Ms, null);
});

test('late and timed out requests cannot move to drain or improve a complete percentile', () => {
  const summary = measurements.summarizeLoadPhase(phase({requestStarts:[start('late'),start('timeout')],
    requests:[finish('late',{completedAtMs:1500,latencyMs:1490}),finish('timeout',{status:0,outcome:'timeout',completedAtMs:110,latencyMs:100})]}));
  assert.equal(summary.totalRequests, 2);
  assert.equal(summary.drainRequestCount, 0);
  assert.equal(summary.lateRequests, 1);
  assert.equal(summary.timeoutRequests, 1);
  assert.equal(summary.pollP95Ms, null);
  assert.equal(summary.requestHistograms.poll.observedP95Ms, 1490);
});

test('drain starts remain separate while late HTTP 5xx stays in original denominator', () => {
  const summary = measurements.summarizeLoadPhase(phase({requestStarts:[start('a'),start('b',{startedAtMs:1000,deadlineAtMs:1100})],
    requests:[finish('a',{status:503,completedAtMs:1200,latencyMs:1190}),finish('b',{completedAtMs:1005,latencyMs:5})]}));
  assert.equal(summary.totalRequests, 1);
  assert.equal(summary.drainRequestCount, 1);
  assert.equal(summary.http5xxRate, 1);
});

test('duplicate or orphan records refuse reconstruction instead of inflating denominator', () => {
  for (const extra of [
    {requestStarts:[start('a'),start('a')]},
    {requestStarts:[start('a')],requests:[finish('a'),finish('a')]},
    {requestStarts:[],requests:[finish('orphan')]},
  ]) assert.throws(() => measurements.summarizeLoadPhase(phase(extra)), /request/i);
});

test('missing dimensions and invalid completion chronology fail closed', () => {
  for (const extra of [
    {requestStarts:[start('a',{tenantKey:null})]},
    {requestStarts:[start('a',{kind:undefined})]},
    {requestStarts:[start('a')],requests:[finish('a',{completedAtMs:5})]},
  ]) assert.throws(() => measurements.summarizeLoadPhase(phase(extra)), /request/i);
});

test('a late successful job stays failed at its frozen deadline and separate from attempts', () => {
  const summary = measurements.summarizeLoadPhase(phase({jobs:[{intentId:'a',tenantKey:'quiet',scheduledAtMs:0,
    submittedAtMs:1,deadlineAtMs:1500,jobId:'job',jobStatus:'succeeded',jobCompletedAtMs:1600,
    attemptStatus:'succeeded',attemptCompletedAtMs:1400,queueToAckMs:20,providerDurationMs:30}]}));
  assert.equal(summary.tenants.quiet.jobs.succeededByDeadline, 0);
  assert.equal(summary.tenants.quiet.jobs.lateSucceeded, 1);
  assert.equal(summary.tenants.quiet.attempts.succeededByDeadline, 1);
  assert.equal(summary.tenants.quiet.endToEndP95Ms, null);
  assert.equal(summary.tenants.quiet.queueToAckP95Ms, 20);
  assert.equal(summary.tenants.quiet.providerDurationP95Ms, 30);
});

test('an unsubmitted scheduled job and unresolved job cannot disappear', () => {
  const jobs=[{intentId:'a',tenantKey:'quiet',scheduledAtMs:0,deadlineAtMs:1500},
    {intentId:'b',tenantKey:'quiet',scheduledAtMs:500,deadlineAtMs:1500,jobId:'job',jobStatus:'running'}];
  const summary=measurements.summarizeLoadPhase(phase({jobs}));
  assert.equal(summary.tenants.quiet.jobs.scheduled,2);
  assert.equal(summary.tenants.quiet.jobs.notSubmitted,1);
  assert.equal(summary.tenants.quiet.jobs.deadlineMisses,2);
});

test('unknown job dimensions and duplicate intent across tenants refuse reconstruction',()=>{
  const job={intentId:'a',tenantKey:'quiet',scheduledAtMs:0,deadlineAtMs:1500};
  for(const jobs of [[{...job,tenantKey:'unknown'}],[{...job,scheduledAtMs:NaN}],[job,job]]) {
    assert.throws(()=>measurements.summarizeLoadPhase(phase({jobs})),/job/i);
  }
});

test('job throughput uses durable job observation inside fixed window; attempt success is distinct', () => {
  const summary=measurements.summarizeLoadPhase(phase({jobs:[{intentId:'a',tenantKey:'quiet',scheduledAtMs:0,submittedAtMs:5,
    deadlineAtMs:2000,jobId:'job',jobStatus:'succeeded',jobCompletedAtMs:900,attemptStatus:'succeeded',attemptCompletedAtMs:800}]}));
  assert.equal(summary.tenants.quiet.throughputPerSecond,1);
  assert.equal(summary.tenants.quiet.endToEndP95Ms,895);
});

test('legacy completed-only diagnostics explicitly lack a complete start denominator', () => {
  const summary=measurements.summarizeLoadPhase({durationMs:1000,tenantKeys:['quiet'],completions:[],requests:[
    {tenantKey:'quiet',kind:'poll',startedAtMs:1,completedAtMs:2,latencyMs:1,status:200}]});
  assert.equal(summary.totalRequests,1);
  assert.equal(summary.requestAccountingComplete,false);
  assert.equal(summary.accountingMode,'legacy-completed-only');
});

test('telemetry overhead remains explicit and never subtracts latency', () => {
  const summary=measurements.summarizeLoadPhase(phase({requestStarts:[start('a',{telemetryWriteMs:2})],
    requests:[finish('a',{telemetryWriteMs:3,cloneWaitMs:4,observerCpuMs:1})]}));
  assert.equal(summary.pollP95Ms,10);
  assert.equal(summary.telemetry.writeMs,5);
  assert.equal(summary.telemetry.cloneWaitMs,4);
  assert.equal(summary.telemetry.observerCpuMs,1);
});

test('successful provider wire requests cannot dilute the API 5xx denominator',()=>{
  const summary=measurements.summarizeLoadPhase(phase({requestStarts:[start('api'),start('provider',{kind:'providerExecute'})],
    requests:[finish('api',{status:503}),finish('provider')]}));
  assert.equal(summary.totalRequests,2);
  assert.equal(summary.apiRequestCount,1);
  assert.equal(summary.http5xxRate,1);
  assert.equal(summary.providerRequestCount,1);
});

test('quiet tenant comparison keeps the unchanged 90 percent / 2x thresholds', () => {
  const baseline={tenants:{quiet:{throughputPerSecond:2,queueToAckP95Ms:10}}};
  const loaded={tenants:{quiet:{throughputPerSecond:1.8,queueToAckP95Ms:20}}};
  assert.equal(measurements.compareQuietTenants(baseline,loaded,['quiet'])[0].passed,true);
  loaded.tenants.quiet.queueToAckP95Ms=20.01;
  assert.equal(measurements.compareQuietTenants(baseline,loaded,['quiet'])[0].passed,false);
});

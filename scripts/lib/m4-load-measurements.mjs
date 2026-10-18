// Diagnostic measurements only. These cannot close the full D5 topology/load gate.
export function percentile95(values) {
  if (!values.length || values.some(v => !Number.isFinite(v) || v < 0)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

export function summarizeLoadPhase(phase) {
  if (!Number.isFinite(phase.durationMs) || phase.durationMs <= 0) throw Error('Invalid measurement window');
  const accounted = accountRequests(phase);
  // Cohort by request start: a slow response/timeout remains in its original
  // window; follow-up requests first sent during draining are separate.
  const requests = accounted.requests.filter(r => r.startedAtMs >= 0 && r.startedAtMs < phase.durationMs);
  const http5xx = requests.filter(r => r.status >= 500 && r.status <= 599).length;
  const transportErrors = requests.filter(r => r.status === 0).length;
  const tenants = Object.fromEntries(phase.tenantKeys.map(key => {
    if (phase.jobs) return [key, summarizeJobs(phase, key)];
    const completed = phase.completions.filter(c => c.tenantKey === key && c.completedAtMs <= phase.durationMs);
    return [key, { completed: completed.length, throughputPerSecond: completed.length * 1000 / phase.durationMs,
      queueToAckP95Ms: percentile95(completed.map(c => c.queueToAckMs)) }];
  }));
  const requestHistograms = Object.fromEntries([...new Set(requests.map(r => r.kind))].map(kind => {
    const cohort = requests.filter(r => r.kind === kind);
    const observed = cohort.filter(r => Number.isFinite(r.latencyMs));
    const complete = cohort.every(r => !r.censored && !r.timedOut);
    return [kind, {total:cohort.length, observed:observed.length, censored:cohort.filter(r=>r.censored).length,
      timedOut:cohort.filter(r=>r.timedOut).length, observedP95Ms:percentile95(observed.map(r=>r.latencyMs)),
      p95Ms:complete ? percentile95(observed.map(r=>r.latencyMs)) : null}];
  }));
  return { durationMs: phase.durationMs, totalRequests: requests.length, drainRequestCount: accounted.requests.filter(r=>r.startedAtMs>=phase.durationMs).length, http5xx, transportErrors,
    accountingMode:accounted.mode, requestAccountingComplete:accounted.complete && requests.every(r=>!r.censored),
    censoredRequests:requests.filter(r=>r.censored).length, timeoutRequests:requests.filter(r=>r.timedOut).length,
    lateRequests:requests.filter(r=>r.late).length, requestHistograms,
    http5xxRate: requests.length ? http5xx / requests.length : null,
    submitP95Ms:requestHistograms.submit?.p95Ms ?? null,
    pollP95Ms:requestHistograms.poll?.p95Ms ?? null,
    eventAckP95Ms:requestHistograms.events?.p95Ms ?? null,
    providerWireP95Ms:requestHistograms.providerExecute?.p95Ms ?? null,
    telemetry: {writeMs:requests.reduce((s,r)=>s+(r.startWriteMs??0)+(r.telemetryWriteMs??0),0),
      cloneWaitMs:requests.reduce((s,r)=>s+(r.cloneWaitMs??0),0), observerCpuMs:requests.reduce((s,r)=>s+(r.observerCpuMs??0),0),
      latencySubtracted:false}, tenants };
}

const validMs = value => Number.isFinite(value) && value >= 0;
const kinds = new Set(['submit','poll','leaseAck','events','renew','providerExecute','providerCreate','providerDestroy']);

// Identity join, never a completion-only filter. A flushed start is the durable
// denominator even when the worker is killed before catch/finally can execute.
export function accountRequests(phase) {
  if (!Array.isArray(phase.requestStarts)) return {mode:'legacy-completed-only',complete:false,requests:phase.requests};
  const starts = new Map(), finishes = new Map();
  for (const r of phase.requestStarts) {
    if (!r.requestId || starts.has(r.requestId) || !phase.tenantKeys.includes(r.tenantKey) || !kinds.has(r.kind)
      || !validMs(r.startedAtMs) || !validMs(r.deadlineAtMs) || r.deadlineAtMs < r.startedAtMs) throw Error('Invalid or duplicate request start');
    starts.set(r.requestId,r);
  }
  for (const r of phase.requests) {
    const began=starts.get(r.requestId);
    if (!began || finishes.has(r.requestId) || !validMs(r.completedAtMs) || r.completedAtMs<began.startedAtMs
      || !validMs(r.latencyMs) || !Number.isInteger(r.status) || r.status<0 || r.status>599) throw Error('Invalid, orphan or duplicate request finish');
    finishes.set(r.requestId,r);
  }
  return {mode:'durable-start-ledger',complete:true,requests:[...starts.values()].map(began => {
    const end=finishes.get(began.requestId);
    return {...began,...end,startWriteMs:began.telemetryWriteMs??0,
      telemetryWriteMs:end?.telemetryWriteMs??0,censored:!end,
      timedOut:end?.outcome==='timeout',late:Boolean(end && end.completedAtMs>began.deadlineAtMs)};
  })};
}

function summarizeJobs(phase, tenantKey) {
  const jobs=phase.jobs.filter(j=>j.tenantKey===tenantKey && j.scheduledAtMs>=0 && j.scheduledAtMs<phase.durationMs);
  const ids=new Set();
  for(const j of jobs) {
    if(!j.intentId || ids.has(j.intentId) || !validMs(j.deadlineAtMs) || j.deadlineAtMs<j.scheduledAtMs) throw Error('Invalid or duplicate job intent');
    ids.add(j.intentId);
  }
  const success=(j,kind)=>j[kind+'Status']==='succeeded' && validMs(j[kind+'CompletedAtMs']) && j[kind+'CompletedAtMs']<=j.deadlineAtMs;
  const completed=jobs.filter(j=>success(j,'job') && j.jobCompletedAtMs<=phase.durationMs);
  const count=kind=>({succeededByDeadline:jobs.filter(j=>success(j,kind)).length,
    lateSucceeded:jobs.filter(j=>j[kind+'Status']==='succeeded' && validMs(j[kind+'CompletedAtMs']) && j[kind+'CompletedAtMs']>j.deadlineAtMs).length,
    deadlineMisses:jobs.filter(j=>!success(j,kind)).length});
  const timed=jobs.filter(j=>success(j,'job') && validMs(j.submittedAtMs) && j.jobCompletedAtMs>=j.submittedAtMs);
  return {completed:completed.length,throughputPerSecond:completed.length*1000/phase.durationMs,
    jobs:{scheduled:jobs.length,notSubmitted:jobs.filter(j=>!j.jobId).length,...count('job')}, attempts:count('attempt'),
    queueToAckP95Ms:percentile95(jobs.filter(j=>validMs(j.queueToAckMs)).map(j=>j.queueToAckMs)),
    queueToAckCoverage:jobs.filter(j=>validMs(j.queueToAckMs)).length,
    endToEndP95Ms:timed.length===jobs.length ? percentile95(timed.map(j=>j.jobCompletedAtMs-j.submittedAtMs)) : null,
    providerDurationP95Ms:percentile95(jobs.filter(j=>validMs(j.providerDurationMs)).map(j=>j.providerDurationMs))};
}

export function compareQuietTenants(baseline, loaded, quietKeys) {
  return quietKeys.map(tenantKey => {
    const a = baseline.tenants[tenantKey], b = loaded.tenants[tenantKey];
    const throughputRatio = a?.throughputPerSecond > 0 && b ? b.throughputPerSecond / a.throughputPerSecond : null;
    const delayRatio = Number.isFinite(a?.queueToAckP95Ms) && a.queueToAckP95Ms > 0 && Number.isFinite(b?.queueToAckP95Ms) ? b.queueToAckP95Ms / a.queueToAckP95Ms : null;
    return { tenantKey, throughputRatio, delayRatio,
      passed: throughputRatio !== null && delayRatio !== null && throughputRatio >= 0.9 && delayRatio <= 2 };
  });
}

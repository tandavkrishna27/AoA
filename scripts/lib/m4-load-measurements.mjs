// Diagnostic measurements only. These cannot close the full D5 topology/load gate.
export function percentile95(values) {
  if (!values.length || values.some(v => !Number.isFinite(v) || v < 0)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

export function summarizeLoadPhase(phase) {
  if (!Number.isFinite(phase.durationMs) || phase.durationMs <= 0) throw Error('Invalid measurement window');
  // Cohort by request start: a slow response/timeout remains in its original
  // window; follow-up requests first sent during draining are separate.
  const requests = phase.requests.filter(r => Number.isFinite(r.startedAtMs) && r.startedAtMs >= 0 && r.startedAtMs < phase.durationMs);
  const http5xx = requests.filter(r => r.status >= 500 && r.status <= 599).length;
  const transportErrors = requests.filter(r => r.status === 0).length;
  const tenants = Object.fromEntries(phase.tenantKeys.map(key => {
    const completed = phase.completions.filter(c => c.tenantKey === key && c.completedAtMs <= phase.durationMs);
    return [key, { completed: completed.length, throughputPerSecond: completed.length * 1000 / phase.durationMs,
      queueToAckP95Ms: percentile95(completed.map(c => c.queueToAckMs)) }];
  }));
  return { durationMs: phase.durationMs, totalRequests: requests.length, drainRequestCount: phase.requests.length-requests.length, http5xx, transportErrors,
    http5xxRate: requests.length ? http5xx / requests.length : null,
    pollP95Ms: percentile95(requests.filter(r => r.kind === 'poll').map(r => r.latencyMs)),
    eventAckP95Ms: percentile95(requests.filter(r => r.kind === 'events').map(r => r.latencyMs)),
    tenants };
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

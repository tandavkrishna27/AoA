import { openSync, writeSync, fsyncSync, closeSync, readFileSync } from "node:fs";
import path from "node:path";
import { E2B_SANDBOX_ID_SHAPE } from "./m1-shipped-boot.mjs";

const intentPath = (out) => path.join(out, "resource-intents.jsonl");
const identityFields = ["id", "kind", "tenant", "organizationId", "companyId", "targetId", "worker"];
const bindingFields = ["organizationId", "companyId", "targetId", "jobId", "jobStatus", "attemptId", "attemptStatus", "leaseId", "leaseStatus", "sandboxId", "leaseCreatedAt"];
const nonempty = (value) => typeof value === "string" && value.length > 0;
function validIntent(intent, candidate) {
  return /^[a-f0-9]{40}$/.test(candidate ?? "") && intent?.candidate === candidate
    && identityFields.every((key) => nonempty(intent[key]))
    && (intent.expectedDistributedJobs === undefined || ["none", "present"].includes(intent.expectedDistributedJobs))
    && (intent.expectedDistributedJobs !== "none" || intent.kind === "journey")
    && ((intent.kind === "journey" && nonempty(intent.issueTitle))
      || (intent.kind === "redaction" && nonempty(intent.jobId) && nonempty(intent.attemptId)));
}

// Flush the non-secret intent before the API/seed can create a runnable job.
export function recordResourceIntent({ out, candidate, intent }) {
  const record = Object.fromEntries(["candidate", ...identityFields, "issueTitle", "jobId", "attemptId"]
    .filter((key) => key === "candidate" || intent[key] !== undefined)
    .map((key) => [key, key === "candidate" ? candidate : intent[key]]));
  record.expectedDistributedJobs = intent.expectedDistributedJobs ?? "present";
  if (!validIntent(record, candidate)) throw new Error("invalid resource intent");
  const fd = openSync(intentPath(out), "a", 0o600);
  try {
    const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new Error("resource intent write incomplete");
      offset += written;
    }
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

export function readResourceIntents({ out, candidate }) {
  const text = readFileSync(intentPath(out), "utf8");
  const violations = [];
  const lines = text.split("\n");
  const tail = lines.pop();
  if (tail !== "") violations.push("intent_journal_truncated");
  const intents = [];
  const seen = new Set();
  for (const line of lines) {
    try {
      const intent = JSON.parse(line);
      if (!validIntent(intent, candidate) || seen.has(intent.id)) throw new Error("invalid");
      seen.add(intent.id);
      intents.push(intent);
    } catch { violations.push("intent_journal_invalid"); }
  }
  if (!intents.length) violations.push("intent_journal_empty");
  return { intents, violations };
}

// Stop declared work through the board cancellation API before stopping workers.
// A failed attempt is retryable until its JOB is cancelled; observing lease expiry
// alone would allow the reaper to allocate new work during teardown.
export async function cancelDeclaredJobs({ candidate, intents, read, cancel, timeoutMs = 60_000,
  now = () => performance.now() }) {
  if (typeof read !== "function" || typeof cancel !== "function" || !Number.isInteger(timeoutMs)
    || timeoutMs < 1 || timeoutMs > 60_000) throw new Error("invalid cancellation bounds");
  const deadline = now() + timeoutMs;
  const violations = [];
  const requests = [];
  const jobs = new Map();
  const seen = new Set();
  const result = () => ({ candidate, pass: violations.length === 0, requests, violations });
  if (!Array.isArray(intents) || intents.length === 0 || intents.length > 128) {
    violations.push("cancellation_intents_invalid");
    return result();
  }
  for (const intent of intents) {
    if (!validIntent(intent, candidate) || seen.has(intent.id)) {
      violations.push("cancellation_intent_invalid");
      continue;
    }
    seen.add(intent.id);
    const remaining = Math.ceil(deadline - now());
    if (remaining <= 0) { violations.push("cancellation_deadline"); break; }
    let rows;
    try { rows = read(intent, { timeoutMs: Math.min(30_000, remaining) }); }
    catch { violations.push("cancellation_read_failed"); continue; }
    if (now() >= deadline) { violations.push("cancellation_deadline"); break; }
    if (!Array.isArray(rows) || rows.length > 512) { violations.push("cancellation_read_invalid"); continue; }
    if (!rows.length && intent.expectedDistributedJobs !== "none") violations.push("cancellation_job_unresolved");
    if (rows.length && intent.expectedDistributedJobs === "none") violations.push("cancellation_unexpected_control_job");
    for (const row of rows) {
      if (!row || !nonempty(row.jobId) || row.organizationId !== intent.organizationId
        || row.companyId !== intent.companyId || (intent.jobId && row.jobId !== intent.jobId)
        || (intent.kind === "journey" && (!nonempty(row.sourceIdentity) || row.sourceIdentity !== row.sourceRunId))
        || !["queued", "running", "cancel_requested", "succeeded", "failed", "cancelled", "dead_letter"].includes(row.jobStatus)) {
        violations.push("cancellation_binding_invalid");
        continue;
      }
      const key = JSON.stringify([row.organizationId, row.companyId, row.jobId]);
      if (jobs.has(key) && jobs.get(key).status !== row.jobStatus) violations.push("cancellation_binding_inconsistent");
      jobs.set(key, { organizationId: row.organizationId, companyId: row.companyId, jobId: row.jobId, status: row.jobStatus });
      if (jobs.size > 128) { violations.push("cancellation_jobs_exceeded"); return result(); }
    }
  }
  // Validate all declared identities before issuing any mutation.
  if (violations.length) return result();
  for (const { status, ...job } of jobs.values()) {
    if (["succeeded", "failed", "cancelled", "dead_letter"].includes(status)) continue;
    const remaining = Math.ceil(deadline - now());
    if (remaining <= 0) { violations.push("cancellation_deadline"); break; }
    const bound = Math.min(30_000, remaining);
    const controller = new AbortController();
    let timer;
    try {
      const outcome = await Promise.race([
        Promise.resolve().then(() => cancel(job, { timeoutMs: bound, signal: controller.signal })),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("deadline")); }, bound); }),
      ]);
      if (now() >= deadline) { violations.push("cancellation_deadline"); break; }
      if (!["queued", "already_requested", "cancelled", "job_terminal"].includes(outcome?.status)) {
        violations.push("cancellation_rejected");
      } else requests.push({ ...job, outcome: outcome.status });
    } catch { violations.push("cancellation_request_failed"); }
    finally { clearTimeout(timer); }
  }
  return result();
}

export function collectProviderInventory({ candidate, intents, read, deadlineMs = 180_000, now = Date.now }) {
  const violations = [];
  const resources = [];
  const unleasedRetries = [];
  const seen = new Set();
  const sandboxOwners = new Map();
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 180_000) throw new Error("invalid inventory deadline");
  const deadline = now() + deadlineMs;
  if (!Array.isArray(intents) || intents.length === 0) violations.push("inventory_empty");
  for (const intent of Array.isArray(intents) ? intents : []) {
    if (!validIntent(intent, candidate) || seen.has(intent.id)) {
      violations.push("intent_invalid");
      continue;
    }
    seen.add(intent.id);
    let rows;
    const remaining = deadline - now();
    if (remaining <= 0) { violations.push(`${intent.id}:inventory_deadline`); continue; }
    try { rows = read(intent, { timeoutMs: Math.min(30_000, remaining) }); } catch { violations.push(`${intent.id}:inventory_read_failed`); continue; }
    if (now() > deadline) violations.push(`${intent.id}:inventory_deadline`);
    if (!Array.isArray(rows)) { violations.push(`${intent.id}:inventory_read_failed`); continue; }
    if (rows.length === 0) {
      if (intent.expectedDistributedJobs !== "none") violations.push(`${intent.id}:job_unresolved`);
      continue;
    }
    if (intent.expectedDistributedJobs === "none") violations.push(`${intent.id}:unexpected_control_job`);
    for (const row of rows) {
      if (intent.kind === "journey" && (!nonempty(row?.sourceIdentity) || row.sourceIdentity !== row.sourceRunId))
        violations.push(`${intent.id}:source_identity_inconsistent`);
      // Cancellation may race a normal reap: attempt N+1 was allocated but never
      // leased. Retain its terminal disposition only with database proof of no
      // lease/start and a fully resolved prior resource on this exact job.
      if (intent.kind === "journey" && row?.organizationId === intent.organizationId && row.companyId === intent.companyId
        && nonempty(row.jobId) && nonempty(row.attemptId) && row.jobStatus === "cancelled" && row.attemptStatus === "cancelled"
        && Number.isInteger(row.attemptNumber) && row.attemptNumber > 1
        && row.attemptLeaseCount === 0 && row.attemptStartedEventCount === 0
        && ["leaseId", "leaseStatus", "targetId", "leaseCreatedAt", "sandboxId"].every((key) => row[key] === null)
        && rows.some((prior) => bindingFields.every((key) => nonempty(prior?.[key]))
          && prior.organizationId === intent.organizationId && prior.companyId === intent.companyId
          && prior.targetId === intent.targetId && prior.jobId === row.jobId && prior.attemptId !== row.attemptId
          && Number.isInteger(prior.attemptNumber) && prior.attemptNumber < row.attemptNumber
          && ["succeeded", "failed", "cancelled", "expired"].includes(prior.attemptStatus)
          && ["released", "expired", "revoked"].includes(prior.leaseStatus)
          && prior.jobStatus === "cancelled" && prior.sourceIdentity === row.sourceIdentity
          && E2B_SANDBOX_ID_SHAPE.test(prior.sandboxId)
          && Number.isFinite(Date.parse(prior.leaseCreatedAt)) && Date.parse(prior.leaseCreatedAt) <= now())) {
        unleasedRetries.push({ intentId: intent.id, organizationId: row.organizationId, companyId: row.companyId,
          jobId: row.jobId, attemptId: row.attemptId, attemptNumber: row.attemptNumber,
          disposition: "cancelled_without_lease_or_start" });
        continue;
      }
      if (!row || !bindingFields.every((key) => nonempty(row[key]))
        || row.organizationId !== intent.organizationId || row.companyId !== intent.companyId
        || row.targetId !== intent.targetId || (intent.jobId && row.jobId !== intent.jobId)
        || (intent.attemptId && row.attemptId !== intent.attemptId)
        || !E2B_SANDBOX_ID_SHAPE.test(row.sandboxId)
        || !Number.isFinite(Date.parse(row.leaseCreatedAt)) || Date.parse(row.leaseCreatedAt) > now()) {
        violations.push(`${intent.id}:resource_identity_unresolved`);
        continue;
      }
      if (!["succeeded", "failed", "cancelled", "dead_letter"].includes(row.jobStatus)
        || !["succeeded", "failed", "cancelled", "expired"].includes(row.attemptStatus)
        || !["released", "expired", "revoked"].includes(row.leaseStatus)) violations.push(`${intent.id}:execution_not_terminal`);
      const owner = JSON.stringify([intent.id, row.jobId, row.attemptId, row.leaseId]);
      const previous = sandboxOwners.get(row.sandboxId);
      if (previous && previous !== owner) violations.push(`${intent.id}:sandbox_identity_conflict`);
      if (previous === owner) continue;
      sandboxOwners.set(row.sandboxId, owner);
      resources.push({ ...Object.fromEntries(bindingFields.map((key) => [key, row[key]])),
        intentId: intent.id, tenant: intent.tenant, worker: intent.worker });
    }
  }
  return { candidate, scope: "declared-journey-and-redaction-intents", observedAt: new Date(now()).toISOString(), resources,
    ...(unleasedRetries.length ? { unleasedRetries } : {}), complete: violations.length === 0, violations };
}

// A terminal attempt can precede normal lease expiry and job reconciliation.
// Keep the control plane alive while observing that transition; never age leases
// or convert a nonterminal snapshot into success merely because time elapsed.
export async function awaitProviderInventory({ collect, timeoutMs = 420_000, pollMs = 5_000,
  now = () => performance.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (typeof collect !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 420_000
    || !Number.isInteger(pollMs) || pollMs < 1 || pollMs > timeoutMs) throw new Error("invalid inventory settlement bounds");
  const deadline = now() + timeoutMs;
  const observed = new Map();
  let snapshot = { resources: [], complete: false, violations: [] };
  const result = (extra = []) => ({ ...snapshot, resources: [...observed.values()],
    complete: snapshot.complete && extra.length === 0, violations: [...snapshot.violations, ...extra] });
  for (;;) {
    const remaining = Math.ceil(deadline - now());
    if (remaining <= 0) return result(["inventory_settlement_deadline"]);
    try { snapshot = collect({ deadlineMs: Math.min(30_000, remaining) }); }
    catch { snapshot = { ...snapshot, complete: false, violations: ["inventory_unavailable"] }; return result(); }
    for (const resource of snapshot.resources) {
      const key = JSON.stringify([resource.intentId, resource.jobId, resource.attemptId, resource.leaseId, resource.sandboxId]);
      observed.set(key, resource);
    }
    if (now() > deadline) return result(["inventory_settlement_deadline"]);
    if (snapshot.complete) return result(observed.size === snapshot.resources.length ? [] : ["inventory_resource_disappeared"]);
    // Identity, journal and query failures are not normal settlement delays.
    if (!snapshot.violations.length || snapshot.violations.some((v) => !v.endsWith(":execution_not_terminal"))) return result();
    const delay = Math.min(pollMs, deadline - now());
    if (delay <= 0) return result(["inventory_settlement_deadline"]);
    await sleep(delay);
  }
}

// Compose evidence only: successful removal says nothing about provider sandboxes.
export function observeComposeCleanup({ candidate, project, down, inspect }) {
  const invoke = (operation) => {
    try {
      const result = operation();
      return {
        status: Number.isInteger(result?.status) ? result.status : null,
        error: Boolean(result?.error || result?.signal),
        stdout: typeof result?.stdout === "string" ? result.stdout : null,
      };
    } catch {
      return { status: null, error: true, stdout: null };
    }
  };
  const removed = invoke(down);
  const violations = [];
  if (removed.status !== 0 || removed.error) violations.push("compose_down_failed");
  const observations = {};
  for (const kind of ["container", "network", "volume"]) {
    const result = invoke(() => inspect(kind));
    const remaining = result.stdout === null ? null : result.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    observations[kind] = { status: result.status, error: result.error, remaining };
    if (result.status !== 0 || result.error || remaining === null) violations.push(`${kind}_inventory_unknown`);
    else if (remaining.length > 0) violations.push(`${kind}_still_present`);
  }
  return {
    candidate, project, scope: "compose-project-only", providerCleanup: "not-assessed",
    finishedAt: new Date().toISOString(),
    down: { status: removed.status, error: removed.error }, observations,
    pass: violations.length === 0, violations,
  };
}

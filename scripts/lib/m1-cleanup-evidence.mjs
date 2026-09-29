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

export function collectProviderInventory({ candidate, intents, read, deadlineMs = 180_000, now = Date.now }) {
  const violations = [];
  const resources = [];
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
    complete: violations.length === 0, violations };
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

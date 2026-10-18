#!/usr/bin/env node
// W12's board-API driver. Infrastructure, restore, and worker process control live elsewhere.
// This file never writes database rows directly or chooses a placement for a job.
//
// node scripts/w12-live-rehearsal/api.mjs <phase>
// Common: W12_BASE_URL=http://127.0.0.1:<private-port>, W12_PRIVATE_DIR=<absolute
// directory outside checkout>. The control plane must have its guarded private
// cloud_auth E2E session seam enabled. No Google/OAuth credential is used here.
// seed-identity: W12_TEST_SUPPORT_TOKEN_FILE -> POST /test-support/session,
//   POST /organizations, POST /companies, POST /companies/:id/agent-hires,
//   POST /approvals/:id/approve. cloud_auth companies require hire approval.
// refresh-session re-mints the same test user's one-hour cookie after a restore.
// seed: seed-identity plus W12_OPENAI_KEY_FILE and W12_E2B_KEY_FILE ->
//   POST /companies/:id/secrets and /runtime-provider-keys/with-secret.
// provision-target: POST /organizations/:id/execution-targets, PUT placement-profile,
//   POST enrollment-codes. W12_TARGET_SLUG defaults to aoa-canary-e2b; set a fresh
//   slug for a replacement. handoff-target: W12_RETIRED_TARGET_ID and
//   W12_SUCCESSOR_TARGET_ID -> explicit POST /execution-targets/:old/successor.
// submit: W12_TASK_DESCRIPTION_FILE and optional W12_TASK_TITLE -> POST /issues.
// observe: GET /heartbeat-runs, /jobs/:id, /issues/:id/outputs; optional W12_ISSUE_ID
//   and W12_JOB_ID disambiguate. download: W12_OUTPUT_ID and
//   W12_EXPECTED_OUTPUT_FILE -> GET /task-outputs/:id/content, verify committed
//   artifact hash/size and exact expected bytes. Cookies/tickets/bytes stay 0600
//   under W12_PRIVATE_DIR; stdout carries only IDs, hashes and phase summaries.

import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CANARY_EXECUTION_TARGET_SLUG,
  encodeEnrollmentTicket,
  providerConstraintProfileUnsigned,
  registeredTargetProfile,
} from "../lib/m1-shipped-boot.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const protocol = await import(pathToFileURL(path.resolve(here, "../../packages/worker-protocol/dist/index.js")).href);
const { canonicalProviderConstraintProfileDigestInputV1 } = protocol;
const phases = new Set(["seed-identity", "refresh-session", "seed", "provision-target", "handoff-target", "submit", "observe", "download"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isUuid = (value) => typeof value === "string" && uuid.test(value);

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function baseUrl() {
  const url = new URL(requireEnv("W12_BASE_URL"));
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("W12_BASE_URL must be a plain loopback HTTP origin");
  }
  return url.origin;
}

async function privateDir() {
  const given = requireEnv("W12_PRIVATE_DIR");
  if (!path.isAbsolute(given)) throw new Error("W12_PRIVATE_DIR must be absolute");
  const repository = path.resolve(here, "../..");
  const requested = path.resolve(given);
  if (requested === repository || requested.startsWith(`${repository}${path.sep}`)) {
    throw new Error("W12_PRIVATE_DIR must be outside the repository");
  }
  await mkdir(given, { recursive: true, mode: 0o700 });
  const dir = await realpath(given);
  if (dir !== path.resolve(given)) throw new Error("W12_PRIVATE_DIR cannot be a symlink");
  if (dir === repository || dir.startsWith(`${repository}${path.sep}`)) {
    throw new Error("W12_PRIVATE_DIR must be outside the repository");
  }
  await chmod(dir, 0o700);
  return dir;
}

async function privateWrite(dir, name, value) {
  if (!/^[a-z0-9.-]+$/.test(name)) throw new Error("invalid private filename");
  const destination = path.join(dir, name);
  await writeFile(destination, value, { mode: 0o600, flag: "w" });
  await chmod(destination, 0o600);
  return destination;
}

async function privateRead(dir, name, fallback = null) {
  try { return await readFile(path.join(dir, name), "utf8"); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

async function loadState(dir) {
  const raw = await privateRead(dir, "state.json", "{}");
  const state = JSON.parse(raw);
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("invalid private state");
  return state;
}

async function saveState(dir, state) {
  await privateWrite(dir, "state.json", `${JSON.stringify(state, null, 2)}\n`);
}

async function readInputSecret(name) {
  const filename = requireEnv(name);
  const value = (await readFile(filename, "utf8")).trim();
  if (!value) throw new Error(`${name} points to an empty file`);
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

// Matches job-submission.ts's default task_run policy snapshot. An explicit network
// policy changes that snapshot; refuse it rather than ratifying a mismatched target.
function taskRunPolicyHash() {
  if (process.env.AOA_DISTRIBUTED_NETWORK_POLICIES?.trim()) {
    throw new Error("network-policy-specific target hash needs explicit support");
  }
  return sha256(canonicalJson({ policyId: "job-submission-default", version: 1, sourceKind: "task_run" }));
}

class ApiRequestError extends Error {}

async function request(origin, method, route, { cookie, bearer, body, bytes = false } = {}) {
  const headers = {};
  if (cookie) { headers.Cookie = cookie; headers.Origin = origin; }
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${origin}/api${route}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000), redirect: "error",
  });
  if (!response.ok) {
    // Error bodies may contain user input, tokens, or provider data. Never print them.
    await response.body?.cancel();
    throw new ApiRequestError(`${method} /api${route.split("?")[0]} returned HTTP ${response.status}`);
  }
  if (bytes) return Buffer.from(await response.arrayBuffer());
  const result = await response.json();
  if (!result || typeof result !== "object") throw new Error(`${method} ${route} returned invalid JSON`);
  return result;
}

async function boardCookie(dir) {
  const cookie = (await privateRead(dir, "session.cookie"))?.trim();
  if (!cookie || !/^better-auth\.session_token=[^\s;]+$/.test(cookie)) {
    throw new Error("missing private board session; run seed first");
  }
  return cookie;
}

async function refreshSession(dir, origin, state) {
  const email = state.testEmail || process.env.W12_TEST_EMAIL?.trim() || `w12-${randomUUID()}@example.invalid`;
  const session = await request(origin, "POST", "/test-support/session", {
    bearer: await readInputSecret("W12_TEST_SUPPORT_TOKEN_FILE"),
    body: { email, name: "W12 rehearsal operator" },
  });
  if (!isUuid(session.userId) || session.cookie?.name !== "better-auth.session_token" ||
      typeof session.cookie.value !== "string") throw new Error("test session response is incomplete");
  if (state.userId && session.userId !== state.userId) throw new Error("test session user changed after restore");
  await privateWrite(dir, "session.cookie", `${session.cookie.name}=${session.cookie.value}\n`);
  state.userId = session.userId;
  state.testEmail = email;
  await saveState(dir, state);
  return { phase: "refresh-session", userId: state.userId };
}

async function seedIdentity(dir, origin, state) {
  if (!state.userId) await refreshSession(dir, origin, state);
  const cookie = await boardCookie(dir);
  if (!state.organizationRequestId) { state.organizationRequestId = randomUUID(); await saveState(dir, state); }
  if (!state.organizationId) {
    const org = await request(origin, "POST", "/organizations", { cookie,
      body: { name: process.env.W12_ORGANIZATION_NAME || "W12 Isolated Rehearsal", creationRequestId: state.organizationRequestId } });
    if (!isUuid(org.id)) throw new Error("organization response lacks id");
    state.organizationId = org.id;
    await saveState(dir, state);
  }
  if (!state.companyRequestId) { state.companyRequestId = randomUUID(); await saveState(dir, state); }
  if (!state.companyId) {
    const company = await request(origin, "POST", "/companies", { cookie,
      body: { name: process.env.W12_COMPANY_NAME || "W12 Rehearsal Company",
        organizationId: state.organizationId, creationRequestId: state.companyRequestId } });
    if (!isUuid(company.id)) throw new Error("company response lacks id");
    state.companyId = company.id;
    await saveState(dir, state);
  }
  if (!state.agentId) {
    if (!state.pendingAgent) {
      const hire = await request(origin, "POST", `/companies/${state.companyId}/agent-hires`, { cookie,
        body: { name: "W12 Codex worker", adapterType: "codex_local", adapterConfig: {} } });
      if (!isUuid(hire.agent?.id) || !isUuid(hire.approval?.id) ||
          hire.agent.status !== "pending_approval" || hire.approval.status !== "pending") {
        throw new Error("hire response lacks pending agent and approval");
      }
      state.pendingAgent = { agentId: hire.agent.id, approvalId: hire.approval.id };
      await saveState(dir, state);
    }
    const { agentId, approvalId } = state.pendingAgent;
    const approval = await request(origin, "GET", `/approvals/${approvalId}`, { cookie });
    if (approval.status === "pending") {
      const decided = await request(origin, "POST", `/approvals/${approvalId}/approve`, { cookie,
        body: { decisionNote: "Founder approval for isolated W12 rehearsal" } });
      if (decided.status !== "approved") throw new Error("hire approval did not become approved");
    } else if (approval.status !== "approved") {
      throw new Error("hire approval is not pending or approved");
    }
    const agent = await request(origin, "GET", `/agents/${agentId}`, { cookie });
    if (agent.id !== agentId || agent.status !== "idle") throw new Error("approved agent is not idle");
    state.agentId = agentId;
    state.hireApprovalId = approvalId;
    delete state.pendingAgent;
    await saveState(dir, state);
  }
  return { phase: "seed-identity", organizationId: state.organizationId,
    companyId: state.companyId, agentId: state.agentId };
}

async function seed(dir, origin, state) {
  await seedIdentity(dir, origin, state);
  const cookie = await boardCookie(dir);
  if (!state.openAiSecretId) {
    const secret = await request(origin, "POST", `/companies/${state.companyId}/secrets`, { cookie,
      body: { name: "provider:openai", provider: "local_encrypted", managedMode: "aoa_managed",
        value: await readInputSecret("W12_OPENAI_KEY_FILE") } });
    if (!isUuid(secret.id)) throw new Error("OpenAI secret response lacks id");
    state.openAiSecretId = secret.id;
    await saveState(dir, state);
  }
  if (!state.e2bProviderKeyId) {
    const key = await request(origin, "POST", `/companies/${state.companyId}/runtime-provider-keys/with-secret`, { cookie,
      body: { displayName: "W12 rehearsal E2B", provider: "e2b", isDefault: true,
        value: await readInputSecret("W12_E2B_KEY_FILE") } });
    if (!isUuid(key.id)) throw new Error("E2B provider-key response lacks id");
    state.e2bProviderKeyId = key.id;
    await saveState(dir, state);
  }
  return { phase: "seed", organizationId: state.organizationId, companyId: state.companyId, agentId: state.agentId };
}

async function provisionTarget(dir, origin, state) {
  if (!isUuid(state.organizationId)) throw new Error("run seed first");
  const cookie = await boardCookie(dir);
  const slug = process.env.W12_TARGET_SLUG?.trim() || CANARY_EXECUTION_TARGET_SLUG;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) throw new Error("invalid W12_TARGET_SLUG");
  const unsigned = { ...providerConstraintProfileUnsigned(), profileId: "w12-real-e2b" };
  const digest = sha256(canonicalProviderConstraintProfileDigestInputV1(unsigned));
  const provider = { ...unsigned, digest };
  if (state.targets?.some((item) => item.slug === slug)) {
    throw new Error("target slug is already provisioned in private state");
  }
  if (state.pendingTarget && state.pendingTarget.slug !== slug) {
    throw new Error("target provisioning is pending for another slug");
  }
  // A replacement is always a fresh authority. Persist the created target ID
  // before ratification, so a retry resumes rather than attempting a duplicate slug.
  const target = state.pendingTarget || await request(origin, "POST", `/organizations/${state.organizationId}/execution-targets`, { cookie,
    body: { slug, kind: "dedicated_worker", trustClass: "dedicated_tenant", status: "active",
      capabilities: { providerConstraints: { profileId: provider.profileId, version: provider.version,
        digest: provider.digest } } } });
  if (!isUuid(target.id)) throw new Error("target response lacks id");
  if (!state.pendingTarget) {
    state.pendingTarget = { id: target.id, slug, deviceGeneration: target.deviceGeneration,
      capabilities: target.capabilities };
    await saveState(dir, state);
  }
  // The digest is based on the exact M1 profile source and the protocol canonicalizer.
  // Enrollment reads capabilities.providerConstraints, so it must be correct at CREATE.
  // This guard catches a future helper change before issuing a one-use code.
  if (target.capabilities?.providerConstraints?.digest !== digest) {
    throw new Error("target capability digest differs from registered provider profile");
  }
  const generation = Number(target.deviceGeneration ?? target.device_generation);
  if (!Number.isInteger(generation) || generation < 1) throw new Error("target generation is invalid");
  const profile = registeredTargetProfile({ targetId: target.id, organizationId: state.organizationId,
    provider, deviceGeneration: generation, policyHash: taskRunPolicyHash() });
  const ratified = await request(origin, "PUT", `/organizations/${state.organizationId}/execution-targets/${target.id}/placement-profile`, { cookie,
    body: { registeredProfile: profile, providerConstraintProfile: provider } });
  if (!/^[0-9a-f]{64}$/.test(ratified.registeredProfileHash ?? "")) throw new Error("target ratification lacks profile hash");
  const issued = await request(origin, "POST", `/organizations/${state.organizationId}/execution-targets/${target.id}/enrollment-codes`, { cookie,
    body: { scope: "organization", ownerUserId: null } });
  const ticket = encodeEnrollmentTicket({ targetId: target.id, code: issued.code });
  const filename = `enrollment-${target.id}.ticket`;
  await privateWrite(dir, filename, `${ticket}\n`);
  state.targets ??= [];
  state.targets.push({ id: target.id, slug, registeredProfileHash: ratified.registeredProfileHash,
    ticketFile: filename, enrollmentExpiresAt: issued.expiresAt });
  delete state.pendingTarget;
  await saveState(dir, state);
  return { phase: "provision-target", targetId: target.id, slug,
    registeredProfileHash: ratified.registeredProfileHash, ticketFile: path.join(dir, filename) };
}

async function handoffTarget(dir, origin, state) {
  if (!isUuid(state.organizationId)) throw new Error("run seed first");
  const retiredTargetId = requireEnv("W12_RETIRED_TARGET_ID").toLowerCase();
  const successorTargetId = requireEnv("W12_SUCCESSOR_TARGET_ID").toLowerCase();
  if (!isUuid(retiredTargetId) || !isUuid(successorTargetId) || retiredTargetId === successorTargetId) {
    throw new Error("invalid W12 handoff target IDs");
  }
  const retired = state.targets?.find((target) => target.id === retiredTargetId);
  const successor = state.targets?.find((target) => target.id === successorTargetId);
  if (!retired || !successor) throw new Error("target IDs must be provisioned in private state");
  const cookie = await boardCookie(dir);
  const result = await request(origin, "POST",
    `/organizations/${state.organizationId}/execution-targets/${retiredTargetId}/successor`,
    { cookie, body: { successorTargetId } });
  const retiredSlug = `retired-to-${successorTargetId}`;
  if (!["handed_off", "already_current"].includes(result.result) ||
      result.organizationId !== state.organizationId ||
      result.retiredTargetId !== retiredTargetId || result.successorTargetId !== successorTargetId ||
      result.retiredSlug !== retiredSlug || result.executionTargetSlug !== CANARY_EXECUTION_TARGET_SLUG) {
    throw new Error("target handoff response does not match requested transition");
  }
  retired.slug = retiredSlug;
  successor.slug = CANARY_EXECUTION_TARGET_SLUG;
  await saveState(dir, state);
  return { phase: "handoff-target", result: result.result, retiredTargetId,
    successorTargetId, retiredSlug, executionTargetSlug: CANARY_EXECUTION_TARGET_SLUG };
}

async function submit(dir, origin, state) {
  if (!isUuid(state.companyId) || !isUuid(state.agentId)) throw new Error("run seed first");
  const cookie = await boardCookie(dir);
  const descriptionFile = requireEnv("W12_TASK_DESCRIPTION_FILE");
  const description = await readFile(descriptionFile, "utf8");
  if (!description.trim()) throw new Error("task description is empty");
  const issue = await request(origin, "POST", `/companies/${state.companyId}/issues`, { cookie,
    body: { title: process.env.W12_TASK_TITLE?.trim() || "W12 real E2B/OpenAI governed output",
      description, status: "todo", workMode: "standard", assigneeAgentId: state.agentId } });
  if (!isUuid(issue.id)) throw new Error("task response lacks id");
  state.issues ??= [];
  state.issues.push({ id: issue.id, createdAt: new Date().toISOString() });
  state.currentIssueId = issue.id;
  await saveState(dir, state);
  return { phase: "submit", issueId: issue.id, wakeSkippedReason: issue.wakeSkippedReason ?? null };
}

async function observe(dir, origin, state) {
  const issueId = process.env.W12_ISSUE_ID?.trim() || state.currentIssueId;
  if (!isUuid(issueId) || !isUuid(state.companyId)) throw new Error("issue/company id is missing");
  const cookie = await boardCookie(dir);
  const runs = await request(origin, "GET", `/companies/${state.companyId}/heartbeat-runs?agentId=${state.agentId}&limit=100`, { cookie });
  if (!Array.isArray(runs)) throw new Error("heartbeat-runs response is invalid");
  const own = runs.filter((run) =>
    run.contextSnapshot?.issueId === issueId || run.contextSnapshot?.taskId === issueId);
  const jobs = [...new Set(own.map((run) => run.distributedJobId).filter(isUuid))];
  const requestedJobId = process.env.W12_JOB_ID?.trim() || null;
  if (requestedJobId && (!isUuid(requestedJobId) || !jobs.includes(requestedJobId))) {
    throw new Error("W12_JOB_ID is not a distributed job for this task in the listed runs");
  }
  if (jobs.length > 1 && !requestedJobId) {
    throw new Error("multiple distributed jobs for task; choose W12_JOB_ID explicitly");
  }
  const jobId = requestedJobId || jobs[0] || null;
  const detail = jobId ? await request(origin, "GET",
    `/organizations/${state.organizationId}/companies/${state.companyId}/jobs/${jobId}`, { cookie }) : null;
  const outputs = await request(origin, "GET", `/issues/${issueId}/outputs`, { cookie });
  if (!Array.isArray(outputs)) throw new Error("task output response is invalid");
  const linked = (detail?.artifacts ?? []).filter((artifact) => artifact.status === "committed" && isUuid(artifact.outputId));
  if (jobId) { state.currentJobId = jobId; await saveState(dir, state); }
  return { phase: "observe", issueId, runIds: own.map((run) => run.id).filter(isUuid),
    executionOwners: own.map((run) => run.executionOwner ?? null), jobId,
    jobStatus: detail?.job?.status ?? null,
    attempts: (detail?.attempts ?? []).map((attempt) => ({ id: attempt.id, status: attempt.status })),
    leases: (detail?.leases ?? []).map((lease) => ({ id: lease.id, status: lease.status })),
    committedOutputs: linked.map((artifact) => ({ outputId: artifact.outputId, artifactId: artifact.id,
      sha256: artifact.sha256, sizeBytes: artifact.sizeBytes })),
    projectedOutputIds: outputs.filter((output) => output.provider === "aoa_distributed_job").map((output) => output.id) };
}

async function download(dir, origin, state) {
  const outputId = requireEnv("W12_OUTPUT_ID");
  if (!isUuid(outputId)) throw new Error("W12_OUTPUT_ID must be a UUID");
  const jobId = process.env.W12_JOB_ID?.trim() || state.currentJobId;
  if (!isUuid(jobId) || !isUuid(state.organizationId) || !isUuid(state.companyId)) {
    throw new Error("job/tenant id is missing; run observe first");
  }
  const cookie = await boardCookie(dir);
  const detail = await request(origin, "GET",
    `/organizations/${state.organizationId}/companies/${state.companyId}/jobs/${jobId}`, { cookie });
  const matching = (detail.artifacts ?? []).filter((artifact) =>
    artifact.status === "committed" && artifact.outputId === outputId &&
    !artifact.recoveryQuarantinedAt && /^[0-9a-f]{64}$/.test(artifact.sha256 ?? ""));
  if (matching.length !== 1) throw new Error("output is not uniquely linked to this committed job");
  const bytes = await request(origin, "GET", `/task-outputs/${outputId}/content`, { cookie, bytes: true });
  const artifact = matching[0];
  if (bytes.length !== artifact.sizeBytes || sha256(bytes) !== artifact.sha256) {
    throw new Error("download differs from committed artifact digest");
  }
  const filename = `output-${outputId}.bin`;
  await privateWrite(dir, filename, bytes);
  const expected = await readFile(requireEnv("W12_EXPECTED_OUTPUT_FILE"));
  if (!bytes.equals(expected)) throw new Error("download differs from expected bytes");
  return { phase: "download", outputId, file: path.join(dir, filename), sizeBytes: bytes.length,
    sha256: sha256(bytes), exactMatch: true };
}

async function main() {
  const phase = process.argv[2];
  if (!phases.has(phase)) throw new Error("phase must be seed-identity, refresh-session, seed, provision-target, handoff-target, submit, observe, or download");
  const dir = await privateDir();
  const origin = baseUrl();
  const state = await loadState(dir);
  const result = phase === "seed-identity" ? await seedIdentity(dir, origin, state)
    : phase === "refresh-session" ? await refreshSession(dir, origin, state)
    : phase === "seed" ? await seed(dir, origin, state)
    : phase === "provision-target" ? await provisionTarget(dir, origin, state)
    : phase === "handoff-target" ? await handoffTarget(dir, origin, state)
    : phase === "submit" ? await submit(dir, origin, state)
    : phase === "observe" ? await observe(dir, origin, state)
    : await download(dir, origin, state);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  // Fetch/JSON/provider errors can contain response bodies or secret values. Print
  // only our own controlled messages, never a stack or raw response.
  const safe = error instanceof ApiRequestError ||
    (typeof error?.message === "string" &&
      /^(missing |invalid |W12_|phase must|task description|issue\/company|run seed|multiple distributed|network-policy|target |organization response|company response|hire response|hire approval|approved agent|OpenAI secret|E2B provider|test session|heartbeat-runs|task output|private board|download differs)/.test(error.message));
  process.stderr.write(`w12-api: ${safe ? error.message : "operation failed; inspect private service logs"}\n`);
  process.exitCode = 1;
});

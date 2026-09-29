const API_ORIGIN = "https://api.e2b.app";
const LIMITS = Object.freeze({ sandboxIds: 100, pages: 20, eventPagesPerSandbox: 20, pageSize: 100, bodyBytes: 1_048_576, tokenChars: 2048 });
const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
const validItem = (item) => item !== null && typeof item === "object" && !Array.isArray(item)
  && validId(item.sandboxID) && ["running", "paused"].includes(item.state);
const eventFields = ["id", "version", "type", "timestamp", "sandboxId", "sandboxTeamId", "sandboxExecutionId", "sandboxTemplateId", "sandboxBuildId"];
const eventTypes = ["created", "killed", "paused", "resumed", "updated", "checkpointed"].map((type) => `sandbox.lifecycle.${type}`);
const transitionTypes = ["created", "killed", "paused", "resumed"].map((type) => `sandbox.lifecycle.${type}`);
const timestamp = (value) => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ? Date.parse(value) : NaN;
const validEvent = (event) => event && ["v1", "v2"].includes(event.version)
  && eventTypes.includes(event.type) && Number.isFinite(timestamp(event.timestamp))
  && ["id", "sandboxId", "sandboxTeamId", "sandboxExecutionId", "sandboxTemplateId", "sandboxBuildId"].every((key) => validId(event[key]));

function terminalPair(events, resource) {
  const failure = (reason) => ({ reason, terminal: null });
  if (events.some((event) => event.sandboxId !== resource.sandboxId)
    || new Set(events.map((event) => event.sandboxTeamId)).size > 1) return failure("identity_mismatch");
  const transitions = events.filter((event) => transitionTypes.includes(event.type))
    .sort((a, b) => timestamp(b.timestamp) - timestamp(a.timestamp));
  const killed = transitions.find((event) => event.type === "sandbox.lifecycle.killed");
  if (!killed) return failure("lifecycle_pair_missing");
  const killedAt = timestamp(killed.timestamp);
  if (transitions.some((event) => timestamp(event.timestamp) > killedAt)) return failure("later_lifecycle_transition");
  if (transitions.some((event) => timestamp(event.timestamp) === killedAt
    && (event.type !== killed.type || event.sandboxExecutionId !== killed.sandboxExecutionId))) return failure("ambiguous_lifecycle_order");
  const created = transitions.find((event) => event.type === "sandbox.lifecycle.created"
    && event.sandboxExecutionId === killed.sandboxExecutionId);
  if (!created) return failure("lifecycle_pair_missing");
  const started = transitions.find((event) => ["sandbox.lifecycle.created", "sandbox.lifecycle.resumed"].includes(event.type));
  if (started.sandboxExecutionId !== killed.sandboxExecutionId
    || created.sandboxTemplateId !== killed.sandboxTemplateId || created.sandboxBuildId !== killed.sandboxBuildId
    || (resource.teamId !== undefined && resource.teamId !== killed.sandboxTeamId)
    || (resource.executionId !== undefined && resource.executionId !== killed.sandboxExecutionId)) return failure("identity_mismatch");
  if (timestamp(created.timestamp) < timestamp(resource.notBefore) || killedAt > timestamp(resource.notAfter)
    || killedAt > Date.now()) return failure("lifecycle_outside_window");
  return { reason: "terminal_pair_observed", terminal: {
    teamId: killed.sandboxTeamId, executionId: killed.sandboxExecutionId,
    createdEventId: created.id, killedEventId: killed.id, createdAt: created.timestamp, killedAt: killed.timestamp,
  } };
}

class ObservationError extends Error {}
function cancel(body) {
  try { void Promise.resolve(body?.cancel()).catch(() => {}); } catch { /* No raw transport diagnostics. */ }
}

async function readJson(response, signal, checkDeadline) {
  if (!response.headers.get("content-type")?.split(";")[0].trim().toLowerCase().endsWith("/json")) {
    cancel(response.body);
    throw new ObservationError("malformed_response");
  }
  if (Number(response.headers.get("content-length")) > LIMITS.bodyBytes) {
    cancel(response.body);
    throw new ObservationError("body_limit");
  }
  if (!response.body?.getReader) throw new ObservationError("malformed_response");
  const reader = response.body.getReader();
  const abort = () => cancel(reader);
  signal.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      checkDeadline();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > LIMITS.bodyBytes) throw new ObservationError("body_limit");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const value = JSON.parse(text);
    checkDeadline();
    return value;
  } catch (error) {
    cancel(reader);
    throw error instanceof ObservationError ? error : new ObservationError("malformed_response");
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

/**
 * Logical provider sandbox deletion: authenticated same-team/execution lifecycle
 * pair inside an independently supplied DB lease window, then a complete list.
 * E2B GET documents 404 as missing OR inaccessible; upstream also returns 404
 * while StateKilling. A complete running+paused list does not close that gap.
 * https://docs.e2b.dev/api-reference/sandboxes/get-sandbox
 * https://github.com/e2b-dev/infra/blob/5cfcf3282ddb95e90a8214ce71329641bdfe6cb6/packages/api/internal/handlers/sandbox_get.go
 *
 * resources: [{ sandboxId, notBefore, notAfter, teamId?, executionId? }]. Window
 * bounds come from leaseCreatedAt and the post-Compose-down observer start,
 * NOT provider events or the earlier pre-down inventory snapshot.
 * Optional independently recorded identity pins must match. Otherwise identity
 * is observed via the same authenticated event/list context, not admission-approved.
 * https://docs.e2b.dev/api-reference/events/list-sandbox-events
 * https://github.com/e2b-dev/infra/blob/5cfcf3282ddb95e90a8214ce71329641bdfe6cb6/packages/orchestrator/pkg/server/sandboxes.go#L723
 *
 * No environment/SDK configuration, redirects, retries, connect, kill or writes.
 * Cloud endpoint only. The caller owns complete candidate/job/lease inventory
 * and endpoint/account binding. List completeness is traversal only, not an
 * atomic snapshot or complete campaign ownership proof. Caller must quiesce
 * create/resume before observing. No paused-delete receipt path is implemented.
 * Unrelated IDs,
 * arbitrary metadata, tokens and errors are never copied into the report.
 * Limits: 100 input IDs, 20 list pages and 20 event pages per ID (100 rows/page),
 * 1 MiB per response, 2048-char list tokens; shared 10s deadline (1..180000ms).
 * At most 2120 GETs, no polling. Duplicate IDs require identical supplied binding.
 * Legacy sandboxIds without resource windows remain visibility-only/unknown.
 */
export async function observeE2bCleanup({ apiKey, resources, sandboxIds, fetchFn = fetch, deadlineMs = 10_000 } = {}) {
  const startedAt = new Date().toISOString();
  const report = {
    scope: "e2b-logical-sandbox-deletion", endpoint: API_ORIGIN,
    startedAt, finishedAt: null, pass: false,
    absenceContract: "authenticated-lifecycle-pair-and-unlisted", identityAuthority: "provider-observed-not-admission-approved", limits: { ...LIMITS },
    observations: [],
    inventory: { complete: false, pages: 0, items: 0, httpStatus: null, reason: "not_observed" },
    violations: [],
  };
  const finish = () => ({ ...report, finishedAt: new Date().toISOString() });
  const expected = resources === undefined && Array.isArray(sandboxIds) ? sandboxIds.map((sandboxId) => ({ sandboxId })) : resources;
  const validResource = (row) => row && validId(row.sandboxId)
    && (row.teamId === undefined || validId(row.teamId)) && (row.executionId === undefined || validId(row.executionId))
    && ((row.notBefore === undefined && row.notAfter === undefined)
      || (Number.isFinite(timestamp(row.notBefore)) && Number.isFinite(timestamp(row.notAfter))
        && timestamp(row.notBefore) < timestamp(row.notAfter)));
  const bindings = new Map();
  let validBindings = Array.isArray(expected) && expected.length > 0 && expected.length <= LIMITS.sandboxIds;
  if (validBindings) for (const row of expected) {
    if (!validResource(row)) { validBindings = false; break; }
    const binding = { sandboxId: row.sandboxId, notBefore: row.notBefore, notAfter: row.notAfter, teamId: row.teamId, executionId: row.executionId };
    if (bindings.has(row.sandboxId) && JSON.stringify(bindings.get(row.sandboxId)) !== JSON.stringify(binding)) {
      validBindings = false;
      break;
    }
    bindings.set(row.sandboxId, binding);
  }
  if (resources !== undefined && sandboxIds !== undefined && (!Array.isArray(sandboxIds)
    || sandboxIds.length !== bindings.size || !sandboxIds.every((id) => bindings.has(id)) || new Set(sandboxIds).size !== bindings.size)) validBindings = false;
  if (typeof apiKey !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(apiKey) || !validBindings || typeof fetchFn !== "function"
    || !Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 180_000) {
    report.violations.push("invalid_observer_input");
    return finish();
  }
  const observations = new Map([...bindings.keys()].map((sandboxId) => [sandboxId, {
    sandboxId, status: "unknown", reason: "sandbox_absence_unknown",
    getInfo: { httpStatus: null, state: null, reason: "not_observed" }, listedState: null,
    events: { complete: false, pages: 0, items: 0, httpStatus: null, reason: "identity_unavailable", terminal: null },
  }]));
  report.deadlineMs = deadlineMs;
  const controller = new AbortController();
  const expiresAt = performance.now() + deadlineMs;
  const checkDeadline = () => {
    if (controller.signal.aborted || performance.now() >= expiresAt) {
      controller.abort();
      throw new ObservationError("deadline_exceeded");
    }
  };
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ObservationError("deadline_exceeded"));
    }, deadlineMs);
  });
  // Race bounds even an injected fetch that ignores AbortSignal; native fetch
  // and response streams are also aborted so no background provider work stays.
  async function request(url) {
    let httpStatus = null;
    try {
      checkDeadline();
      return await Promise.race([deadline, (async () => {
        const response = await fetchFn(url, {
          method: "GET", redirect: "error", signal: controller.signal,
          headers: { "X-API-Key": apiKey, Accept: "application/json" },
        });
        if (controller.signal.aborted || performance.now() >= expiresAt) {
          cancel(response?.body);
          checkDeadline();
        }
        if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
          throw new ObservationError("malformed_response");
        }
        httpStatus = response.status;
        if (response.redirected || (response.url && response.url !== String(url))) {
          cancel(response.body);
          throw new ObservationError("unexpected_response_url");
        }
        if (httpStatus !== 200) {
          cancel(response.body);
          return { httpStatus, reason: httpStatus === 404 ? "not_found_or_inaccessible" : "http_error" };
        }
        const data = await readJson(response, controller.signal, checkDeadline);
        const nextToken = response.headers.get("x-next-token") || null;
        checkDeadline();
        return { httpStatus, data, reason: null, nextToken };
      })()]);
    } catch (error) {
      return { httpStatus, reason: controller.signal.aborted ? "deadline_exceeded"
        : error instanceof ObservationError ? error.message : "request_failed" };
    }
  }
  async function observeEvents(resource, observation) {
    if (resource.notBefore === undefined) return;
    const facts = observation.events;
    const events = new Map();
    for (let page = 0; page < LIMITS.eventPagesPerSandbox; page++) {
      const url = new URL(`/events/sandboxes/${resource.sandboxId}`, API_ORIGIN);
      url.searchParams.set("limit", String(LIMITS.pageSize));
      url.searchParams.set("offset", String(page * LIMITS.pageSize));
      url.searchParams.set("orderAsc", "false");
      const result = await request(url);
      facts.httpStatus = result.httpStatus;
      if (result.reason) { facts.reason = result.reason; return; }
      if (!Array.isArray(result.data) || result.data.length > LIMITS.pageSize || !result.data.every(validEvent)) {
        facts.reason = "malformed_response";
        return;
      }
      const previousSize = events.size;
      for (const raw of result.data) {
        // REST uses camelCase; webhook payloads have a different schema. Only
        // bounded identity/lifecycle fields enter evidence, never eventData.
        const event = Object.fromEntries(eventFields.map((key) => [key, raw[key]]));
        if (events.has(event.id) && JSON.stringify(events.get(event.id)) !== JSON.stringify(event)) {
          facts.reason = "conflicting_event_id";
          return;
        }
        events.set(event.id, event);
      }
      facts.pages++;
      facts.items = events.size;
      if (result.data.length < LIMITS.pageSize) {
        facts.complete = true;
        Object.assign(facts, terminalPair([...events.values()], resource));
        return;
      }
      if (events.size === previousSize) { facts.reason = "event_pagination_stalled"; return; }
      facts.reason = "page_limit";
    }
  }
  try {
    for (const observation of observations.values()) {
      const result = await request(new URL(`/sandboxes/${observation.sandboxId}`, API_ORIGIN));
      const present = !result.reason && validItem(result.data) && result.data.sandboxID === observation.sandboxId;
      observation.getInfo = { httpStatus: result.httpStatus, state: present ? result.data.state : null,
        reason: present ? "present" : result.reason || "malformed_response" };
      await observeEvents(bindings.get(observation.sandboxId), observation);
    }
    let nextToken = null;
    const tokens = new Set();
    for (let page = 0; page < LIMITS.pages; page++) {
      const url = new URL("/v2/sandboxes", API_ORIGIN);
      url.searchParams.set("state", "running,paused");
      url.searchParams.set("limit", String(LIMITS.pageSize));
      if (nextToken !== null) url.searchParams.set("nextToken", nextToken);
      const result = await request(url);
      report.inventory.httpStatus = result.httpStatus;
      if (result.reason) { report.inventory.reason = result.reason; break; }
      if (!Array.isArray(result.data) || result.data.length > LIMITS.pageSize || !result.data.every(validItem)) {
        report.inventory.reason = "malformed_response";
        break;
      }
      report.inventory.pages++;
      report.inventory.items += result.data.length;
      for (const item of result.data) {
        const observation = observations.get(item.sandboxID);
        if (observation) observation.listedState = item.state;
      }
      nextToken = result.nextToken;
      if (nextToken === null) {
        report.inventory.complete = true;
        report.inventory.reason = "traversal_complete";
        break;
      }
      if (nextToken.length > LIMITS.tokenChars || !/^[\x21-\x7e]+$/.test(nextToken)) {
        report.inventory.reason = "malformed_pagination";
        break;
      }
      if (tokens.has(nextToken)) { report.inventory.reason = "pagination_cycle"; break; }
      tokens.add(nextToken);
      report.inventory.reason = "page_limit";
    }
    const observedTeams = new Set([...observations.values()].flatMap((row) => row.events.terminal ? [row.events.terminal.teamId] : []));
    const identityMismatch = observedTeams.size > 1;
    if (identityMismatch) report.violations.push("provider_identity_mismatch");
    if (performance.now() >= expiresAt) {
      controller.abort();
      report.inventory.complete = false;
      report.inventory.reason = "deadline_exceeded";
    }
    for (const observation of observations.values()) {
      if (observation.getInfo.state || observation.listedState) {
        observation.status = "present";
        observation.reason = "sandbox_still_present";
      } else if (observation.getInfo.reason === "not_found_or_inaccessible" && observation.events.terminal
        && observation.events.complete && report.inventory.complete && !identityMismatch) {
        observation.status = "absent";
        observation.reason = "logical_deletion_observed";
      }
    }
    report.observations = [...observations.values()];
    if (report.observations.some((row) => row.status === "present")) report.violations.push("sandbox_still_present");
    if (report.observations.some((row) => row.status === "unknown")) report.violations.push("sandbox_absence_unknown");
    if (!report.inventory.complete) report.violations.push("provider_inventory_unknown");
    report.pass = report.violations.length === 0;
    return finish();
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

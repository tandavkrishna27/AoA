import { test } from "node:test";
import assert from "node:assert/strict";
import { observeE2bCleanup as observe } from "../m1-provider-cleanup.mjs";
const apiKey = "inert-offline-key";
const sandboxIds = ["owned-one"];
const detail = (sandboxID = "owned-one", state = "running") => ({
  sandboxID, state, templateID: "template-one", clientID: "client-one",
  startedAt: "2026-09-29T00:00:00Z", endAt: "2026-09-29T01:00:00Z",
  envdVersion: "0.0.0", cpuCount: 2, memoryMB: 512, diskSizeMB: 1024,
  metadata: {}, envdAccessToken: "private-envd-token",
});
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", ...headers },
});
function transport(get, pages = [() => json([])]) {
  const calls = [];
  let page = 0;
  return {
    calls,
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      const parsed = new URL(url);
      assert.equal(parsed.origin, "https://api.e2b.app");
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers["X-API-Key"], apiKey);
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.body, undefined);
      if (parsed.pathname === "/v2/sandboxes") {
        assert.equal(parsed.searchParams.get("state"), "running,paused");
        assert.equal(parsed.searchParams.get("limit"), "100");
        assert.equal(parsed.searchParams.has("metadata"), false);
        assert.ok(page < pages.length, "unexpected extra page");
        return pages[page++](parsed, options);
      }
      assert.ok(parsed.pathname.startsWith("/sandboxes/"));
      return get(parsed, options);
    },
  };
}
async function run(get, pages, options = {}) {
  const mock = transport(get, pages);
  const result = await observe({ apiKey, sandboxIds, ...options, fetchFn: mock.fetchFn });
  return { result, calls: mock.calls };
}

for (const state of ["running", "paused"]) {
  test(`${state} GET is positive presence, never cleanup success`, async () => {
    const { result, calls } = await run(() => json(detail("owned-one", state)));
    assert.equal(result.pass, false);
    assert.equal(result.observations[0].status, "present");
    assert.equal(result.observations[0].getInfo.state, state);
    assert.ok(result.violations.includes("sandbox_still_present"));
    assert.equal(calls.length, 2);
    assert.equal(JSON.stringify(result).includes("private-envd-token"), false);
  });
}

test("404 plus complete empty list remains unknown: inaccessible or still killing is possible", async () => {
  const { result } = await run(() => json({ code: 404, message: "private error" }, 404));
  assert.equal(result.pass, false);
  assert.equal(result.scope, "e2b-logical-sandbox-deletion");
  assert.equal(result.inventory.complete, true);
  assert.equal(result.observations[0].status, "unknown");
  assert.equal(result.observations[0].getInfo.reason, "not_found_or_inaccessible");
  assert.equal(result.observations[0].events.reason, "identity_unavailable");
  assert.equal(JSON.stringify(result).includes("private error"), false);
});

test("paused presence on a later page overrides GET 404, including an empty first page", async () => {
  const { result, calls } = await run(() => json({ code: 404 }, 404), [
    () => json([], 200, { "x-next-token": "opaque+/=?&token" }),
    (url) => {
      assert.equal(url.searchParams.get("nextToken"), "opaque+/=?&token");
      return json([detail("owned-one", "paused"), detail("unrelated-secret-id")]);
    },
  ]);
  assert.equal(result.observations[0].status, "present");
  assert.equal(result.observations[0].listedState, "paused");
  assert.equal(result.inventory.pages, 2);
  assert.equal(result.inventory.complete, true);
  assert.equal(calls.length, 3);
  assert.equal(JSON.stringify(result).includes("unrelated-secret-id"), false);
});

for (const status of [400, 401, 403, 404, 429, 500, 503]) {
  test(`GET HTTP ${status} never trusts a JSON code404 as absence`, async () => {
    const { result } = await run(() => json({ code: 404, message: apiKey }, status));
    assert.equal(result.observations[0].status, "unknown");
    assert.equal(result.observations[0].getInfo.httpStatus, status);
    assert.equal(result.pass, false);
    assert.equal(JSON.stringify(result).includes(apiKey), false);
  });
}

for (const [label, response] of [
  ["null", () => json(null)],
  ["empty object", () => json({})],
  ["wrong ID", () => json(detail("other"))],
  ["unknown state", () => json(detail("owned-one", "killing"))],
  ["empty successful body", () => new Response(null, { status: 200 })],
  ["204", () => new Response(null, { status: 204 })],
  ["malformed JSON", () => new Response("{private", { headers: { "content-type": "application/json" } })],
  ["HTML success", () => new Response("<html>private</html>")],
  ["redirect", () => new Response(null, { status: 302, headers: { location: "https://untrusted.invalid" } })],
]) {
  test(`${label} GET response cannot establish presence or absence`, async () => {
    const { result } = await run(response);
    assert.equal(result.observations[0].status, "unknown");
    assert.equal(result.pass, false);
  });
}

for (const [label, page] of [
  ["null", () => json(null)],
  ["object", () => json({})],
  ["invalid item", () => json([{}])],
  ["unknown state", () => json([detail("owned-one", "deleted")])],
  ["oversized page", () => json(Array.from({ length: 101 }, (_, i) => detail(`item-${i}`)))],
  ["401", () => json({ code: 404 }, 401)],
  ["403", () => json({ code: 404 }, 403)],
  ["404", () => json({ code: 404 }, 404)],
  ["429", () => json({}, 429)],
  ["503", () => json({}, 503)],
]) {
  test(`${label} list page is incomplete, not an empty inventory`, async () => {
    const { result } = await run(() => json({ code: 404 }, 404), [page]);
    assert.equal(result.inventory.complete, false);
    assert.ok(result.violations.includes("provider_inventory_unknown"));
    assert.equal(result.pass, false);
  });
}

test("later-page failure retains already observed presence but not list completeness", async () => {
  const { result } = await run(() => json({ code: 404 }, 404), [
    () => json([detail()], 200, { "x-next-token": "page2" }),
    () => json({}, 503),
  ]);
  assert.equal(result.observations[0].status, "present");
  assert.equal(result.inventory.complete, false);
  assert.equal(result.inventory.httpStatus, 503);
});

test("repeating pagination token stops without treating the partial list as complete", async () => {
  const { result, calls } = await run(() => json({}, 404), [
    () => json([], 200, { "x-next-token": "repeat" }),
    () => json([], 200, { "x-next-token": "repeat" }),
  ]);
  assert.equal(result.inventory.complete, false);
  assert.equal(result.inventory.reason, "pagination_cycle");
  assert.equal(calls.length, 3);
});

test("pagination has a finite page cap even with unique tokens", async () => {
  const { result, calls } = await run(() => json({}, 404), Array.from({ length: 20 }, (_, i) =>
    () => json([], 200, { "x-next-token": `page${i}` })));
  assert.equal(result.inventory.complete, false);
  assert.equal(result.inventory.reason, "page_limit");
  assert.equal(calls.length, 21);
});

test("an oversized response body is cancelled without serializing it", async () => {
  let cancelled = false;
  const { result } = await run(() => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1_048_577)); },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "application/json" } }));
  assert.equal(result.observations[0].getInfo.reason, "body_limit");
  assert.equal(cancelled, true);
});

for (const phase of ["fetch", "body"]) {
  test(`shared deadline bounds a hanging ${phase} and starts no later requests`, async () => {
    let signal;
    let calls = 0;
    const result = await observe({ apiKey, sandboxIds, deadlineMs: 25, fetchFn: async (_url, options) => {
      calls++;
      signal = options.signal;
      if (phase === "fetch") return new Promise(() => {});
      return new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } });
    } });
    assert.equal(calls, 1);
    assert.equal(signal.aborted, true);
    assert.equal(result.observations[0].getInfo.reason, "deadline_exceeded");
    assert.equal(result.inventory.complete, false);
    assert.equal(result.pass, false);
  });
}

test("network exceptions are closed diagnostics, never credential-bearing error text", async () => {
  const { result } = await run(() => { throw new Error(`private ${apiKey}`); });
  assert.equal(result.observations[0].getInfo.reason, "request_failed");
  assert.equal(result.observations[0].status, "unknown");
  assert.equal(JSON.stringify(result).includes(apiKey), false);
});

for (const options of [
  { apiKey: "" }, { apiKey: "bad\nkey" }, { sandboxIds: [] }, { sandboxIds: null },
  { sandboxIds: ["../escape"] }, { sandboxIds: ["secret?token=value"] },
  { sandboxIds: Array.from({ length: 101 }, (_, i) => `id${i}`) },
  { deadlineMs: 0 }, { deadlineMs: Infinity }, { deadlineMs: 180_001 },
]) {
  test(`invalid input ${JSON.stringify(options)} makes zero requests and never passes`, async () => {
    let calls = 0;
    const result = await observe({ apiKey, sandboxIds, ...options, fetchFn: () => { calls++; } });
    assert.equal(calls, 0);
    assert.equal(result.pass, false);
    assert.ok(result.violations.includes("invalid_observer_input"));
  });
}

test("duplicate expected IDs are observed once, and input is not mutated", async () => {
  const ids = Object.freeze(["owned-one", "owned-one"]);
  const { result, calls } = await run(() => json(detail()), undefined, { sandboxIds: ids });
  assert.equal(result.observations.length, 1);
  assert.equal(calls.length, 2);
});

test("elapsed wall time is enforced even before the event-loop timer can run", async () => {
  let calls = 0;
  const result = await observe({ apiKey, sandboxIds, deadlineMs: 2, fetchFn: async () => {
    calls++;
    const until = performance.now() + 8;
    while (performance.now() < until) { /* Simulate synchronously consumed response work. */ }
    return json(detail());
  } });
  assert.equal(calls, 1);
  assert.equal(result.observations[0].status, "unknown");
  assert.equal(result.observations[0].getInfo.reason, "deadline_exceeded");
});

for (const token of ["x".repeat(2049), "contains space"]) {
  test(`malformed pagination token (${token.length} chars) is not complete or emitted`, async () => {
    const { result, calls } = await run(() => json({}, 404), [() => json([], 200, { "x-next-token": token })]);
    assert.equal(result.inventory.complete, false);
    assert.equal(result.inventory.reason, "malformed_pagination");
    assert.equal(calls.length, 2);
    assert.equal(JSON.stringify(result).includes(token), false);
  });
}

test("credential-bearing metadata and network fields are never copied into presence evidence", async () => {
  const value = { ...detail(), metadata: { key: apiKey }, network: { password: "private-network-secret" } };
  const { result } = await run(() => json(value), [() => json([value])]);
  assert.equal(result.observations[0].status, "present");
  assert.equal(result.inventory.complete, true);
  for (const secret of [apiKey, "private-network-secret", "private-envd-token"]) {
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

const resource = {
  sandboxId: "owned-one",
  notBefore: "2020-01-01T00:00:00Z", notAfter: "2020-01-01T00:03:00Z",
};
const created = {
  id: "created-event", version: "v2", type: "sandbox.lifecycle.created",
  timestamp: "2020-01-01T00:00:01Z", sandboxId: "owned-one",
  sandboxTeamId: "team-one", sandboxExecutionId: "execution-one",
  sandboxTemplateId: "template-one", sandboxBuildId: "build-one",
  eventData: { private: apiKey },
};
const killed = { ...created, id: "killed-event", type: "sandbox.lifecycle.killed", timestamp: "2020-01-01T00:01:00Z" };
async function logicalRun({ events = [killed, created], eventPages, pages, get = () => json({}, 404),
  resources = [resource], deadlineMs } = {}) {
  const base = transport(get, pages);
  const paths = [];
  const offsets = [];
  const replies = eventPages ?? [() => json(events)];
  let index = 0;
  const result = await observe({ apiKey, resources, deadlineMs, fetchFn: async (url, options) => {
    const parsed = new URL(url);
    paths.push(parsed.pathname);
    if (parsed.pathname.startsWith("/events/sandboxes/")) {
      assert.equal(parsed.origin, "https://api.e2b.app");
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers["X-API-Key"], apiKey);
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(parsed.searchParams.get("limit"), "100");
      assert.equal(parsed.searchParams.get("orderAsc"), "false");
      assert.equal(parsed.searchParams.has("types"), false, "must not hide later resumed events");
      offsets.push(parsed.searchParams.get("offset"));
      assert.ok(index < replies.length, "unexpected event page");
      return replies[index++](parsed, options);
    }
    return base.fetchFn(url, options);
  } });
  return { result, paths, offsets };
}

test("logical deletion passes with authenticated created/killed pair and a later exhausted list", async () => {
  const { result, paths } = await logicalRun();
  assert.equal(result.pass, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.observations[0].status, "absent");
  assert.equal(result.observations[0].events.complete, true);
  assert.deepEqual(result.observations[0].events.terminal, {
    teamId: "team-one", executionId: "execution-one", createdEventId: "created-event", killedEventId: "killed-event",
    createdAt: "2020-01-01T00:00:01Z", killedAt: "2020-01-01T00:01:00Z",
  });
  assert.deepEqual(paths, ["/sandboxes/owned-one", "/events/sandboxes/owned-one", "/v2/sandboxes"]);
  assert.equal(JSON.stringify(result).includes(apiKey), false);
});

test("optional independently recorded team and execution pins match without requiring a policy approval", async () => {
  const { result } = await logicalRun({ resources: [{ ...resource, teamId: "team-one", executionId: "execution-one" }], deadlineMs: 180_000 });
  assert.equal(result.pass, true);
});

for (const [label, events, reason] of [
  ["pending killing", [created], "lifecycle_pair_missing"],
  ["empty wrong-account history", [], "lifecycle_pair_missing"],
  ["killed without creation", [killed], "lifecycle_pair_missing"],
  ["different teams", [killed, { ...created, sandboxTeamId: "other-team" }], "identity_mismatch"],
  ["different executions", [{ ...killed, sandboxExecutionId: "other-execution" }, created], "lifecycle_pair_missing"],
  ["different sandbox", [{ ...killed, sandboxId: "other-sandbox" }, created], "identity_mismatch"],
  ["different build", [{ ...killed, sandboxBuildId: "other-build" }, created], "identity_mismatch"],
  ["old creation", [killed, { ...created, timestamp: "2019-12-31T23:59:59Z" }], "lifecycle_outside_window"],
  ["late kill", [{ ...killed, timestamp: "2020-01-01T00:03:01Z" }, created], "lifecycle_outside_window"],
  ["future timestamp", [{ ...killed, timestamp: "2999-01-01T00:01:00Z" }, created], "lifecycle_outside_window"],
  ["reversed lifecycle", [{ ...created, timestamp: "2020-01-01T00:02:00Z" }, killed], "later_lifecycle_transition"],
  ["tied lifecycle", [{ ...killed, timestamp: created.timestamp }, created], "ambiguous_lifecycle_order"],
  ["later resume", [{ ...created, id: "resume", type: "sandbox.lifecycle.resumed", timestamp: "2020-01-01T00:02:00Z" }, killed, created], "later_lifecycle_transition"],
  ["later pause", [{ ...created, id: "pause", type: "sandbox.lifecycle.paused", timestamp: "2020-01-01T00:02:00Z" }, killed, created], "later_lifecycle_transition"],
  ["old execution killed after new execution started", [killed, { ...created, id: "resume", type: "sandbox.lifecycle.resumed", sandboxExecutionId: "execution-two", timestamp: "2020-01-01T00:00:30Z" }, created], "identity_mismatch"],
]) {
  test(`${label} refuses logical deletion despite 404 and empty list`, async () => {
    const { result } = await logicalRun({ events });
    assert.equal(result.pass, false);
    assert.equal(result.observations[0].status, "unknown");
    assert.equal(result.observations[0].events.reason, reason);
  });
}

for (const pin of [{ teamId: "other-team" }, { executionId: "other-execution" }]) {
  test(`independent identity mismatch ${JSON.stringify(pin)} refuses a well-formed pair`, async () => {
    const { result } = await logicalRun({ resources: [{ ...resource, ...pin }] });
    assert.equal(result.pass, false);
    assert.equal(result.observations[0].events.reason, "identity_mismatch");
  });
}

for (const state of ["running", "paused"]) {
  test(`${state} listed after killed event still fails`, async () => {
    const { result } = await logicalRun({ pages: [() => json([detail("owned-one", state)])] });
    assert.equal(result.pass, false);
    assert.equal(result.observations[0].status, "present");
    assert.equal(result.observations[0].events.terminal.killedEventId, "killed-event");
  });
}

for (const status of [401, 403, 404, 429, 500, 503]) {
  test(`event HTTP ${status} is unknown despite exhausted empty inventory`, async () => {
    const { result } = await logicalRun({ eventPages: [() => json({ code: 404, message: apiKey }, status)] });
    assert.equal(result.pass, false);
    assert.equal(result.observations[0].events.complete, false);
    assert.equal(result.observations[0].events.httpStatus, status);
    assert.equal(JSON.stringify(result).includes(apiKey), false);
  });
}

for (const events of [null, {}, [{}], [{ ...killed, timestamp: "bad" }, created],
  [{ ...killed, sandboxExecutionId: "" }, created], [{ ...killed, version: "v99" }, created]]) {
  test(`malformed event history ${JSON.stringify(events)} cannot pass`, async () => {
    const { result } = await logicalRun({ events });
    assert.equal(result.pass, false);
    assert.equal(result.observations[0].events.reason, "malformed_response");
  });
}

const updates = (count, prefix = "update") => Array.from({ length: count }, (_, i) => ({
  ...created, id: `${prefix}-${i}`, type: "sandbox.lifecycle.updated", timestamp: "2020-01-01T00:00:30Z",
}));
test("event pagination exhausts offsets before the subsequent sandbox list", async () => {
  const { result, paths, offsets } = await logicalRun({ eventPages: [
    () => json([killed, ...updates(99)]), () => json([created]),
  ] });
  assert.equal(result.pass, true);
  assert.deepEqual(offsets, ["0", "100"]);
  assert.equal(result.observations[0].events.pages, 2);
  assert.equal(paths.at(-1), "/v2/sandboxes");
});

test("a complete pair on a full event page cannot hide a failing continuation", async () => {
  const { result } = await logicalRun({ eventPages: [
    () => json([killed, ...updates(98), created]), () => json({}, 503),
  ] });
  assert.equal(result.pass, false);
  assert.equal(result.observations[0].events.complete, false);
});

test("event pages containing no new IDs stop as incomplete", async () => {
  const page = [killed, ...updates(98), created];
  const { result, offsets } = await logicalRun({ eventPages: [() => json(page), () => json(page)] });
  assert.equal(result.pass, false);
  assert.equal(result.observations[0].events.reason, "event_pagination_stalled");
  assert.deepEqual(offsets, ["0", "100"]);
});

test("event pagination has a finite per-resource page cap", async () => {
  const { result, offsets } = await logicalRun({ eventPages: Array.from({ length: 20 }, (_, i) => () => json(updates(100, `page${i}`))) });
  assert.equal(result.pass, false);
  assert.equal(result.observations[0].events.reason, "page_limit");
  assert.equal(offsets.length, 20);
});

test("event pagination rejects inconsistent duplicate IDs", async () => {
  const { result } = await logicalRun({ events: [killed, { ...killed, sandboxExecutionId: "other" }, created] });
  assert.equal(result.pass, false);
  assert.equal(result.observations[0].events.reason, "conflicting_event_id");
});

test("an identical duplicated event is harmless", async () => {
  const { result } = await logicalRun({ events: [killed, killed, created] });
  assert.equal(result.pass, true);
});

test("good terminal evidence cannot hide failed or truncated final inventory", async () => {
  const { result } = await logicalRun({ pages: [() => json([], 200, { "x-next-token": "next" }), () => json({}, 503)] });
  assert.equal(result.pass, false);
  assert.equal(result.observations[0].status, "unknown");
  assert.equal(result.observations[0].events.reason, "terminal_pair_observed");
});

test("a deadline while reading events remains unknown and prevents a list request", async () => {
  const { result, paths } = await logicalRun({ deadlineMs: 25, eventPages: [() => new Promise(() => {})] });
  assert.equal(result.pass, false);
  assert.equal(result.observations[0].events.reason, "deadline_exceeded");
  assert.deepEqual(paths, ["/sandboxes/owned-one", "/events/sandboxes/owned-one"]);
});

test("missing expected lifecycle window keeps identity unavailable, not an inferred success", async () => {
  const { result, paths } = await logicalRun({ resources: [{ sandboxId: "owned-one" }] });
  assert.equal(result.pass, false);
  assert.equal(result.observations[0].events.reason, "identity_unavailable");
  assert.equal(paths.some((path) => path.startsWith("/events/")), false);
});

for (const resources of [[], [{ ...resource, notBefore: "bad", notAfter: "bad" }],
  [{ ...resource, teamId: "" }], [resource, { ...resource, executionId: "conflict" }]]) {
  test(`invalid or conflicting resources refuse before network: ${JSON.stringify(resources)}`, async () => {
    let calls = 0;
    const result = await observe({ apiKey, resources, fetchFn: () => { calls++; } });
    assert.equal(result.pass, false);
    assert.equal(calls, 0);
    assert.ok(result.violations.includes("invalid_observer_input"));
  });
}

test("all expected resources must have terminal evidence", async () => {
  const second = { ...resource, sandboxId: "owned-two" };
  const { result } = await logicalRun({ resources: [resource, second], eventPages: [() => json([killed, created]), () => json([])] });
  assert.equal(result.pass, false);
  assert.deepEqual(result.observations.map((row) => row.status), ["absent", "unknown"]);
});

test("all resources can pass using the same authenticated team context", async () => {
  const second = { ...resource, sandboxId: "owned-two" };
  const secondEvents = [killed, created].map((event) => ({ ...event, sandboxId: "owned-two", sandboxExecutionId: "execution-two", id: `${event.id}-two` }));
  const { result, paths } = await logicalRun({ resources: [resource, second], eventPages: [() => json([killed, created]), () => json(secondEvents)] });
  assert.equal(result.pass, true);
  assert.deepEqual(result.observations.map((row) => row.status), ["absent", "absent"]);
  assert.equal(paths.at(-1), "/v2/sandboxes");
});

test("contradictory team identities under one credential cannot certify multiple resources", async () => {
  const second = { ...resource, sandboxId: "owned-two" };
  const secondEvents = [killed, created].map((event) => ({ ...event, sandboxId: "owned-two", sandboxTeamId: "team-two", id: `${event.id}-two` }));
  const { result } = await logicalRun({ resources: [resource, second], eventPages: [() => json([killed, created]), () => json(secondEvents)] });
  assert.equal(result.pass, false);
  assert.ok(result.violations.includes("provider_identity_mismatch"));
  assert.equal(result.observations.some((row) => row.status === "absent"), false);
});

test("a final response crossing the shared deadline cannot produce success", async () => {
  const { result } = await logicalRun({ deadlineMs: 50, pages: [() => {
    const response = json([]);
    const get = response.headers.get.bind(response.headers);
    response.headers.get = (name) => {
      if (name === "x-next-token") {
        const until = performance.now() + 60;
        while (performance.now() < until) { /* Delay after the body was validated. */ }
      }
      return get(name);
    };
    return response;
  }] });
  assert.equal(result.pass, false);
  assert.equal(result.observations[0].status, "unknown");
});

test("matching optional sandboxIds remain compatible with resource bindings", async () => {
  const base = transport(() => json({}, 404));
  const result = await observe({ apiKey, sandboxIds, resources: [resource], fetchFn: (url, options) =>
    new URL(url).pathname.startsWith("/events/") ? json([killed, created]) : base.fetchFn(url, options) });
  assert.equal(result.pass, true);
});

test("contradictory optional sandboxIds do not silently replace the resource inventory", async () => {
  let calls = 0;
  const result = await observe({ apiKey, sandboxIds: ["different-id"], resources: [resource], fetchFn: () => { calls++; } });
  assert.equal(result.pass, false);
  assert.equal(calls, 0);
});

for (const status of [200, 401, 500]) {
  test(`valid terminal pair cannot hide malformed or failed GET ${status}`, async () => {
    const { result } = await logicalRun({ get: () => json({ code: 404 }, status) });
    assert.equal(result.pass, false);
    assert.equal(result.observations[0].status, "unknown");
    assert.equal(result.observations[0].events.reason, "terminal_pair_observed");
    assert.equal(result.inventory.complete, true);
  });
}

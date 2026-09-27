import { evaluateM1aImageSet } from "./m1a-image-policy.mjs";

const TEST = "TEST/DEV_ONLY";
const EXISTING = new Set(["start", "restart", "exec", "unpause"]);
const VERBS = new Set(["up", "create", "recreate", "run", ...EXISTING]);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const fail = message => { throw new Error(message); };
const refused = reason => ({ classification: TEST, started: false, reasons: [reason] });

function record(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail("expected closed own-data record");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(k => !descriptors[k] || !descriptors[k].enumerable || !("value" in descriptors[k]))) fail("unsupported/missing own-data fields");
  return Object.fromEntries(keys.map(k => [k, descriptors[k].value]));
}
function array(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 128) fail("expected bounded dense array");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) fail("extended array");
  return Array.from({ length: value.length }, (_, i) => {
    if (!descriptors[i]?.enumerable || !("value" in descriptors[i])) fail("array hole/accessor");
    return descriptors[i].value;
  });
}
// Copy ordinary data without invoking getters. The opaque capability is handled separately.
function copy(value, depth = 0) {
  if (depth > 16) fail("data nesting bound");
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return array(value).map(v => copy(v, depth + 1));
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail("unsupported data");
  const keys = Reflect.ownKeys(value);
  if (keys.length > 128 || keys.some(k => typeof k !== "string")) fail("data key bound/symbol");
  return Object.fromEntries(Object.entries(record(value, keys)).map(([k, v]) => [k, copy(v, depth + 1)]));
}
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function operation(value) {
  const o = record(value, ["classification", "verb", "services", "noDeps", "build", "pull", "tagFallback", "lane"]);
  if (o.classification !== TEST) fail("production start refuses: P2/P3 unresolved");
  if (!VERBS.has(o.verb) || !["keyed", "keyless"].includes(o.lane) || typeof o.noDeps !== "boolean") fail("unsupported operation");
  if (o.build !== false || o.pull !== "never" || o.tagFallback !== false) fail("implicit build/pull/tag fallback forbidden");
  o.services = array(o.services);
  if (!o.services.length || o.services.some(s => typeof s !== "string" || !LABEL.test(s)) || new Set(o.services).size !== o.services.length) fail("explicit unique service targets required");
  if ((o.verb === "run" || o.verb === "exec") && o.services.length !== 1) fail("run/exec requires one target");
  o.services.sort();
  return o;
}
function request(value) {
  const q = record(value, ["mode", "authenticatedPolicy", "event", "renderedServices", "builtInventory", "providerInventory", "now", "revocationEvidence"]);
  return { ...copy(Object.fromEntries(Object.entries(q).filter(([k]) => k !== "authenticatedPolicy"))), authenticatedPolicy: q.authenticatedPolicy };
}
function closure(rendered, o) {
  const services = new Map(rendered.map(s => [s.service, s]));
  const selected = new Set();
  function visit(name) {
    if (!services.has(name)) fail("operation service outside admitted runtime scope");
    if (selected.has(name)) return;
    selected.add(name);
    if (!o.noDeps) services.get(name).dependencies.forEach(visit);
  }
  o.services.forEach(visit);
  if (o.lane === "keyless" && selected.has("adapter-manager")) fail("keyless never executes adapter-manager, including dependencies/probes");
  return [...selected].sort();
}
function observations(value, approved, selected, o) {
  const rows = array(value).map(v => record(v, ["service", "image", "identityKind", "contentId", "ociDigest", "containers"]));
  if (rows.length !== approved.length || new Set(rows.map(r => r.service)).size !== rows.length) fail("complete unique image binding set required");
  const containerIds = new Set();
  for (const row of rows) {
    const a = approved.find(b => b.service === row.service);
    if (!a || ["image", "identityKind", "contentId", "ociDigest"].some(k => row[k] !== a[k])) fail("observed image binding differs from authenticated policy");
    row.containers = array(row.containers).map(c => record(c, ["containerId", "replica", "immutableImageId"]));
    const replicas = new Set();
    for (const c of row.containers) {
      if (typeof c.containerId !== "string" || c.containerId.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(c.containerId)
        || containerIds.has(c.containerId) || !Number.isInteger(c.replica) || c.replica < 1 || c.replica > a.replicas || replicas.has(c.replica)
        || typeof c.immutableImageId !== "string" || !DIGEST.test(c.immutableImageId)) fail("invalid/duplicate container replica binding");
      containerIds.add(c.containerId); replicas.add(c.replica);
      // Task 2 has no authenticated OCI-manifest-to-config relationship. Never equate them.
      if (a.identityKind !== "docker-config-id" || c.immutableImageId !== a.contentId) fail("container immutable image/config binding unavailable or substituted");
    }
    if (selected.includes(row.service) && EXISTING.has(o.verb) && row.containers.length !== a.replicas) fail("existing container replica binding incomplete");
    if (row.containers.length !== 0 && row.containers.length !== a.replicas) fail("partial container replica inventory");
    row.containers.sort((a, b) => a.replica - b.replica);
  }
  return rows.sort((a, b) => a.service < b.service ? -1 : a.service > b.service ? 1 : 0);
}

/** Offline TEST seam only. No Docker inspection or production authority is implemented. */
export async function guardCampaignStart(input, start) {
  let plan;
  try {
    const q = record(input, ["admission", "renderedServices", "observedImageBindings", "operation"]);
    const mode = q.admission && Object.getOwnPropertyDescriptor(q.admission, "mode");
    if (!mode || !("value" in mode) || mode.value !== TEST) return refused("production admission refuses: P2/P3 unresolved; original TEST request required");
    if (typeof start !== "function") fail("injected start required");
    const admission = request(q.admission);
    const rendered = copy(q.renderedServices);
    const o = operation(q.operation);
    const observed = record(q.observedImageBindings, ["classification", "snapshot", "recheck"]);
    if (observed.classification !== TEST || typeof observed.recheck !== "function") fail("explicit TEST observations and immediate recheck required");
    const verdict = evaluateM1aImageSet(admission);
    if (!verdict.admitted) return refused(verdict.reasons.join("; "));
    if (JSON.stringify(rendered) !== JSON.stringify(admission.renderedServices)) fail("rendered service/replica/dependency set changed");
    const selected = closure(rendered, o);
    const approved = verdict.bindings.filter(b => b.scope === "runtime");
    const snapshot = observations(observed.snapshot, approved, selected, o);
    const before = JSON.stringify({ admission: { ...admission, authenticatedPolicy: null }, rendered, o });
    const fresh = observations(await observed.recheck(freeze(copy({ classification: TEST, operation: o, services: selected }))), approved, selected, o);
    const current = request(q.admission);
    const currentObserved = record(q.observedImageBindings, ["classification", "snapshot", "recheck"]);
    if (currentObserved.classification !== TEST || current.authenticatedPolicy !== admission.authenticatedPolicy || observed.recheck !== currentObserved.recheck
      || before !== JSON.stringify({ admission: { ...current, authenticatedPolicy: null }, rendered: copy(q.renderedServices), o: operation(q.operation) })) fail("request mutated during binding recheck");
    const finalVerdict = evaluateM1aImageSet(current);
    if (!finalVerdict.admitted) return refused(finalVerdict.reasons.join("; "));
    if (JSON.stringify(snapshot) !== JSON.stringify(fresh)) fail("image/container binding changed since snapshot");
    plan = freeze({ classification: TEST, operation: o, services: selected,
      bindings: approved.filter(b => selected.includes(b.service)).map(b => ({ ...copy(b), containers: fresh.find(r => r.service === b.service).containers })) });
  } catch (error) {
    return refused(error instanceof Error ? error.message : "malformed TEST start request");
  }
  // No asynchronous work between final comparison and invocation. Callback failures
  // propagate: an invoked operation must never be reported as a pre-start refusal.
  await start(plan);
  return { classification: TEST, started: true, reasons: [] };
}

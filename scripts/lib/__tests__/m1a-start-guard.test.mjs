import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { authenticateController, controllerTestSigningPayload } from "../m1a-controller.mjs";
import { canonicalSigningPayload } from "../image-admission.mjs";
import { canonicalTestImagePolicyBytes, canonicalTestRevocationBytes, externalTestSigningPayload } from "../m1a-image-policy.mjs";
import { parseYaml } from "../yaml-lite.mjs";

// A missing implementation is an assertion failure in RED, not an import error.
const module = await import("../m1a-start-guard.mjs").catch(e => {
  if (e.code !== "ERR_MODULE_NOT_FOUND") throw e;
  return {};
});
const guard = (...args) => {
  assert.equal(typeof module.guardCampaignStart, "function", "guardCampaignStart must exist");
  return module.guardCampaignStart(...args);
};
const classification = "TEST/DEV_ONLY";
const candidate = "a".repeat(40);
const digest = n => `sha256:${n.toString(16).padStart(64, "0")}`;
const hash = b => createHash("sha256").update(b).digest("hex");
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const authority = generateKeyPairSync("ed25519");
const event = { repository: "test/aoa", headRepository: "test/aoa", eventName: "workflow_dispatch", candidate, runId: "123", runAttempt: 1 };

// Source-recorded identity/dependency projection, NOT a Docker-rendered config.
// staging + m1 overlay retain the staging migrate dependency and legacy workers.
const shipped = [
  ["postgres", []], ["minio", []], ["migrate", ["postgres"]],
  ["control-plane", ["migrate", "postgres", "minio"]],
  ["control-plane-b", ["migrate", "postgres", "minio"]],
  ["adapter-manager", []],
  ["m1-worker-a", ["control-plane", "adapter-manager"]],
  ["m1-worker-b", ["control-plane-b", "adapter-manager"]],
  ["m1-worker-c", ["control-plane", "adapter-manager"]],
  ...["worker-a1", "worker-a2", "worker-b1", "worker-b2"].map(s => [s, ["migrate"]]),
];
const d1 = [
  ["postgres", []], ["minio", []], ["toxiproxy", []], ["migrate", ["postgres"]],
  ["control-plane", ["postgres", "migrate", "minio", "toxiproxy"]],
  ["control-plane-b", ["postgres", "migrate", "minio", "toxiproxy"]],
  ["worker-a", ["control-plane", "fake-provider", "toxiproxy"]],
  ["worker-b", ["control-plane", "fake-provider", "toxiproxy"]],
  ["fake-provider", []],
  ["test-runner", ["control-plane", "control-plane-b", "worker-a", "worker-b", "fake-provider"]],
];
// Static source projection only. Accept the recorded block dependency grammar,
// including the spine's single !override; do not emulate a Compose renderer.
function recordedDependencyGraph(profile) {
  const graph = new Map();
  for (const file of ["docker-compose.d1.yml", ...(profile === "spine" ? ["docker/d1/m1-spine.override.yml"] : [])]) {
    const text = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
    const section = text.match(/^services:\s*\r?\n([\s\S]*?)(?=^\S|$(?![\s\S]))/m);
    assert.ok(section, `${file}: services section required`);
    const blocks = [...section[1].matchAll(/^  ([A-Za-z0-9_-]+):[^\r\n]*\r?\n([\s\S]*?)(?=^  [A-Za-z0-9_-]+:|$(?![\s\S]))/gm)];
    assert.ok(blocks.length, `${file}: block service grammar required`);
    for (const [, service, body] of blocks) {
      const headers = [...body.matchAll(/^    depends_on:([^\r\n]*)\r?\n/gm)];
      assert.ok(headers.length <= 1, `${file}/${service}: duplicate depends_on`);
      if (!headers.length) { if (!graph.has(service)) graph.set(service, []); continue; }
      const header = headers[0];
      const suffix = header[1].trim();
      assert.equal(suffix, file.endsWith("override.yml") && service === "test-runner" ? "!override" : "");
      const tail = body.slice(header.index + header[0].length);
      const dependencyLines = [];
      for (const line of tail.split(/\r?\n/)) {
        if (/^\s*(?:#.*)?$/.test(line)) continue;
        if (!/^ {6}/.test(line)) break;
        assert.match(line, /^(?: {6}[A-Za-z0-9_-]+:| {8}condition: (?:service_healthy|service_completed_successfully))\s*$/,
          `${file}/${service}: unsupported dependency grammar`);
        dependencyLines.push(line.slice(6));
      }
      const parsed = parseYaml(dependencyLines.join("\n"));
      assert.ok(parsed && Object.keys(parsed).length, `${file}/${service}: dependencies required`);
      for (const condition of Object.values(parsed)) assert.deepEqual(Object.keys(condition), ["condition"]);
      const dependencies = Object.keys(parsed).sort();
      graph.set(service, suffix === "!override" ? dependencies : [...new Set([...(graph.get(service) ?? []), ...dependencies])].sort());
    }
  }
  for (const dependencies of graph.values()) for (const dependency of dependencies) assert.ok(graph.has(dependency), `unresolved source dependency ${dependency}`);
  return graph;
}
function sourceClosure(graph, target) {
  const selected = new Set([target]);
  for (const service of selected) for (const dependency of graph.get(service)) selected.add(dependency);
  return [...selected].sort();
}
function fixture(verb = "up", services = ["control-plane"], noDeps = false, profile = "shipped") {
  const projection = structuredClone(profile === "shipped" ? shipped : d1);
  if (profile === "spine") projection.find(([s]) => s === "test-runner")[1] = ["control-plane", "worker-b", "fake-provider"];
  const external = s => ["postgres", "toxiproxy", "test-runner"].includes(s) || (profile !== "shipped" && s === "minio");
  const renderedServices = projection.map(([service, dependencies], i) => ({
    service, image: external(service) ? `test-${service}@${digest(i + 1)}` : `aoa-${service === "migrate" || service.startsWith("control-plane") ? "control-plane" : service.includes("worker") ? "worker" : service}:candidate`, dependencies: [...dependencies],
    replicas: service.match(/^worker-[ab][12]$/) ? 2 : 1,
  })).sort((a, b) => a.service.localeCompare(b.service));
  const revocationEvidence = { classification, policyId: "start-test", sequence: 1, checkedAt: 100, expiresAt: 1000, revokedContentIds: [], revokedRootFingerprints: [] };
  const entries = renderedServices.map((s, i) => {
    const isExternal = external(s.service);
    const contentId = isExternal ? s.image.split("@")[1] : digest(s.image.includes("control-plane") ? 30 : s.image.includes("worker") ? 31 : s.service === "minio" ? 32 : 33);
    const entry = { ...structuredClone(s), scope: "runtime", kind: isExternal ? "external" : "project", identityKind: isExternal ? "oci-manifest-digest" : "docker-config-id", contentId, ociDigest: isExternal ? contentId : null, sourceRevision: isExternal ? null : candidate, buildId: isExternal ? null : "test-build", sbomSha256: "e".repeat(64), scanSha256: "f".repeat(64), scanPassed: true, scanCheckedAt: 100, signature: "", verification: isExternal ? "TEST-external-pem-v1" : "project-pem-v1", trustRootPem: ec.publicKey.export({ type: "spki", format: "pem" }).toString(), trustRootFingerprint: hash(ec.publicKey.export({ type: "spki", format: "der" })) };
    entry.signature = sign("sha256", Buffer.from(isExternal ? externalTestSigningPayload(entry) : canonicalSigningPayload({ digest: entry.contentId, sourceRevision: candidate })), ec.privateKey).toString("base64");
    return entry;
  });
  const policy = { schema: 1, classification, policyId: "start-test", candidate, notBefore: 100, expiresAt: 1000, maxScanAgeMs: 200, maxRevocationAgeMs: 200, revocationSequence: 1, revocationSha256: hash(canonicalTestRevocationBytes(revocationEvidence)), entries };
  const bytes = canonicalTestImagePolicyBytes(policy);
  const protectedBinding = { schema: 1, classification, controllerSha: "1".repeat(40), policyAuthorityPublicKeyPem: authority.publicKey.export({ type: "spki", format: "pem" }).toString(), policyAuthorityFingerprint: hash(authority.publicKey.export({ type: "spki", format: "der" })), ...event, notBefore: 100, expiresAt: 1000, policySha256: hash(bytes) };
  const receipt = authenticateController({ protectedBinding, observedController: { sha: protectedBinding.controllerSha }, event: { ...event }, policyBytes: bytes, policySignature: sign(null, controllerTestSigningPayload({ protectedBinding, policyBytes: bytes }), authority.privateKey).toString("base64"), now: 100 });
  assert.equal(receipt.accepted, true);
  const admission = { mode: classification, authenticatedPolicy: receipt.testPolicyCapability, event: { ...event }, renderedServices: structuredClone(renderedServices), builtInventory: entries.map(({ verification, trustRootPem, trustRootFingerprint, ...e }) => structuredClone(e)), providerInventory: [], now: 150, revocationEvidence };
  const snapshot = entries.map(e => ({ service: e.service, image: e.image, identityKind: e.identityKind, contentId: e.contentId, ociDigest: e.ociDigest, containers: e.kind === "external" ? [] : Array.from({ length: e.replicas }, (_, i) => ({ containerId: `${e.service}-${i + 1}`, replica: i + 1, immutableImageId: e.contentId })) }));
  const q = { admission, renderedServices, observedImageBindings: { classification, snapshot, recheck: async () => structuredClone(snapshot) }, operation: { classification, verb, services, noDeps, build: false, pull: "never", tagFallback: false, lane: "keyed" } };
  return q;
}
async function refusal(q, pattern) {
  let calls = 0;
  const r = await guard(q, () => { calls++; });
  assert.equal(calls, 0);
  assert.equal(r.started, false);
  assert.equal(r.classification, classification);
  if (pattern) assert.match(r.reasons.join(" "), pattern);
}
test("refusal_precedes_first_start", async () => {
  const q = fixture(); q.admission = { admitted: true };
  await refusal(q, /P2|capability|admission/);
});
test("reevaluate_original_capability_event_and_clock", async () => {
  for (const mutate of [q => { q.admission.authenticatedPolicy = { accepted: true }; }, q => { q.admission.now = 1000; }, q => { q.admission.event.candidate = "b".repeat(40); }, q => { q.admission.authenticatedPolicy = structuredClone(q.admission.authenticatedPolicy); }]) {
    const q = fixture(); mutate(q); await refusal(q);
  }
});
test("production_refuses_explicit_TEST_classification", async () => {
  const q = fixture(); q.admission.mode = "production"; await refusal(q, /P2/);
});
test("refuse_tag_rebinding", async () => {
  const q = fixture(); q.observedImageBindings.recheck = async () => {
    const next = structuredClone(q.observedImageBindings.snapshot); next[0].contentId = digest(90); return next;
  }; await refusal(q, /binding/);
});
test("refuse_implicit_build_pull_or_tag_fallback", async () => {
  for (const [key, value] of [["build", true], ["pull", "missing"], ["pull", "always"], ["tagFallback", true]]) {
    const q = fixture(); q.operation[key] = value; await refusal(q);
  }
  const q = fixture(); delete q.operation.pull; await refusal(q);
});
test("guard_one_shot_probe_and_recreate", async () => {
  for (const verb of ["run", "recreate", "create", "up"]) {
    const q = fixture(verb, ["adapter-manager"], true); let calls = 0;
    const r = await guard(q, plan => {
      calls++; assert.equal(plan.classification, classification);
      assert.deepEqual(plan.services, ["adapter-manager"]);
      assert.equal(plan.bindings[0].contentId, q.admission.builtInventory.find(e => e.service === "adapter-manager").contentId);
      assert.equal(Object.isFrozen(plan), true);
    }); assert.equal(r.started, true, r.reasons.join(" ")); assert.equal(calls, 1);
  }
});
test("guard_existing_container_start_and_restart", async () => {
  for (const verb of ["start", "restart", "exec", "unpause"]) {
    const q = fixture(verb, ["control-plane"], true); let calls = 0;
    const r = await guard(q, plan => { calls++; assert.equal(plan.bindings[0].containers.length, 1); });
    assert.equal(r.started, true, r.reasons.join(" ")); assert.equal(calls, 1);
  }
});
test("reject_existing_container_image_substitution", async () => {
  for (const verb of ["start", "restart", "exec", "unpause"]) {
    const q = fixture(verb, ["control-plane"], true);
    q.observedImageBindings.snapshot.find(e => e.service === "control-plane").containers[0].immutableImageId = digest(99);
    await refusal(q, /container/);
  }
});
test("exact_container_ids_and_replicas_rechecked", async () => {
  for (const mutate of [e => { e.containers[0].containerId += "replacement"; }, e => { e.containers.pop(); }, e => { e.containers[0].replica = 2; }, e => { e.containers.push(e.containers[0]); }]) {
    const q = fixture("restart", ["control-plane"], true);
    q.observedImageBindings.recheck = async () => { const next = structuredClone(q.observedImageBindings.snapshot); mutate(next.find(e => e.service === "control-plane")); return next; };
    await refusal(q);
  }
});
test("dependency_closure_and_no_deps_are_exact", async () => {
  const q = fixture(); const r = await guard(q, plan => assert.deepEqual(plan.services, ["control-plane", "migrate", "minio", "postgres"]));
  assert.equal(r.started, true, r.reasons.join(" "));
  const solo = fixture("up", ["control-plane-b"], true);
  assert.equal((await guard(solo, p => assert.deepEqual(p.services, ["control-plane-b"]))).started, true);
  const missing = fixture(); missing.observedImageBindings.snapshot.pop(); await refusal(missing);
});
test("keyless_never_starts_adapter_manager", async () => {
  for (const verb of ["up", "run", "create", "recreate", "start", "restart", "exec", "unpause"]) {
    const q = fixture(verb, ["adapter-manager"], true); q.operation.lane = "keyless"; await refusal(q, /keyless/);
  }
  const q = fixture("up", ["m1-worker-a", "m1-worker-b", "m1-worker-c"], true); q.operation.lane = "keyless";
  assert.equal((await guard(q, p => assert.equal(p.services.includes("adapter-manager"), false))).started, true);
});
test("minio_built_from_candidate_truthful", async () => {
  const q = fixture("up", ["minio"], true);
  assert.equal((await guard(q, p => { assert.equal(p.bindings[0].sourceRevision, candidate); assert.equal(p.bindings[0].identityKind, "docker-config-id"); assert.equal(p.bindings[0].ociDigest, null); })).started, true);
  q.admission.builtInventory.find(e => e.service === "minio").sourceRevision = "b".repeat(40); await refusal(q);
  const dockerfile = readFileSync(new URL("../../../docker/d1/minio.Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /MINIO_SOURCE_COMMIT=07c3a429bfed433e49018cb0f78a52145d4bedeb/);
});
test("config_id_is_never_OCI_digest", async () => {
  const q = fixture(); q.observedImageBindings.snapshot[0].identityKind = "oci-manifest-digest";
  q.observedImageBindings.snapshot[0].ociDigest = q.observedImageBindings.snapshot[0].contentId; await refusal(q);
});
test("closed_commands_and_complete_observations", async () => {
  for (const mutate of [q => { q.operation.verb = "build"; }, q => { q.operation.argv = ["--build"]; }, q => { q.operation.services = []; }, q => { q.operation.services = ["unknown"]; }, q => { q.operation.services.push(q.operation.services[0]); }, q => { q.renderedServices[0].replicas++; }, q => { q.observedImageBindings.recheck = null; }, q => { q.observedImageBindings.snapshot.push(q.observedImageBindings.snapshot[0]); }]) {
    const q = fixture(); mutate(q); await refusal(q);
  }
});
test("observation_failure_and_mutation_refuse_without_start", async () => {
  const q = fixture(); q.observedImageBindings.recheck = async () => { throw new Error("TEST inspection failure"); }; await refusal(q);
  const changed = fixture(); changed.observedImageBindings.recheck = async () => { changed.operation.services.push("adapter-manager"); return structuredClone(changed.observedImageBindings.snapshot); }; await refusal(changed);
});
test("accessors_are_not_invoked", async () => {
  const q = fixture(); let calls = 0;
  Object.defineProperty(q.operation, "pull", { enumerable: true, get() { calls++; return "never"; } });
  await refusal(q); assert.equal(calls, 0);
});
test("start_error_propagates_once_without_retry", async () => {
  let calls = 0;
  await assert.rejects(guard(fixture(), () => { calls++; throw new Error("injected start failure"); }), /injected start failure/);
  assert.equal(calls, 1);
});
test("keyless_dependency_start_refuses_real_AM_edge", async () => {
  const q = fixture("up", ["m1-worker-c"]); q.operation.lane = "keyless";
  await refusal(q, /keyless/);
});
test("recorded_D1_and_spine_config_dependency_closures", async () => {
  for (const profile of ["d1", "spine"]) {
    const q = fixture("up", ["test-runner"], false, profile);
    const r = await guard(q, p => {
      assert.equal(p.services.includes("adapter-manager"), false);
      assert.equal(p.services.includes("postgres"), true);
      assert.equal(p.services.includes("toxiproxy"), true);
      assert.equal(p.services.includes("worker-a"), profile === "d1");
      assert.equal(p.services.includes("control-plane-b"), profile === "d1");
    }); assert.equal(r.started, true, r.reasons.join(" "));
  }
});
test("recheck_cannot_promote_observations_to_production", async () => {
  const q = fixture(); q.observedImageBindings.recheck = async () => {
    q.observedImageBindings.classification = "production";
    return structuredClone(q.observedImageBindings.snapshot);
  }; await refusal(q);
});
test("existing_two_replica_service_requires_every_immutable_container", async () => {
  const q = fixture("restart", ["worker-a1"], true);
  assert.equal((await guard(q, p => assert.deepEqual(p.bindings[0].containers.map(c => c.replica), [1, 2]))).started, true);
  q.observedImageBindings.snapshot.find(e => e.service === "worker-a1").containers.pop(); await refusal(q);
});
test("existing_OCI_container_refuses_without_authenticated_config_mapping", async () => {
  const q = fixture("start", ["postgres"], true);
  await refusal(q, /container/);
  const postgres = q.observedImageBindings.snapshot.find(e => e.service === "postgres");
  postgres.containers = [{ containerId: "postgres-1", replica: 1, immutableImageId: postgres.contentId }];
  await refusal(q, /config/);
});
test("initial_binding_must_match_approval_and_dependency_container_is_checked", async () => {
  const q = fixture(); q.observedImageBindings.snapshot.find(e => e.service === "minio").contentId = digest(99); await refusal(q);
  const dependency = fixture("start");
  dependency.observedImageBindings.snapshot.find(e => e.service === "migrate").containers[0].immutableImageId = digest(99);
  await refusal(dependency, /container/);
});
test("recorded_worker_edges_and_exact_closure_match_D1_spine_source", async () => {
  for (const profile of ["d1", "spine"]) {
    const graph = recordedDependencyGraph(profile);
    for (const worker of profile === "spine" ? ["worker-b"] : ["worker-a", "worker-b"]) {
      const q = fixture("up", [worker], false, profile);
      // Direct-edge equality catches minio-for-toxiproxy even though the CP
      // transitive closure contains both services and hides that mutation.
      for (const row of q.renderedServices) assert.deepEqual([...row.dependencies].sort(), graph.get(row.service), `${profile}/${row.service}: fixture edges differ from source`);
      let calls = 0;
      const result = await guard(q, plan => { calls++; assert.deepEqual(plan.services, sourceClosure(graph, worker)); });
      assert.equal(result.started, true, result.reasons.join(" "));
      assert.equal(calls, 1);
      assert.deepEqual(sourceClosure(graph, worker), ["control-plane", "fake-provider", "migrate", "minio", "postgres", "toxiproxy", worker]);
    }
  }
});
test("actual_worker_toxiproxy_dependency_binding_missing_or_substituted_refuses", async () => {
  for (const profile of ["d1", "spine"]) for (const worker of profile === "spine" ? ["worker-b"] : ["worker-a", "worker-b"]) {
    assert.equal(recordedDependencyGraph(profile).get(worker).includes("toxiproxy"), true);
    const missing = fixture("up", [worker], false, profile);
    missing.observedImageBindings.snapshot = missing.observedImageBindings.snapshot.filter(e => e.service !== "toxiproxy");
    await refusal(missing, /binding/);
    const substituted = fixture("up", [worker], false, profile);
    substituted.observedImageBindings.recheck = async () => {
      const next = structuredClone(substituted.observedImageBindings.snapshot);
      next.find(e => e.service === "toxiproxy").contentId = digest(99);
      return next;
    };
    await refusal(substituted, /binding/);
  }
});

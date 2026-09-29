import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { authenticateController, controllerTestSigningPayload, readAuthenticatedTestPolicy } from "../m1a-controller.mjs";
import { canonicalSigningPayload } from "../image-admission.mjs";
import { collectRenderedImageSet, canonicalTestImagePolicyBytes, evaluateM1aImageSet, externalTestSigningPayload, canonicalTestRevocationBytes } from "../m1a-image-policy.mjs";

const classification = "TEST/DEV_ONLY";
const candidate = "a".repeat(40);
const digest = (char) => `sha256:${char.repeat(64)}`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const event = { repository: "test/aoa", headRepository: "test/aoa", eventName: "workflow_dispatch", candidate, runId: "123", runAttempt: 1 };
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const authority = generateKeyPairSync("ed25519");
const root = ec.publicKey.export({ type: "spki", format: "pem" }).toString();
const fingerprint = hash(ec.publicKey.export({ type: "spki", format: "der" }));
function fixture() {
  const renderedServices = collectRenderedImageSet({ services: {
    app: { image: "aoa:local", depends_on: ["db", "fake"], deploy: { replicas: 2 } },
    db: { image: `db@${digest("b")}`, depends_on: [], deploy: { replicas: 1 } },
    fake: { image: `fake@${digest("c")}`, depends_on: [], deploy: { replicas: 1 } },
  } });
  const revocationEvidence = { classification, policyId: "test-policy", sequence: 1, checkedAt: 100, expiresAt: 1000, revokedContentIds: [], revokedRootFingerprints: [] };
  const entries = [...structuredClone(renderedServices), { service: "managed", image: `provider@${digest("d")}`, replicas: 1, dependencies: [] }].map((s, i) => {
    const project = i === 0;
    const entry = { ...s, scope: i === 3 ? "provider" : "runtime", kind: project ? "project" : "external", identityKind: project ? "docker-config-id" : "oci-manifest-digest", contentId: digest("abcd"[i]), ociDigest: project ? null : digest("abcd"[i]), sourceRevision: project ? candidate : null, buildId: project ? "isolated-build-1" : null, sbomSha256: "e".repeat(64), scanSha256: "f".repeat(64), scanPassed: true, scanCheckedAt: 100, signature: "", verification: project ? "project-pem-v1" : "TEST-external-pem-v1", trustRootPem: root, trustRootFingerprint: fingerprint };
    entry.signature = sign("sha256", Buffer.from(project ? canonicalSigningPayload({ digest: entry.contentId, sourceRevision: entry.sourceRevision }) : externalTestSigningPayload(entry)), ec.privateKey).toString("base64");
    return entry;
  });
  const policy = { schema: 1, classification, policyId: "test-policy", candidate, notBefore: 100, expiresAt: 1000, maxScanAgeMs: 200, maxRevocationAgeMs: 200, revocationSequence: 1, revocationSha256: hash(canonicalTestRevocationBytes(revocationEvidence)), entries };
  const inventory = structuredClone(entries.map(({ trustRootPem, trustRootFingerprint, verification, ...entry }) => entry));
  const input = { mode: classification, authenticatedPolicy: null, event: { ...event }, renderedServices, builtInventory: inventory.filter(e => e.scope === "runtime"), providerInventory: inventory.filter(e => e.scope === "provider"), now: 150, revocationEvidence };
  return { policy, input };
}
function authenticate(f, bytes = canonicalTestImagePolicyBytes(f.policy)) {
  const protectedBinding = { schema: 1, classification, controllerSha: "1".repeat(40), policyAuthorityPublicKeyPem: authority.publicKey.export({ type: "spki", format: "pem" }).toString(), policyAuthorityFingerprint: hash(authority.publicKey.export({ type: "spki", format: "der" })), ...event, notBefore: 100, expiresAt: 1000, policySha256: hash(bytes) };
  const policySignature = sign(null, controllerTestSigningPayload({ protectedBinding, policyBytes: bytes }), authority.privateKey).toString("base64");
  const result = authenticateController({ protectedBinding, observedController: { sha: protectedBinding.controllerSha }, event: { ...event }, policyBytes: bytes, policySignature, now: 100 });
  assert.equal(result.accepted, true);
  f.input.authenticatedPolicy = result.testPolicyCapability;
  return f;
}
function admit(f) { return evaluateM1aImageSet(authenticate(f).input); }
function evaluateLive(f) {
  authenticate(f);
  assert.ok(readAuthenticatedTestPolicy(f.input.authenticatedPolicy, { event: f.input.event, now: f.input.now }));
  assert.ok(f.policy.notBefore <= f.input.now && f.input.now < f.policy.expiresAt);
  return evaluateM1aImageSet(f.input);
}
function projectOciFixture() {
  const f = fixture();
  const entry = f.policy.entries.find(e => e.service === "app");
  const observed = f.input.builtInventory.find(e => e.service === "app");
  const rendered = f.input.renderedServices.find(e => e.service === "app");
  const image = `aoa@${entry.contentId}`;
  Object.assign(entry, { identityKind: "oci-manifest-digest", ociDigest: entry.contentId, image });
  Object.assign(observed, { identityKind: entry.identityKind, ociDigest: entry.ociDigest, image });
  rendered.image = image;
  return f;
}
function rejectMutation(mutate, pattern) {
  const f = fixture();
  mutate(f);
  let policyBytes;
  try { policyBytes = canonicalTestImagePolicyBytes(f.policy); }
  catch { policyBytes = Buffer.from(JSON.stringify(f.policy)); }
  const result = evaluateM1aImageSet(authenticate(f, policyBytes).input);
  assert.equal(result.admitted, false, JSON.stringify(result));
  assert.deepEqual(result.bindings, []);
  if (pattern) assert.match(result.reasons.join(" "), pattern);
}
test("admits complete TEST services, replicas, infrastructure, fake and managed provider", () => {
  const f = fixture();
  const result = admit(f);
  assert.equal(result.admitted, true, result.reasons.join(" "));
  assert.equal(result.classification, classification);
  assert.equal(result.bindings.length, 4);
  assert.equal(result.bindings.find(b => b.service === "app").identityKind, "docker-config-id");
  assert.equal(result.bindings.find(b => b.service === "app").ociDigest, null);
});
test("reject_missing_extra_service", () => {
  rejectMutation(f => f.input.renderedServices.pop());
  rejectMutation(f => f.input.builtInventory.pop());
  rejectMutation(f => f.input.providerInventory.pop());
  rejectMutation(f => f.input.builtInventory.push({ ...f.input.builtInventory[0], service: "extra" }));
  rejectMutation(f => f.input.builtInventory.push({ ...f.input.builtInventory[0] }));
  rejectMutation(f => f.input.renderedServices[0].replicas++);
  rejectMutation(f => f.input.renderedServices[0].dependencies.pop());
});
test("reject_mutable_tag_only_identity", () => {
  rejectMutation(f => { f.input.builtInventory[0].contentId = "aoa:latest"; });
  rejectMutation(f => { f.input.builtInventory[1].image = "db:latest"; });
  rejectMutation(f => { f.input.builtInventory[0].ociDigest = f.input.builtInventory[0].contentId; });
});
test("reject_changed_digest_source_signature", () => {
  for (const [field, value] of [["contentId", digest("9")], ["sourceRevision", "b".repeat(40)], ["signature", "Zm9yZ2Vk"], ["buildId", "new-build"]]) rejectMutation(f => { f.input.builtInventory[0][field] = value; });
  rejectMutation(f => { f.policy.entries[0].signature = f.input.builtInventory[0].signature = "Zm9yZ2Vk"; }, /signature/);
});
test("reject_missing_sbom_scan", () => {
  for (const field of ["sbomSha256", "scanSha256"]) rejectMutation(f => { f.input.builtInventory[0][field] = null; });
  rejectMutation(f => { f.input.builtInventory[0].scanPassed = false; });
  rejectMutation(f => { f.policy.maxScanAgeMs = 10; }, /scan/);
});
test("reject_expired_revoked_stale_revocation", () => {
  rejectMutation(f => { f.input.now = 1000; });
  rejectMutation(f => { f.policy.expiresAt = 150; }, /expired/);
  rejectMutation(f => { f.input.revocationEvidence.checkedAt = 0; });
  for (const field of ["revokedContentIds", "revokedRootFingerprints"]) rejectMutation(f => {
    f.input.revocationEvidence[field] = [field === "revokedContentIds" ? digest("a") : fingerprint];
    f.policy.revocationSha256 = hash(canonicalTestRevocationBytes(f.input.revocationEvidence));
  }, /revoked/);
  rejectMutation(f => { f.policy.maxRevocationAgeMs = 10; }, /revocation/);
});
test("live signed scan future and maximum-age boundaries", () => {
  for (const [checkedAt, admitted] of [[151, false], [150, true], [100, true], [99, false]]) {
    const f = fixture();
    f.policy.maxScanAgeMs = 50;
    f.policy.entries.find(e => e.service === "app").scanCheckedAt = checkedAt;
    f.input.builtInventory.find(e => e.service === "app").scanCheckedAt = checkedAt;
    const result = evaluateLive(f);
    assert.equal(result.admitted, admitted, JSON.stringify({ checkedAt, result }));
    assert.deepEqual(result.reasons, admitted ? [] : ["stale scan evidence"]);
    if (!admitted) assert.deepEqual(result.bindings, []);
  }
});

test("live signed revocation future expiry and maximum-age boundaries", () => {
  for (const [checkedAt, expiresAt, admitted] of [[151, 1000, false], [150, 1000, true], [100, 1000, true], [99, 1000, false], [100, 150, false], [100, 149, false], [100, 151, true]]) {
    const f = fixture();
    f.policy.maxRevocationAgeMs = 50;
    Object.assign(f.input.revocationEvidence, { checkedAt, expiresAt });
    f.policy.revocationSha256 = hash(canonicalTestRevocationBytes(f.input.revocationEvidence));
    const result = evaluateLive(f);
    assert.equal(result.admitted, admitted, JSON.stringify({ checkedAt, expiresAt, result }));
    assert.deepEqual(result.reasons, admitted ? [] : ["missing/mismatched/stale revocation evidence"]);
    if (!admitted) assert.deepEqual(result.bindings, []);
  }
});

test("project OCI admits and consistent digest substitution reaches signature verification", () => {
  const f = projectOciFixture();
  const positive = evaluateLive(f);
  assert.equal(positive.admitted, true, positive.reasons.join(" "));
  const binding = positive.bindings.find(e => e.service === "app");
  assert.equal(binding.kind, "project");
  assert.equal(binding.identityKind, "oci-manifest-digest");
  assert.equal(binding.ociDigest, digest("a"));
  const entry = f.policy.entries.find(e => e.service === "app");
  const observed = f.input.builtInventory.find(e => e.service === "app");
  const image = `aoa@${digest("9")}`;
  for (const record of [entry, observed]) Object.assign(record, { contentId: digest("9"), ociDigest: digest("9"), image });
  f.input.renderedServices.find(e => e.service === "app").image = image;
  const negative = evaluateLive(f);
  assert.equal(negative.admitted, false);
  assert.deepEqual(negative.reasons, ["signature verification failed against trust root"]);
  assert.deepEqual(negative.bindings, []);
  entry.signature = observed.signature = sign("sha256", Buffer.from(canonicalSigningPayload({ digest: entry.contentId, sourceRevision: entry.sourceRevision })), ec.privateKey).toString("base64");
  assert.equal(evaluateLive(f).admitted, true);
});

test("reject_external_fabricated_project_provenance", () => {
  rejectMutation(f => { f.input.builtInventory[1].sourceRevision = candidate; });
  rejectMutation(f => { f.policy.entries[1].sourceRevision = candidate; });
  rejectMutation(f => { f.policy.entries[1].verification = "sigstore"; });
  rejectMutation(f => { f.policy.entries[1].signature = f.input.builtInventory[1].signature = f.policy.entries[0].signature; }, /external/);
});
test("reject_test_policy_in_production", () => {
  for (const mode of [undefined, "production", "TEST", "DEV_ONLY"]) {
    const f = authenticate(fixture()); f.input.mode = mode;
    assert.match(evaluateM1aImageSet(f.input).reasons.join(" "), /P2/);
  }
});
test("capability requires independent event and clock, accepted true is not authority", () => {
  const f = authenticate(fixture());
  for (const forged of [{ accepted: true }, {}, JSON.parse(JSON.stringify(f.input.authenticatedPolicy))]) assert.equal(evaluateM1aImageSet({ ...f.input, authenticatedPolicy: forged }).admitted, false);
  assert.equal(evaluateM1aImageSet({ ...f.input, event: { ...event, runAttempt: 2 } }).admitted, false);
  assert.equal(evaluateM1aImageSet({ ...f.input, now: 99 }).admitted, false);
  assert.equal(evaluateM1aImageSet({ ...f.input, policyBytes: canonicalTestImagePolicyBytes(f.policy) }).admitted, false);
});
test("closed bounded canonical signed bytes refuse duplicate JSON keys and alternate encodings", () => {
  const f = fixture();
  const bytes = canonicalTestImagePolicyBytes(f.policy);
  assert.deepEqual(bytes, canonicalTestImagePolicyBytes({ ...f.policy, entries: [...f.policy.entries].reverse() }));
  for (const text of [bytes.toString() + "\n", bytes.toString().replace('"schema":1', '"schema":1,"schema":1')]) assert.equal(evaluateM1aImageSet(authenticate(fixture(), Buffer.from(text)).input).admitted, false);
  assert.throws(() => canonicalTestImagePolicyBytes({ ...f.policy, approved: true }));
  assert.throws(() => canonicalTestImagePolicyBytes({ ...f.policy, entries: Array(129).fill(f.policy.entries[0]) }));
});
test("collector refuses unresolved dependencies and unsupported rendered shapes", () => {
  assert.throws(() => collectRenderedImageSet({ services: { app: { image: "app:local", depends_on: ["absent"] } } }));
  assert.throws(() => collectRenderedImageSet({ services: { app: { build: "." } } }));
  assert.deepEqual(collectRenderedImageSet({ services: { app: { image: "app:local" } } }), [{ service: "app", image: "app:local", replicas: 1, dependencies: [] }]);
});
test("preserve_rel004_five_classes", async () => {
  const { RELEASE_ARTIFACT_CLASSES, evaluateReleaseManifest } = await import("../release-manifest.mjs");
  assert.deepEqual(RELEASE_ARTIFACT_CLASSES, ["control_plane", "worker", "sandbox", "desktop_installer", "desktop_updater"]);
  const artifacts = Object.fromEntries(RELEASE_ARTIFACT_CLASSES.map(k => [k, { digest: digest("a") }]));
  assert.equal(evaluateReleaseManifest({ manifest: { schema: 1, candidate, artifacts: { ...artifacts, infrastructure: { digest: digest("b") } } } }).reason, "unknown_artifact_class");
});
test("production refuses P2 even with incomplete or unsupported inputs", () => {
  for (const input of [{ mode: "production" }, { mode: "production", accepted: true }, {}]) {
    const result = evaluateM1aImageSet(input);
    assert.equal(result.admitted, false);
    assert.match(result.reasons.join(" "), /P2/);
  }
});
test("signed policy substitutions still require genuine project and external signatures", () => {
  rejectMutation(f => {
    f.policy.entries[0].contentId = f.input.builtInventory[0].contentId = digest("9");
  }, /signature/);
  rejectMutation(f => {
    f.policy.entries[0].sourceRevision = f.input.builtInventory[0].sourceRevision = "b".repeat(40);
  }, /source/);
  rejectMutation(f => {
    f.policy.entries[1].sbomSha256 = f.input.builtInventory[1].sbomSha256 = "9".repeat(64);
  }, /external/);
  const replacement = generateKeyPairSync("ec", { namedCurve: "P-256" });
  rejectMutation(f => {
    f.policy.entries[0].trustRootPem = replacement.publicKey.export({ type: "spki", format: "pem" }).toString();
    f.policy.entries[0].trustRootFingerprint = hash(replacement.publicKey.export({ type: "spki", format: "der" }));
  }, /signature/);
});
test("authenticated policy bytes cannot be changed by later policy object mutations", () => {
  const f = authenticate(fixture());
  f.policy.entries[0].contentId = digest("9");
  assert.equal(evaluateM1aImageSet(f.input).admitted, true);
  f.input.builtInventory[0].contentId = digest("9");
  assert.equal(evaluateM1aImageSet(f.input).admitted, false);
});
test("closed data refuses accessors, inherited fields, symbols and extended arrays without callbacks", () => {
  const f = authenticate(fixture());
  let calls = 0;
  const accessor = { ...f.input };
  Object.defineProperty(accessor, "now", { enumerable: true, get() { calls++; return 150; } });
  assert.equal(evaluateM1aImageSet(accessor).admitted, false);
  const inventoryAccessor = structuredClone(f.input.builtInventory);
  Object.defineProperty(inventoryAccessor[0], "contentId", { enumerable: true, get() { calls++; return digest("a"); } });
  assert.equal(evaluateM1aImageSet({ ...f.input, builtInventory: inventoryAccessor }).admitted, false);
  const arrayAccessor = [...f.input.builtInventory];
  Object.defineProperty(arrayAccessor, "0", { enumerable: true, get() { calls++; return f.input.builtInventory[0]; } });
  assert.equal(evaluateM1aImageSet({ ...f.input, builtInventory: arrayAccessor }).admitted, false);
  assert.equal(evaluateM1aImageSet(Object.assign(Object.create(f.input), {})).admitted, false);
  assert.equal(evaluateM1aImageSet({ ...f.input, [Symbol("override")]: true }).admitted, false);
  assert.throws(() => canonicalTestImagePolicyBytes({ ...f.policy, entries: Object.assign([...f.policy.entries], { extra: true }) }));
  assert.equal(calls, 0);
});

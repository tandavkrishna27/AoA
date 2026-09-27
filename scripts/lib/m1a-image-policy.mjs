/** Offline TEST policy only. P2 has not approved production fields or authority. */
import { Buffer } from "node:buffer";
import { createHash, createPublicKey } from "node:crypto";
import { readAuthenticatedTestPolicy } from "./m1a-controller.mjs";
import { evaluateAdmission, verifyDetachedSignature } from "./image-admission.mjs";

const TEST = "TEST/DEV_ONLY";
const LIMIT = 128;
const MAX_BYTES = 1024 * 1024;
const HASH = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const SERVICE_KEYS = ["service", "image", "replicas", "dependencies"];
const INVENTORY_KEYS = [...SERVICE_KEYS, "scope", "kind", "identityKind", "contentId", "ociDigest", "sourceRevision", "buildId", "sbomSha256", "scanSha256", "scanPassed", "scanCheckedAt", "signature"];
const ENTRY_KEYS = [...INVENTORY_KEYS, "verification", "trustRootPem", "trustRootFingerprint"];
const POLICY_KEYS = ["schema", "classification", "policyId", "candidate", "notBefore", "expiresAt", "maxScanAgeMs", "maxRevocationAgeMs", "revocationSequence", "revocationSha256", "entries"];
const REVOCATION_KEYS = ["classification", "policyId", "sequence", "checkedAt", "expiresAt", "revokedContentIds", "revokedRootFingerprints"];
const fail = (message) => { throw new Error(message); };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const matches = (value, re) => typeof value === "string" && re.test(value);
const time = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const positive = (value) => Number.isSafeInteger(value) && value > 0;

function record(value, keys, optional = []) {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) fail("invalid closed record");
  const ds = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(ds);
  if (own.some(k => !keys.includes(k)) || keys.some(k => !optional.includes(k) && !own.includes(k))) fail("unknown or missing field");
  const out = {};
  for (const k of keys) {
    if (!own.includes(k)) continue;
    if (!("value" in ds[k]) || !ds[k].enumerable) fail("accessor or hidden field refused");
    out[k] = ds[k].value;
  }
  return out;
}
function array(value, max = LIMIT) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) fail("invalid bounded array");
  const ds = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(ds).length !== value.length + 1) fail("sparse or extended array");
  return Array.from({ length: value.length }, (_, i) => {
    if (!ds[i] || !("value" in ds[i]) || !ds[i].enumerable) fail("array accessor refused");
    return ds[i].value;
  });
}
function strings(value, re) {
  const values = array(value);
  if (values.some(v => !matches(v, re)) || new Set(values).size !== values.length) fail("invalid or duplicate identities");
  return values.sort(cmp);
}
function service(value) {
  const s = record(value, SERVICE_KEYS);
  if (!matches(s.service, LABEL) || typeof s.image !== "string" || s.image.length > 512 || !/^[A-Za-z0-9][A-Za-z0-9_./:@-]*$/.test(s.image) || !positive(s.replicas) || s.replicas > LIMIT) fail("invalid service/image/replicas");
  s.dependencies = strings(s.dependencies, LABEL);
  if (s.dependencies.includes(s.service)) fail("self dependency");
  return s;
}
function unique(values) {
  if (new Set(values.map(e => e.service)).size !== values.length) fail("duplicate service");
  return values.sort((a, b) => cmp(a.service, b.service));
}

/** Closed supported rendered-Compose TEST subset. Unsupported shapes refuse. No Docker. */
export function collectRenderedImageSet(renderedCompose) {
  const { services } = record(renderedCompose, ["services"]);
  if (!services || typeof services !== "object" || Object.getPrototypeOf(services) !== Object.prototype) fail("invalid services");
  const ds = Object.getOwnPropertyDescriptors(services);
  const names = Reflect.ownKeys(ds);
  if (!names.length || names.length > LIMIT || names.some(n => !matches(n, LABEL))) fail("invalid service set");
  const out = names.map(name => {
    if (!("value" in ds[name]) || !ds[name].enumerable) fail("service accessor refused");
    const s = record(ds[name].value, ["image", "depends_on", "deploy"], ["depends_on", "deploy"]);
    const replicas = s.deploy === undefined ? 1 : record(s.deploy, ["replicas"]).replicas;
    return service({ service: name, image: s.image, dependencies: s.depends_on === undefined ? [] : s.depends_on, replicas });
  });
  if (out.some(s => s.dependencies.some(d => !names.includes(d)))) fail("unresolved dependency");
  return unique(out);
}
function inventory(value, policyEntry = false) {
  const e = record(value, policyEntry ? ENTRY_KEYS : INVENTORY_KEYS);
  Object.assign(e, service(Object.fromEntries(SERVICE_KEYS.map(k => [k, e[k]]))));
  if (!["runtime", "provider"].includes(e.scope) || !["project", "external"].includes(e.kind)
    || !["docker-config-id", "oci-manifest-digest"].includes(e.identityKind)
    || !matches(e.contentId, DIGEST) || !matches(e.sbomSha256, HASH) || !matches(e.scanSha256, HASH)
    || e.scanPassed !== true || !time(e.scanCheckedAt)
    || typeof e.signature !== "string" || e.signature.length > 1024
    || (e.signature !== "" && (!/^[A-Za-z0-9+/]+={0,2}$/.test(e.signature) || Buffer.from(e.signature, "base64").toString("base64") !== e.signature))) fail("invalid image/SBOM/scan/signature evidence");
  // A Docker image ID hashes config bytes, never an OCI manifest. Registry bindings
  // must have an explicit digest reference; local IDs may use a local lookup tag.
  if (e.identityKind === "docker-config-id") {
    if (e.ociDigest !== null || e.kind !== "project" || e.image.includes("@")) fail("Docker config ID is not an OCI digest");
  } else if (e.ociDigest !== e.contentId || !e.image.endsWith(`@${e.ociDigest}`)) fail("mutable or mismatched OCI reference");
  if (e.kind === "project") {
    if (!matches(e.sourceRevision, SHA) || !matches(e.buildId, LABEL)) fail("missing source/build identity");
  } else if (e.sourceRevision !== null || e.buildId !== null) fail("external fabricated project provenance");
  if (policyEntry) {
    if (e.verification !== (e.kind === "project" ? "project-pem-v1" : "TEST-external-pem-v1")) fail("unsupported external/project verification policy");
    if (typeof e.trustRootPem !== "string" || e.trustRootPem.length > 4096 || !e.trustRootPem.startsWith("-----BEGIN PUBLIC KEY-----") || !matches(e.trustRootFingerprint, HASH)) fail("invalid TEST trust root");
    const key = createPublicKey(e.trustRootPem);
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
      || hash(key.export({ type: "spki", format: "der" })) !== e.trustRootFingerprint) fail("TEST root fingerprint/algorithm mismatch");
  }
  return e;
}
function policy(value) {
  const p = record(value, POLICY_KEYS);
  if (p.schema !== 1 || p.classification !== TEST) fail("P2 unresolved; TEST/DEV_ONLY required");
  if (!matches(p.policyId, LABEL) || !matches(p.candidate, SHA) || !time(p.notBefore) || !time(p.expiresAt) || p.expiresAt <= p.notBefore
    || !positive(p.maxScanAgeMs) || p.maxScanAgeMs > 86400000 || !positive(p.maxRevocationAgeMs) || p.maxRevocationAgeMs > 86400000
    || !positive(p.revocationSequence) || !matches(p.revocationSha256, HASH)) fail("invalid TEST policy bounds");
  p.entries = unique(array(p.entries).map(e => inventory(e, true)));
  if (!p.entries.length || !p.entries.some(e => e.scope === "runtime")) fail("empty runtime image set");
  const runtime = p.entries.filter(e => e.scope === "runtime").map(e => e.service);
  if (p.entries.some(e => e.dependencies.some(d => !runtime.includes(d)) || (e.kind === "project" && e.sourceRevision !== p.candidate))) fail("policy dependency/source binding mismatch");
  return p;
}
function bytes(value) {
  const result = Buffer.from(JSON.stringify(value), "utf8");
  if (result.length > MAX_BYTES) fail("TEST policy byte bound");
  return result;
}
/** Fixed root/entry key order, code-unit sorted services and sets, no newline. */
export function canonicalTestImagePolicyBytes(value) { return bytes(policy(value)); }
export function canonicalTestRevocationBytes(value) {
  const r = record(value, REVOCATION_KEYS);
  if (r.classification !== TEST || !matches(r.policyId, LABEL) || !positive(r.sequence) || !time(r.checkedAt) || !time(r.expiresAt) || r.expiresAt <= r.checkedAt) fail("invalid TEST revocation evidence");
  r.revokedContentIds = strings(r.revokedContentIds, DIGEST);
  r.revokedRootFingerprints = strings(r.revokedRootFingerprints, HASH);
  return bytes(r);
}
/** Synthetic external identity path ONLY. No claim of provider/Sigstore verification. */
export function externalTestSigningPayload(value) {
  const e = inventory(value, true);
  if (e.kind !== "external") fail("external TEST signature requires external identity");
  return JSON.stringify({ domain: "aoa-m1a-external-TEST-DEV_ONLY-v1", service: e.service, scope: e.scope, image: e.image, identityKind: e.identityKind, contentId: e.contentId, ociDigest: e.ociDigest, sbomSha256: e.sbomSha256, scanSha256: e.scanSha256 });
}
const refused = (reason) => ({ classification: TEST, admitted: false, reasons: [reason], bindings: [] });

/** Caller supplies independent TEST event/clock, never candidate-selected authority. */
export function evaluateM1aImageSet(input) {
  try {
    const mode = input && typeof input === "object" ? Object.getOwnPropertyDescriptor(input, "mode") : null;
    if (!mode || !("value" in mode) || mode.value !== TEST) return refused("production admission refuses: P2 unresolved");
    const q = record(input, ["mode", "authenticatedPolicy", "event", "renderedServices", "builtInventory", "providerInventory", "now", "revocationEvidence"]);
    if (q.mode !== TEST) return refused("production admission refuses: P2 unresolved");
    const handoff = readAuthenticatedTestPolicy(q.authenticatedPolicy, { event: q.event, now: q.now });
    if (!handoff) return refused("missing authenticated TEST policy capability/event/clock");
    // Authenticate exact bytes, then reject every alternate serialization (including
    // duplicate keys). No caller policy object/bytes can replace the capability bytes.
    const p = policy(JSON.parse(handoff.policyBytes.toString("utf8")));
    if (!canonicalTestImagePolicyBytes(p).equals(handoff.policyBytes)) fail("noncanonical authenticated policy bytes");
    if (p.candidate !== handoff.event.candidate || q.now < p.notBefore || q.now >= p.expiresAt) fail("TEST policy source mismatch or expired");
    const revBytes = canonicalTestRevocationBytes(q.revocationEvidence);
    const r = JSON.parse(revBytes.toString("utf8"));
    if (hash(revBytes) !== p.revocationSha256 || r.policyId !== p.policyId || r.sequence !== p.revocationSequence
      || q.now < r.checkedAt || q.now >= r.expiresAt || q.now - r.checkedAt > p.maxRevocationAgeMs) fail("missing/mismatched/stale revocation evidence");
    const rendered = unique(array(q.renderedServices).map(service));
    const built = unique(array(q.builtInventory).map(e => inventory(e)));
    const providers = unique(array(q.providerInventory).map(e => inventory(e)));
    if (built.some(e => e.scope !== "runtime") || providers.some(e => e.scope !== "provider")) fail("inventory scope mismatch");
    const observed = unique([...built, ...providers]);
    const expectedRuntime = p.entries.filter(e => e.scope === "runtime").map(e => Object.fromEntries(SERVICE_KEYS.map(k => [k, e[k]])));
    if (JSON.stringify(rendered) !== JSON.stringify(expectedRuntime) || observed.length !== p.entries.length) fail("complete service/image set mismatch");
    const bindings = [];
    for (let i = 0; i < p.entries.length; i++) {
      const approved = p.entries[i];
      const actual = observed[i];
      if (JSON.stringify(actual) !== JSON.stringify(Object.fromEntries(INVENTORY_KEYS.map(k => [k, approved[k]])))) fail("approved digest/source/build/signature/evidence binding changed");
      if (q.now < actual.scanCheckedAt || q.now - actual.scanCheckedAt > p.maxScanAgeMs) fail("stale scan evidence");
      if (r.revokedContentIds.includes(actual.contentId) || r.revokedRootFingerprints.includes(approved.trustRootFingerprint)) fail("revoked image/root approval");
      if (actual.kind === "project") {
        const verdict = evaluateAdmission({ digest: actual.contentId, signature: actual.signature, provenance: { sourceRevision: actual.sourceRevision }, allowlist: [{ image: actual.image, digest: approved.contentId, sourceRevision: approved.sourceRevision }], trustRoot: approved.trustRootPem });
        if (!verdict.admitted) fail(verdict.reason);
      } else if (!verifyDetachedSignature(externalTestSigningPayload(approved), actual.signature, approved.trustRootPem)) fail("external TEST signature verification failed");
      bindings.push({ ...actual, policyId: p.policyId, policySha256: handoff.policySha256, controllerSha: handoff.controllerSha, trustRootFingerprint: approved.trustRootFingerprint });
    }
    return { classification: TEST, admitted: true, reasons: [], bindings };
  } catch (error) {
    return refused(error instanceof Error ? error.message : "malformed TEST image policy request");
  }
}

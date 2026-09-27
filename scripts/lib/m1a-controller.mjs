/** Offline TEST/DEV_ONLY seam. No production authority schema or loader exists here. */
import { createHash, createPublicKey, verify } from "node:crypto";
import { Buffer } from "node:buffer";

const CLASSIFICATION = "TEST/DEV_ONLY";
const EVENT_KEYS = ["repository", "headRepository", "eventName", "candidate", "runId", "runAttempt"];
const BINDING_KEYS = ["schema", "classification", "controllerSha", "policyAuthorityPublicKeyPem", "policyAuthorityFingerprint", ...EVENT_KEYS, "notBefore", "expiresAt", "policySha256"];
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const capabilities = new WeakMap();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const time = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;

// Snapshot closed data records without invoking accessors or accepting inherited fields.
function record(value, keys) {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("invalid record");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => !keys.includes(key))) throw new Error("unknown or missing field");
  return Object.fromEntries(keys.map((key) => {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error("invalid field");
    return [key, descriptor.value];
  }));
}

function eventRecord(value) {
  const event = record(value, EVENT_KEYS);
  if (typeof event.repository !== "string" || !REPOSITORY.test(event.repository)
    || event.headRepository !== event.repository
    || !["workflow_dispatch", "push"].includes(event.eventName)
    || typeof event.candidate !== "string" || !SHA.test(event.candidate)
    || typeof event.runId !== "string" || !/^[1-9][0-9]{0,19}$/.test(event.runId)
    || !Number.isSafeInteger(event.runAttempt) || event.runAttempt < 1) throw new Error("invalid TEST event context");
  return event;
}

function bindingRecord(value) {
  const binding = record(value, BINDING_KEYS);
  if (binding.schema !== 1 || binding.classification !== CLASSIFICATION) throw new Error("production authorities unresolved; explicit TEST/DEV_ONLY binding required");
  eventRecord(Object.fromEntries(EVENT_KEYS.map((key) => [key, binding[key]])));
  if (typeof binding.controllerSha !== "string" || !SHA.test(binding.controllerSha)
    || typeof binding.policyAuthorityFingerprint !== "string" || !HASH.test(binding.policyAuthorityFingerprint)
    || typeof binding.policySha256 !== "string" || !HASH.test(binding.policySha256)
    || !time(binding.notBefore) || !time(binding.expiresAt) || binding.expiresAt <= binding.notBefore
    || typeof binding.policyAuthorityPublicKeyPem !== "string"
    || binding.policyAuthorityPublicKeyPem.length > 4096
    || !binding.policyAuthorityPublicKeyPem.startsWith("-----BEGIN PUBLIC KEY-----")) throw new Error("invalid TEST binding");
  const key = createPublicKey(binding.policyAuthorityPublicKeyPem);
  if (key.asymmetricKeyType !== "ed25519"
    || hash(key.export({ type: "spki", format: "der" })) !== binding.policyAuthorityFingerprint) throw new Error("TEST policy authority fingerprint mismatch");
  return { binding, key };
}

function policyCopy(value) {
  if (!Buffer.isBuffer(value) || value.length === 0 || value.length > 1024 * 1024) throw new Error("invalid TEST policy bytes");
  return Buffer.from(value);
}

function payload(binding, bytes) {
  return Buffer.from(JSON.stringify({ domain: "aoa-m1a-controller-TEST-DEV_ONLY-v1", protectedBinding: binding, policyBase64: bytes.toString("base64") }), "utf8");
}

/** Fixture signing preimage only; this helper neither signs nor confers authority. */
export function controllerTestSigningPayload({ protectedBinding, policyBytes }) {
  return payload(bindingRecord(protectedBinding).binding, policyCopy(policyBytes));
}

function reject(reason) {
  return Object.freeze({ accepted: false, reasons: Object.freeze([reason]) });
}

/**
 * The caller injects independently protected TEST configuration and observed context.
 * Candidate data must never supply either. Production always refuses unresolved P1/P2.
 * This verifies consistency/signatures under that injection, not its external custody.
 * policyBytes are opaque: Task 2 must validate their TEST profile grammar separately.
 */
export function authenticateController(input) {
  try {
    const request = record(input, ["protectedBinding", "observedController", "event", "policyBytes", "policySignature", "now"]);
    const { binding, key } = bindingRecord(request.protectedBinding);
    const controller = record(request.observedController, ["sha"]);
    if (controller.sha !== binding.controllerSha) return reject("protected controller revision mismatch");
    const event = eventRecord(request.event);
    if (EVENT_KEYS.some((field) => event[field] !== binding[field])) return reject("protected event context mismatch");
    if (!time(request.now) || request.now < binding.notBefore || request.now >= binding.expiresAt) return reject("TEST binding not currently valid");
    const bytes = policyCopy(request.policyBytes);
    if (hash(bytes) !== binding.policySha256) return reject("protected policy bytes mismatch");
    const signature = request.policySignature;
    if (typeof signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) return reject("invalid TEST policy signature");
    const decoded = Buffer.from(signature, "base64");
    if (decoded.length !== 64 || decoded.toString("base64") !== signature
      || !verify(null, payload(binding, bytes), key, decoded)) return reject("TEST policy signature verification failed");
    const capability = Object.freeze(Object.create(null));
    capabilities.set(capability, { binding: Object.freeze(binding), event: Object.freeze(event), bytes, authenticatedAt: request.now });
    return Object.freeze({ accepted: true, reasons: Object.freeze([]), testPolicyCapability: capability });
  } catch {
    return reject("missing, malformed or unresolved protected TEST authority/context");
  }
}

/**
 * Task 2 must redeem the original opaque object in this module instance, with
 * independently observed event/clock. Clones, JSON, and accepted:true are not authority.
 * Returns a fresh byte copy or null; never a production approval or executable path.
 */
export function readAuthenticatedTestPolicy(capability, context) {
  try {
    const stored = capabilities.get(capability);
    if (!stored) return null;
    const { event: inputEvent, now } = record(context, ["event", "now"]);
    const event = eventRecord(inputEvent);
    if (!time(now) || now < stored.authenticatedAt || now >= stored.binding.expiresAt
      || EVENT_KEYS.some((field) => event[field] !== stored.event[field])) return null;
    return Object.freeze({ classification: CLASSIFICATION, controllerSha: stored.binding.controllerSha,
      policySha256: stored.binding.policySha256, policyAuthorityFingerprint: stored.binding.policyAuthorityFingerprint,
      event: stored.event, notBefore: stored.binding.notBefore, expiresAt: stored.binding.expiresAt,
      policyBytes: Buffer.from(stored.bytes) });
  } catch {
    return null;
  }
}

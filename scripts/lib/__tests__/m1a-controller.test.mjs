import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { authenticateController, controllerTestSigningPayload, readAuthenticatedTestPolicy } from "../m1a-controller.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const policyBytes = Buffer.from('{"classification":"TEST/DEV_ONLY","images":[]}');
  const event = { repository: "TEST/offline", headRepository: "TEST/offline", eventName: "workflow_dispatch", candidate: "a".repeat(40), runId: "123", runAttempt: 1 };
  const protectedBinding = {
    schema: 1, classification: "TEST/DEV_ONLY", controllerSha: "b".repeat(40),
    policyAuthorityPublicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    policyAuthorityFingerprint: sha(publicKey.export({ type: "spki", format: "der" })),
    ...event, notBefore: 1000, expiresAt: 2000, policySha256: sha(policyBytes),
  };
  const input = { protectedBinding, observedController: { sha: protectedBinding.controllerSha }, event: { ...event }, policyBytes, now: 1500 };
  input.policySignature = sign(null, controllerTestSigningPayload({ protectedBinding, policyBytes }), privateKey).toString("base64");
  return { input, privateKey };
}
function refuses(input) {
  const result = authenticateController(input);
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.length > 0);
  assert.equal(result.testPolicyCapability, undefined);
  return result;
}

test("accepts_only_explicit_test_binding_and_authenticated_policy", () => {
  const { input } = fixture();
  const result = authenticateController(input);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.reasons, []);
  const handoff = readAuthenticatedTestPolicy(result.testPolicyCapability, { event: input.event, now: input.now });
  assert.equal(handoff.classification, "TEST/DEV_ONLY");
  assert.deepEqual(handoff.policyBytes, input.policyBytes);
  assert.equal(handoff.controllerSha, input.protectedBinding.controllerSha);
});

test("reject_candidate_selected_controller", () => {
  const { input } = fixture();
  refuses({ ...input, observedController: { sha: "c".repeat(40) } });
  refuses({ ...input, observedController: { sha: "b".repeat(7) } });
  refuses({ ...input, controllerPath: "candidate/verifier.mjs" });
});

test("reject_entire_authority_bundle_substitution", () => {
  const original = fixture().input;
  const { input: replacement, privateKey } = fixture();
  replacement.protectedBinding.controllerSha = "c".repeat(40);
  replacement.observedController.sha = replacement.protectedBinding.controllerSha;
  replacement.policyBytes = Buffer.from('{"classification":"TEST/DEV_ONLY","roots":["replacement"]}');
  replacement.protectedBinding.policySha256 = sha(replacement.policyBytes);
  replacement.policySignature = sign(null, controllerTestSigningPayload(replacement), privateKey).toString("base64");
  assert.equal(authenticateController(replacement).accepted, true);
  refuses({ ...replacement, protectedBinding: original.protectedBinding });
  refuses({ ...original, policySignature: replacement.policySignature });
  refuses({ ...original, policyBytes: Buffer.from("replacement roots/profile") });
});

test("same_controller_replacement_signer_refuses_under_original_pinned_key", () => {
  const { input: original } = fixture();
  const replacement = generateKeyPairSync("ed25519");
  const payload = controllerTestSigningPayload(original);
  assert.equal(authenticateController(original).accepted, true);
  const forged = { ...original, policySignature: sign(null, payload, replacement.privateKey).toString("base64") };
  assert.deepEqual(refuses(forged).reasons, ["TEST policy signature verification failed"]);
  // Replacing the injected TEST authority is caller-controlled, not external bootstrap.
  const protectedBinding = { ...original.protectedBinding,
    policyAuthorityPublicKeyPem: replacement.publicKey.export({ type: "spki", format: "pem" }),
    policyAuthorityFingerprint: sha(replacement.publicKey.export({ type: "spki", format: "der" })),
  };
  const rebound = { ...original, protectedBinding };
  rebound.policySignature = sign(null, controllerTestSigningPayload(rebound), replacement.privateKey).toString("base64");
  assert.equal(authenticateController(rebound).accepted, true);
  assert.deepEqual(refuses({ ...rebound, protectedBinding: original.protectedBinding }).reasons, ["TEST policy signature verification failed"]);
});

test("reject_fork_or_wrong_run_attempt", () => {
  const { input } = fixture();
  for (const [field, value] of Object.entries({ repository: "fork/offline", headRepository: "fork/offline", eventName: "pull_request", candidate: "d".repeat(40), runId: "124", runAttempt: 2 })) {
    refuses({ ...input, event: { ...input.event, [field]: value } });
  }
});

test("reject_expired_or_missing_binding", () => {
  const { input } = fixture();
  for (const now of [999, 2000, NaN, Infinity, "1500"]) refuses({ ...input, now });
  for (const protectedBinding of [undefined, null, {}, { ...input.protectedBinding, classification: "PRODUCTION" }]) refuses({ ...input, protectedBinding });
  refuses(undefined);
});

test("signature_authenticates_every_binding_field", () => {
  const { input } = fixture();
  for (const [field, value] of Object.entries({ schema: 2, classification: "PRODUCTION", controllerSha: "c".repeat(40), policyAuthorityPublicKeyPem: input.protectedBinding.policyAuthorityPublicKeyPem + "\n", repository: "TEST/other", headRepository: "TEST/other", eventName: "push", candidate: "d".repeat(40), runId: "124", runAttempt: 2, notBefore: 1100, expiresAt: 2100, policySha256: "e".repeat(64), policyAuthorityFingerprint: "f".repeat(64) })) {
    const protectedBinding = { ...input.protectedBinding, [field]: value };
    const event = { ...input.event };
    if (field in event) event[field] = value;
    if (["repository", "headRepository"].includes(field)) {
      protectedBinding.repository = protectedBinding.headRepository = value;
      event.repository = event.headRepository = value;
    }
    refuses({ ...input, protectedBinding, event, observedController: { sha: protectedBinding.controllerSha } });
  }
});

test("closed_bounded_inputs_refuse_without_effect_callbacks", () => {
  const { input } = fixture();
  const calls = { start: 0, sign: 0, upload: 0 };
  const hooks = Object.fromEntries(Object.keys(calls).map((name) => [name, () => calls[name]++]));
  refuses({ ...input, ...hooks });
  assert.deepEqual(calls, { start: 0, sign: 0, upload: 0 });
  for (const policyBytes of ["text", Buffer.alloc(0), Buffer.alloc(1024 * 1024 + 1)]) refuses({ ...input, policyBytes });
  for (const policySignature of ["", "garbage", "A".repeat(10000), "AA=="]) refuses({ ...input, policySignature });
  refuses({ ...input, protectedBinding: { ...input.protectedBinding, extra: true } });
  refuses({ ...input, event: { ...input.event, runAttempt: 0 } });
  refuses({ ...input, protectedBinding: { ...input.protectedBinding, policyAuthorityPublicKeyPem: "invalid" } });
});

test("malformed_data_does_not_invoke_accessors_or_string_coercion", () => {
  const { input } = fixture();
  let calls = 0;
  const repository = { toString() { calls++; return "TEST/offline"; } };
  refuses({ ...input, event: { ...input.event, repository } });
  const event = { ...input.event };
  Object.defineProperty(event, "repository", { enumerable: true, get() { calls++; return "TEST/offline"; } });
  refuses({ ...input, event });
  assert.equal(calls, 0);
});

test("test_handoff_cannot_be_forged_replayed_or_mutated", () => {
  const { input } = fixture();
  const result = authenticateController(input);
  const context = { event: { ...input.event }, now: 1500 };
  for (const fake of [undefined, {}, { accepted: true }, JSON.parse(JSON.stringify(result)), { ...result.testPolicyCapability }]) {
    assert.equal(readAuthenticatedTestPolicy(fake, context), null);
  }
  assert.equal(readAuthenticatedTestPolicy(result.testPolicyCapability, { ...context, now: 2000 }), null);
  assert.equal(readAuthenticatedTestPolicy(result.testPolicyCapability, { ...context, now: 1499 }), null);
  assert.equal(readAuthenticatedTestPolicy(result.testPolicyCapability, { ...context, event: { ...context.event, runAttempt: 2 } }), null);
  const first = readAuthenticatedTestPolicy(result.testPolicyCapability, context);
  first.policyBytes.fill(0);
  input.policyBytes.fill(0);
  input.event.runId = "999";
  input.protectedBinding.expiresAt = 9000;
  assert.notDeepEqual(readAuthenticatedTestPolicy(result.testPolicyCapability, context).policyBytes, first.policyBytes);
  assert.equal(readAuthenticatedTestPolicy(result.testPolicyCapability, { ...context, now: 2000 }), null);
});

test("imports_have_no_io", () => {
  const url = new URL("../m1a-controller.mjs", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { syncBuiltinESMExports } from 'node:module';
    import { readFileSync } from 'node:fs';
    import 'node:crypto';
    import 'node:buffer';
    // Read source before instrumentation so Node's own loader is not counted as module IO.
    const source = readFileSync(new URL(${JSON.stringify(url)}), 'utf8');
    const names = ['fs', 'fs/promises', 'child_process', 'net', 'http', 'https', 'dns'];
    const modules = await Promise.all(names.map(name => import('node:' + name)));
    for (let index = 0; index < names.length; index++) {
      const name = names[index];
      const mod = modules[index].default;
      for (const key of Object.keys(mod)) {
        if (typeof mod[key] === 'function') {
          try { mod[key] = () => { throw new Error('IO attempted: ' + name + '.' + key); }; } catch {}
        }
      }
    }
    globalThis.fetch = () => { throw new Error('fetch attempted'); };
    syncBuiltinESMExports();
    await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  `], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "");
});

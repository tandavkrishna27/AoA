import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateFaultMatrixEvidence } from "../campaign-fault-matrix.mjs";

const moduleUnderTest = await import("../d1-redaction-evidence.mjs").catch(() => ({}));
const sharedObserver = await import("../redaction-arm-evidence.mjs").catch(() => ({}));

const NONCES = {
  graded: "graded-0123456789abcdef",
  suppressed: "withheld-0123456789abcdef",
};
const TAG = "AOA-RUN-OUTPUT-PROBE";
const MARKER = "«redacted»";

test("shared arm observation requires exact nonce and inert-control tokens on each stream", () => {
  assert.equal(typeof sharedObserver.observeRedactionArm, "function");
  const input = arm(NONCES.suppressed);
  const valid = sharedObserver.observeRedactionArm(input);
  assert.deepEqual(valid.observedOnStream, { events: true, logs: true });
  assert.deepEqual(valid.verbatimCanaryObservedOnStream, { events: true, logs: true });
  for (const text of ["", "attempt_started", `${TAG} arm=stale control=${input.controlCanary}`,
    `${TAG} arm=${input.nonce}suffix control=${input.controlCanary}`]) {
    const observed = sharedObserver.observeRedactionArm({ ...input, streams: { events: text, logs: text } });
    assert.deepEqual(observed.observedOnStream, { events: false, logs: false });
    assert.deepEqual(observed.streamBytesObserved, { events: 0, logs: 0 });
  }
  for (const control of ["wrong", `${input.controlCanary}suffix`, ""]) {
    const text = `${TAG} arm=${input.nonce} control=${control}`;
    const observed = sharedObserver.observeRedactionArm({ ...input, streams: { events: text, logs: text } });
    assert.deepEqual(observed.verbatimCanaryObservedOnStream, { events: false, logs: false });
  }
  const serialized = JSON.stringify(valid);
  assert.ok(!serialized.includes(input.controlCanary));
  assert.ok(!serialized.includes(TAG));
});

test("JSON-encoded control suffixes cannot pass either shared observation or D1 grading", () => {
  const input = arm(NONCES.suppressed);
  for (const suffix of ["\\suffix", '"suffix', "suffix"]) {
    const line = `${TAG} arm=${input.nonce} control=${input.controlCanary}${suffix}`;
    const streams = {
      events: `log ${JSON.stringify({ payload: { text: line } })}`,
      logs: `worker-a-1 | ${JSON.stringify({ msg: line })}`,
    };
    const suppressed = { ...input, streams };
    assert.deepEqual(sharedObserver.observeRedactionArm(suppressed).verbatimCanaryObservedOnStream, { events: false, logs: false });
    assert.equal(moduleUnderTest.evaluateD1RedactionEvidence({ suppressed }).row.positiveControlPassed, false);
  }
  const line = `${TAG} arm=${input.nonce} control=${input.controlCanary}\n`;
  const valid = sharedObserver.observeRedactionArm({ ...input,
    streams: {
      events: `log ${JSON.stringify({ payload: { text: line } })}`,
      logs: `worker-a-1 | ${JSON.stringify({ msg: line })}`,
    },
  });
  assert.deepEqual(valid.verbatimCanaryObservedOnStream, { events: true, logs: true });
});

test("D1 complete evidence still passes standalone grading with the strengthened suppressed schema", () => {
  const input = {
    canary: "inert-canary", crossTenantCanaryAbsent: true,
    graded: arm(NONCES.graded, {
      eventLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
      logLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
    }),
    suppressed: arm(NONCES.suppressed),
  };
  const matrix = JSON.parse(readFileSync(new URL("../../../tests/d1/fault-matrix.json", import.meta.url), "utf8"));
  const profile = matrix.profiles.find((p) => p.profile === "M1-D1-SPINE");
  profile.cases = profile.cases.filter((c) => c.case === "d1.redaction.planted_canary_scrubbed");
  const row = moduleUnderTest.serializeD1FaultMatrixRow(profile.cases[0].case, moduleUnderTest.evaluateD1RedactionEvidence(input).row);
  assert.equal(row.positiveControlPassed, true);
  assert.deepEqual(evaluateFaultMatrixEvidence(matrix, { profile: profile.profile, cases: [JSON.parse(JSON.stringify(row))] }).violations, []);
});

function arm(nonce, { attemptStatus = "succeeded", eventLine, logLine } = {}) {
  const controlCanary = `control-${nonce}`;
  const defaultLine = `${TAG} arm=${nonce} control=${controlCanary}`;
  return {
    nonce,
    controlCanary,
    attemptStatus,
    streams: {
      events: eventLine ?? defaultLine,
      logs: logLine ?? defaultLine,
    },
  };
}

test("DEP-027 exports the nonce-scoped D1 redaction evidence judge", () => {
  assert.equal(typeof moduleUnderTest.evaluateD1RedactionEvidence, "function");
});

test("DEP-027 rendered arm inputs keep the withheld capability secret distinct and its control canary unhandled", () => {
  const graded = moduleUnderTest.buildD1RedactionArmInputs({ plant: true, nonce: "g", canary: "graded-secret", controlCanary: undefined, capabilitySecret: undefined });
  const withheld = moduleUnderTest.buildD1RedactionArmInputs({ plant: false, nonce: "w", canary: "graded-secret", controlCanary: "inert-control", capabilitySecret: "withheld-capability" });
  assert.equal(graded.secretValue, "graded-secret");
  assert.equal(withheld.secretValue, "withheld-capability");
  assert.notEqual(withheld.secretValue, graded.secretValue);
  assert.deepEqual(withheld.workloadArgs, ["--aoa-fake-probe-nonce=w", "--aoa-fake-control-canary=inert-control"]);
  assert.equal(JSON.stringify(withheld).includes("control=inert-control"), false);
});

test("DEP-027 stale nonce lines cannot satisfy either arm", () => {
  const evaluate = moduleUnderTest.evaluateD1RedactionEvidence;
  assert.equal(typeof evaluate, "function");
  const result = evaluate({
    canary: "inert-canary",
    crossTenantCanaryAbsent: true,
    graded: arm(NONCES.graded, {
      eventLine: `${TAG} arm=stale-0123456789abcdef value=${MARKER}`,
      logLine: `${TAG} arm=stale-0123456789abcdef value=${MARKER}`,
    }),
    suppressed: arm(NONCES.suppressed),
  });
  assert.equal(result.row.injectionFired, false);
  assert.equal(result.row.scrubberMarkerObservedOnStream.events, false);
  assert.equal(result.row.scrubberMarkerObservedOnStream.logs, false);
});

test("DEP-027 missing per-stream suppressed evidence fails the retained control", () => {
  const result = moduleUnderTest.evaluateD1RedactionEvidence({
    canary: "inert-canary",
    crossTenantCanaryAbsent: true,
    graded: arm(NONCES.graded, {
      eventLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
      logLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
    }),
    suppressed: {
      ...arm(NONCES.suppressed),
      streams: { events: `${TAG} arm=${NONCES.suppressed} control=unseeded` },
    },
  });
  assert.equal(result.row.positiveControlPassed, false);
  assert.equal(result.row.suppressedArmEvidence.observedOnStream.logs, false);
});

test("DEP-027 a failed control terminal cannot pass", () => {
  const result = moduleUnderTest.evaluateD1RedactionEvidence({
    canary: "inert-canary",
    crossTenantCanaryAbsent: true,
    graded: arm(NONCES.graded, {
      eventLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
      logLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
    }),
    suppressed: arm(NONCES.suppressed, { attemptStatus: "failed" }),
  });
  assert.equal(result.row.positiveControlPassed, false);
  assert.equal(result.row.suppressedArmEvidence.attemptStatus, "failed");
});

test("DEP-027 a foreign-tenant canary leak makes the retained row fail", () => {
  const result = moduleUnderTest.evaluateD1RedactionEvidence({
    canary: "inert-canary",
    crossTenantCanaryAbsent: false,
    graded: arm(NONCES.graded, {
      eventLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
      logLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
    }),
    suppressed: arm(NONCES.suppressed),
  });
  assert.equal(result.row.crossTenantCanaryAbsent, false);
  assert.equal(result.row.redactedOnAllStreams, false);
  assert.equal(result.row.observedClassification, "canary_leaked_on_a_stream");
  const serialized = moduleUnderTest.serializeD1FaultMatrixRow("d1.redaction.planted_canary_scrubbed", result.row);
  assert.equal(serialized.crossTenantCanaryAbsent, false, "the actual bundle serializer must retain the refusal fact");
  const matrix = JSON.parse(readFileSync(new URL("../../../tests/d1/fault-matrix.json", import.meta.url), "utf8"));
  const verdict = evaluateFaultMatrixEvidence(matrix, { profile: "M1-D1-SPINE", cases: [serialized] });
  assert.ok(verdict.violations.some((v) => v.code === "evidence:redaction_cross_tenant_leak"));
});

test("DEP-027 the credential-free control must carry its inert canary verbatim on both streams", () => {
  const suppressed = arm(NONCES.suppressed);
  suppressed.streams.logs = `${TAG} arm=${NONCES.suppressed} control=wrong-inert-canary`;
  const result = moduleUnderTest.evaluateD1RedactionEvidence({
    canary: "inert-canary",
    crossTenantCanaryAbsent: true,
    graded: arm(NONCES.graded, {
      eventLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
      logLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
    }),
    suppressed,
  });
  assert.equal(result.row.positiveControlPassed, false);
  assert.deepEqual(result.row.suppressedArmEvidence.verbatimCanaryObservedOnStream, { events: true, logs: false });
});

for (const stream of ["events", "logs"]) {
  test(`DEP-027 a marker on the suppressed ${stream} stream fails independently`, () => {
    const suppressed = arm(NONCES.suppressed);
    suppressed.streams[stream] = `${TAG} arm=${NONCES.suppressed} value=${MARKER}`;
    const result = moduleUnderTest.evaluateD1RedactionEvidence({
      canary: "inert-canary",
      crossTenantCanaryAbsent: true,
      graded: arm(NONCES.graded, {
        eventLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
        logLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
      }),
      suppressed,
    });
    assert.equal(result.row.positiveControlPassed, false);
    assert.equal(result.row.suppressedArmEvidence.scrubberMarkerObservedOnStream[stream], true);
  });
}

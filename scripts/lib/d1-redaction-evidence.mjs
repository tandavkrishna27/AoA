import { REDACTION_STREAMS, observeRedactionArm } from "./redaction-arm-evidence.mjs";

export const D1_REDACTION_STREAMS = REDACTION_STREAMS;
export const D1_REDACTION_REQUIRED_ATTEMPT_STATUS = "succeeded";


export function buildD1RedactionArmInputs({ plant, nonce, canary, controlCanary, capabilitySecret }) {
  return {
    workloadArgs: plant
      ? [`--aoa-fake-probe-nonce=${nonce}`, "--aoa-fake-echo-env=ANTHROPIC_API_KEY"]
      : [`--aoa-fake-probe-nonce=${nonce}`, `--aoa-fake-control-canary=${controlCanary}`],
    secretValue: plant ? canary : capabilitySecret,
  };
}

export function evaluateD1RedactionEvidence({ canary, crossTenantCanaryAbsent, graded, suppressed }) {
  const gradedEvidence = observeRedactionArm({ ...graded, canary });
  const suppressedEvidence = observeRedactionArm(suppressed);
  suppressedEvidence.nonVacuous = D1_REDACTION_STREAMS.every(
    (stream) => suppressedEvidence.streamBytesObserved[stream] > 0,
  );
  suppressedEvidence.redactedOnAllStreams = typeof suppressed?.canary === "string"
    && suppressed.canary.length > 0
    && D1_REDACTION_STREAMS.every((stream) => suppressedEvidence.canaryAbsentOnStream[stream] === true);
  const gradedSucceeded = gradedEvidence.attemptStatus === D1_REDACTION_REQUIRED_ATTEMPT_STATUS;
  const suppressedSucceeded = suppressedEvidence.attemptStatus === D1_REDACTION_REQUIRED_ATTEMPT_STATUS;
  const gradedObserved = D1_REDACTION_STREAMS.every((stream) => gradedEvidence.observedOnStream[stream] === true);
  const gradedMarked = D1_REDACTION_STREAMS.every(
    (stream) => gradedEvidence.scrubberMarkerObservedOnStream[stream] === true,
  );
  const ownStreamsClean = D1_REDACTION_STREAMS.every((stream) => gradedEvidence.canaryAbsentOnStream[stream] === true);
  const gradedClean = ownStreamsClean && crossTenantCanaryAbsent === true;
  const suppressedObserved = D1_REDACTION_STREAMS.every(
    (stream) => suppressedEvidence.observedOnStream[stream] === true,
  );
  const suppressedClean = D1_REDACTION_STREAMS.every(
    (stream) => suppressedEvidence.scrubberMarkerObservedOnStream[stream] === false,
  );
  const suppressedVerbatim = D1_REDACTION_STREAMS.every(
    (stream) => suppressedEvidence.verbatimCanaryObservedOnStream[stream] === true,
  );
  const injectionFired = gradedSucceeded && gradedObserved && gradedMarked;
  const positiveControlPassed = suppressedSucceeded && suppressedObserved && suppressedClean && suppressedVerbatim
    && suppressedEvidence.nonVacuous && suppressedEvidence.redactedOnAllStreams;

  return {
    row: {
      injectionFired,
      observedClassification: !gradedSucceeded
        ? `redaction_probe_attempt_${gradedEvidence.attemptStatus ?? "missing"}`
        : injectionFired && gradedClean
          ? "canary_scrubbed_while_unseeded_twin_leaks"
          : injectionFired
            ? "canary_leaked_on_a_stream"
            : "no_scrubber_marker_observed",
      attemptStatus: gradedEvidence.attemptStatus,
      crossTenantCanaryAbsent: crossTenantCanaryAbsent === true,
      redactedOnAllStreams: gradedClean,
      scrubberMarkerObservedOnStream: gradedEvidence.scrubberMarkerObservedOnStream,
      streamBytesObserved: gradedEvidence.streamBytesObserved,
      positiveControlPassed,
      suppressedArmEvidence: suppressedEvidence,
    },
    gradedEvidence,
    suppressedEvidence,
  };
}

export function serializeD1FaultMatrixRow(caseId, evidence) {
  const row = { case: caseId, injectionFired: evidence?.injectionFired === true, observedClassification: evidence?.observedClassification ?? null };
  for (const key of [
    "positiveControlPassed", "antiVacuityObservedForeignRow", "redactedOnAllStreams",
    "scrubberMarkerObservedOnStream", "streamBytesObserved", "suppressedArmEvidence",
    "attemptStatus", "crossTenantCanaryAbsent",
  ]) {
    if (evidence?.[key] !== undefined) row[key] = evidence[key];
  }
  return row;
}

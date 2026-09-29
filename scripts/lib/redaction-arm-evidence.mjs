export const REDACTION_STREAMS = Object.freeze(["events", "logs"]);
export const RUN_OUTPUT_PROBE_TAG = "AOA-RUN-OUTPUT-PROBE";
const REDACTION_MARKER = "\u00abredacted\u00bb";

function scopedLines(text, nonce) {
  if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]+$/.test(nonce)) return [];
  const token = ` arm=${nonce} `;
  return String(text ?? "")
    .split(/\r?\n/)
    .flatMap(probeTextLines)
    .filter((line) => line.includes(RUN_OUTPUT_PROBE_TAG) && line.includes(token));
}

function probeTextLines(line) {
  // Event queries prefix JSON with an event type; Compose prefixes pino JSON with a service.
  const start = line.indexOf("{");
  if (start < 0) return [line];
  let value;
  try { value = JSON.parse(line.slice(start)); } catch { return []; }
  const lines = [];
  const pending = [value];
  while (pending.length > 0) {
    const item = pending.pop();
    if (typeof item === "string") lines.push(...item.split(/\r?\n/));
    else if (item && typeof item === "object") pending.push(...Object.values(item));
  }
  return lines;
}

export function observeNonceScopedProbeLine(text, nonce) {
  return scopedLines(text, nonce).length > 0;
}

// Only facts leave this boundary; callers grade raw streams before retention scrubbing.
export function observeRedactionArm(arm) {
  const observedOnStream = {};
  const scrubberMarkerObservedOnStream = {};
  const streamBytesObserved = {};
  const canaryAbsentOnStream = {};
  const verbatimCanaryObservedOnStream = {};
  const control = typeof arm?.controlCanary === "string" && /^[A-Za-z0-9_-]+$/.test(arm.controlCanary)
    ? new RegExp(`(?:^|\\s)control=${arm.controlCanary}(?=$|\\s)`)
    : null;
  for (const stream of REDACTION_STREAMS) {
    const text = String(arm?.streams?.[stream] ?? "");
    const lines = scopedLines(text, arm?.nonce);
    observedOnStream[stream] = lines.length > 0;
    scrubberMarkerObservedOnStream[stream] = lines.some((line) => line.includes(REDACTION_MARKER));
    streamBytesObserved[stream] = Buffer.byteLength(lines.join("\n"), "utf8");
    canaryAbsentOnStream[stream] = !text.includes(arm?.canary ?? "\0");
    verbatimCanaryObservedOnStream[stream] = control !== null && lines.some((line) => control.test(line));
  }
  return {
    attemptStatus: arm?.attemptStatus ?? null,
    observedOnStream,
    scrubberMarkerObservedOnStream,
    streamBytesObserved,
    canaryAbsentOnStream,
    verbatimCanaryObservedOnStream,
  };
}

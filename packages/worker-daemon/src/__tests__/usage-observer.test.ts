import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { usagePayloadV1Schema } from "@armyofagents/worker-protocol";

import { createMetrics } from "../metrics/metrics.js";
import {
  RUN_USAGE_MISSING_METRIC,
  createUsageObserver,
  parseClaudeStreamJsonUsage,
} from "../supervisor/usage-observer.js";
import { makeHandoff } from "./support/supervisor-fixtures.js";
import { scrubOutputText } from "../supervisor/run-output.js";

// -----------------------------------------------------------------------------
// WRK-018 slice A — the daemon-local `claude_local` usage parser (E4-D13) and the
// `observeRun` it composes.
//
// The daemon cannot import `@armyofagents/adapters` (E4-D01), so the format is PORTED,
// not shared. The port is only honest if it agrees with the server parser
// (`parseClaudeStreamJson`, packages/adapters/claude-local/src/server/parse.ts) on a REAL
// transcript — so the first case reads the real captured `claude --output-format
// stream-json --verbose` transcript the server suite already pins
// (server/src/__tests__/fixtures/claude-stream-json-tool-call.jsonl, commit cdc078d56),
// by path, and asserts the same field map the server applies:
//   input_tokens -> inputTokens, output_tokens -> outputTokens,
//   cache_read_input_tokens -> cachedInputTokens.
// -----------------------------------------------------------------------------

const REAL_TRANSCRIPT = fileURLToPath(
  new URL("../../../../server/src/__tests__/fixtures/claude-stream-json-tool-call.jsonl", import.meta.url),
);

function resultLine(usage: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "done", ...(usage ? { usage } : {}), ...extra });
}

const EXEC = { providerOpId: "op-1", exitCode: 0, signal: null, timedOut: false, stdoutRef: "r:o", stderrRef: "r:e" };

describe("WRK-018 — parseClaudeStreamJsonUsage (daemon-local port, E4-D13)", () => {
  it("reads the REAL captured claude stream-json transcript with the server parser's field map", () => {
    const transcript = readFileSync(REAL_TRANSCRIPT, "utf8");
    // Pin the fixture itself so a silently-edited fixture cannot make this vacuous.
    expect(transcript).toContain('"type":"result"');
    expect(parseClaudeStreamJsonUsage(transcript)).toEqual({ inputTokens: 7, outputTokens: 352, cachedInputTokens: 61348 });
  });

  it("the LAST result line wins (server parity: finalResult is overwritten)", () => {
    const text = [
      resultLine({ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1 }),
      '{"type":"assistant","message":{"content":[]}}',
      resultLine({ input_tokens: 9, output_tokens: 8, cache_read_input_tokens: 7 }),
    ].join("\n");
    expect(parseClaudeStreamJsonUsage(text)).toEqual({ inputTokens: 9, outputTokens: 8, cachedInputTokens: 7 });
  });

  it("tolerates CRLF, blank lines and non-JSON noise around the result line", () => {
    const text = `noise\r\n\r\n{not json\r\n${resultLine({ input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 0 })}\r\n`;
    expect(parseClaudeStreamJsonUsage(text)).toEqual({ inputTokens: 3, outputTokens: 4, cachedInputTokens: 0 });
  });

  it("a missing usage FIELD falls back to 0 (server parity), but a missing usage OBJECT is no usage", () => {
    expect(parseClaudeStreamJsonUsage(resultLine({ input_tokens: 5 }))).toEqual({ inputTokens: 5, outputTokens: 0, cachedInputTokens: 0 });
    expect(parseClaudeStreamJsonUsage(resultLine(undefined))).toBeNull();
  });

  it("a PRESENT but non-numeric count (e.g. redacted to the marker, or a string) is NO usage, never a silent 0 (Codex P2, PR #546)", () => {
    expect(parseClaudeStreamJsonUsage(resultLine({ input_tokens: "«redacted»", output_tokens: 5 }))).toBeNull();
    expect(parseClaudeStreamJsonUsage(resultLine({ input_tokens: "12", output_tokens: 5 }))).toBeNull();
    expect(parseClaudeStreamJsonUsage(resultLine({ input_tokens: null, output_tokens: 5 }))).toBeNull();
  });

  it("a FINAL result line the scrubber made unparseable voids usage; an EARLIER result line never stands in for it", () => {
    const earlier = resultLine({ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1 });
    // A numeric canary "4" redacted inside a bare count: no longer valid JSON.
    const corrupted = '{"type":"result","usage":{"input_tokens":«redacted»2,"output_tokens":9}}';
    expect(parseClaudeStreamJsonUsage(`${earlier}\n${corrupted}\n`)).toBeNull();
    // ...while a valid result line AFTER a corrupted one still wins (last valid line = final).
    expect(parseClaudeStreamJsonUsage(`${corrupted}\n${earlier}\n`)).toEqual({ inputTokens: 1, outputTokens: 1, cachedInputTokens: 1 });
  });

  it("STRUCTURAL redaction of the final line is no usage - never a stale earlier result (Codex P1, PR #546)", () => {
    const earlier = resultLine({ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1 });
    // A canary overlapping "result" turns the final line into valid JSON with another type.
    const typeRedacted = JSON.stringify({ type: "«redacted»", usage: { input_tokens: 9, output_tokens: 9 } });
    expect(parseClaudeStreamJsonUsage(`${earlier}\n${typeRedacted}\n`)).toBeNull();
    // A canary overlapping a usage KEY would read as a missing field (0): refused instead.
    const keyRedacted = JSON.stringify({ type: "result", usage: { "«redacted»": 9, output_tokens: 9 } });
    expect(parseClaudeStreamJsonUsage(keyRedacted)).toBeNull();
    // Free text in the result's own string VALUES may be redacted without losing usage.
    const textRedacted = JSON.stringify({ type: "result", result: "key «redacted»", usage: { input_tokens: 3, output_tokens: 4 } });
    expect(parseClaudeStreamJsonUsage(textRedacted)).toEqual({ inputTokens: 3, outputTokens: 4, cachedInputTokens: 0 });
  });

  it("usage is read ONLY from the final non-empty line: a result line followed by other output is no usage", () => {
    const line = resultLine({ input_tokens: 5, output_tokens: 6 });
    expect(parseClaudeStreamJsonUsage(`${line}\n{"type":"assistant"}\n`)).toBeNull();
    expect(parseClaudeStreamJsonUsage(`${line}\n\n  \n`)).toEqual({ inputTokens: 5, outputTokens: 6, cachedInputTokens: 0 });
  });

  it("no result line, empty output, or a non-integer/negative count is NO usage (never an invalid event)", () => {
    expect(parseClaudeStreamJsonUsage("")).toBeNull();
    expect(parseClaudeStreamJsonUsage('{"type":"assistant"}\n{"type":"system","subtype":"init"}')).toBeNull();
    expect(parseClaudeStreamJsonUsage(resultLine({ input_tokens: 1.5, output_tokens: 1 }))).toBeNull();
    expect(parseClaudeStreamJsonUsage(resultLine({ input_tokens: -1, output_tokens: 1 }))).toBeNull();
  });
});

describe("WRK-018 — createUsageObserver (the composed observeRun)", () => {
  it("emits only a bounded whitelisted failure result summary through the existing log pipeline", async () => {
    const obs = await createUsageObserver()({ handoff: makeHandoff(), exec: { ...EXEC, exitCode: 1 },
      output: { stdoutTail: resultLine(undefined, { subtype: "error_during_execution", is_error: true,
        api_error_status: 400, terminal_reason: "api_error", result: "API Error: invalid tool schema", errors: ["request rejected"],
        session_id: "private-session", transcript: "private conversation" }), runtimeMillis: 8, scrubText: (text) => scrubOutputText(text, []) } });
    expect(obs.logs).toHaveLength(1);
    expect(obs.logs![0]).toMatchObject({ stream: "stdout", level: "error" });
    expect(JSON.parse(obs.logs![0].message)).toMatchObject({ type: "aoa_cli_failure", exitCode: 1,
      resultAvailable: true, summary: { is_error: true, api_error_status: 400,
        result: "API Error: invalid tool schema", errors: ["request rejected"] }, truncated: false });
    expect(obs.logs![0].message).not.toContain("private-session");
    expect(obs.logs![0].message).not.toContain("private conversation");
    expect(obs.usage).toBeNull();
  });

  it("omits oversized failure fields explicitly instead of retaining a full result or transcript", async () => {
    const obs = await createUsageObserver()({ handoff: makeHandoff(), exec: { ...EXEC, exitCode: 1 },
      output: { stdoutTail: resultLine(undefined, { is_error: true, result: "π".repeat(20_000) }), runtimeMillis: 8, scrubText: (text) => scrubOutputText(text, []) } });
    const diagnostic = JSON.parse(obs.logs![0].message);
    expect(diagnostic.truncated).toBe(true);
    expect(diagnostic.omittedFields).toContain("result");
    expect(diagnostic.summary.result).toBeUndefined();
    expect(Buffer.byteLength(obs.logs![0].message)).toBeLessThanOrEqual(4096);
  });

  it("reports unavailable failure result without falling back to arbitrary stdout text", async () => {
    const obs = await createUsageObserver()({ handoff: makeHandoff(), exec: { ...EXEC, exitCode: 1 },
      output: { stdoutTail: "private raw output\nnot-json", runtimeMillis: 8 } });
    expect(JSON.parse(obs.logs![0].message)).toMatchObject({ exitCode: 1, resultAvailable: false, summary: {} });
    expect(obs.logs![0].message).not.toContain("private raw output");
  });

  it("fails closed for decoded free text if the run scrubber is absent or throws", async () => {
    for (const scrubText of [undefined, () => { throw new Error("private scrub error"); }]) {
      const obs = await createUsageObserver()({ handoff: makeHandoff(), exec: { ...EXEC, exitCode: 1 },
        output: { stdoutTail: resultLine(undefined, { is_error: true, api_error_status: 401, result: "private error text" }), runtimeMillis: 8, scrubText } });
      const result = JSON.parse(obs.logs![0].message);
      expect(result.summary).toMatchObject({ is_error: true, api_error_status: 401 });
      expect(result.summary.result).toBeUndefined();
      expect(result.omittedFields).toContain("result");
      expect(obs.logs![0].message).not.toContain("private error text");
    }
  });

  it("does not publish a successful model answer when the process later exits nonzero", async () => {
    const obs = await createUsageObserver()({ handoff: makeHandoff(), exec: { ...EXEC, exitCode: 1 },
      output: { stdoutTail: resultLine(undefined, { result: "ordinary private model answer" }), runtimeMillis: 8,
        scrubText: (text) => scrubOutputText(text, []) } });
    expect(JSON.parse(obs.logs![0].message).summary.is_error).toBe(false);
    expect(obs.logs![0].message).not.toContain("ordinary private model answer");
  });

  it("builds a schema-valid UsagePayloadV1 with runtimeMillis from the SUPERVISOR's clock", async () => {
    const observe = createUsageObserver();
    const obs = await observe({
      handoff: makeHandoff(),
      exec: EXEC,
      output: { stdoutTail: resultLine({ input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30 }), runtimeMillis: 1234 },
    });
    expect(obs.usage).toEqual({ inputTokens: 10, outputTokens: 20, cachedInputTokens: 30, runtimeMillis: 1234 });
    expect(usagePayloadV1Schema.parse(obs.usage)).toEqual(obs.usage);
    expect(obs.logs).toBeUndefined(); // usage only: stdout is NEVER re-emitted as log events
  });

  it("no parseable usage -> usage null, NO throw, and the missing-usage counter increments", async () => {
    const metrics = createMetrics();
    const observe = createUsageObserver({ metrics });
    const noOutput = await observe({ handoff: makeHandoff(), exec: EXEC });
    const noResult = await observe({ handoff: makeHandoff(), exec: EXEC, output: { stdoutTail: "hello\n", runtimeMillis: 5 } });
    expect(noOutput.usage).toBeNull();
    expect(noResult.usage).toBeNull();
    expect(metrics.renderPrometheus()).toContain(`${RUN_USAGE_MISSING_METRIC} 2`);
  });
});

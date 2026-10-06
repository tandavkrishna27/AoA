import { REDACTION_MARKER } from "../supervisor/redaction.js";
import { describe, expect, it, vi } from "vitest";
import { createCommanderLiveOutput, COMMANDER_STREAM_LOG_PREFIX } from "../supervisor/commander-live-output.js";
describe("Commander live output", () => {
  it("emits complete lines before close, redacting a secret split across chunks", async () => {
    const emit = vi.fn(async (_message: string) => undefined);
    const stream = createCommanderLiveOutput({ canaries: ["secret-bearer"], emit });
    stream.onStdout('{"delta":"secret-'); expect(emit).not.toHaveBeenCalled();
    stream.onStdout('bearer"}\n');
    expect(emit).toHaveBeenCalledWith(COMMANDER_STREAM_LOG_PREFIX + `{ "delta": "${REDACTION_MARKER}" }`.replaceAll(" ", "") + "\n");
    await stream.close();
  });
  it("drops late chunks after close", async () => {
    const emit = vi.fn(async (_message: string) => undefined); const stream = createCommanderLiveOutput({ canaries: [], emit });
    await stream.close(); stream.onStdout("late\n"); expect(emit).not.toHaveBeenCalled();
  });
  it("bounds line size and event count while leaving accepted artifact capture independent", async () => {
    const emit = vi.fn(async (_message: string) => undefined); const stream = createCommanderLiveOutput({ canaries: [], emit, maxEvents: 2 });
    stream.onStdout("first\nsecond\nthird\n"); await stream.close();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.map((call) => call[0])).toEqual([COMMANDER_STREAM_LOG_PREFIX + "first\n", COMMANDER_STREAM_LOG_PREFIX + "second\n"]);
  });
  it("stops the live prefix at an oversized line instead of delivering later text out of order", async () => {
    const emit = vi.fn(async (_message: string) => undefined); const stream = createCommanderLiveOutput({ canaries: [], emit });
    stream.onStdout("first\n" + "x".repeat(70000) + "\nlater\n"); await stream.close();
    expect(emit.mock.calls.map((call) => call[0])).toEqual([COMMANDER_STREAM_LOG_PREFIX + "first\n"]);
  });
  it("scrubs multiline credential segments and tolerates a rejected log sink", async () => {
    const emit = vi.fn(async (_message: string) => { throw new Error("sink unavailable"); });
    const stream = createCommanderLiveOutput({ canaries: ["first-secret\nsecond-secret"], emit });
    stream.onStdout("first-secret\nsecond-secret\n"); await expect(stream.close()).resolves.toBeUndefined();
    expect(JSON.stringify(emit.mock.calls)).not.toContain("first-secret");
    expect(JSON.stringify(emit.mock.calls)).not.toContain("second-secret");
  });
});

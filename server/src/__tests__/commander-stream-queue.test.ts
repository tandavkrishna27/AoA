import { describe, expect, it } from "vitest";
import { createCommanderStreamQueue, removeDeliveredCommanderChunks } from "../services/commander-stream-queue.js";
describe("Commander chat live queue", () => {
  it("yields a live chunk before the accepted result resolves", async () => {
    let resolve!: (value: string) => void;
    const queue = createCommanderStreamQueue(async (emit) => { emit({ type: "text", delta: "early" });
      return new Promise<string>((done) => { resolve = done; }); });
    const stream = queue.chunks(); expect(await stream.next()).toMatchObject({ value: { type: "text", delta: "early" }, done: false });
    resolve("accepted"); expect(await stream.next()).toMatchObject({ done: true }); expect(await queue.result).toBe("accepted");
  });
  it("does not repeat live text and tools while preserving missing final chunks and terminal", () => {
    const early = { type: "text" as const, delta: "early" };
    const last = { type: "text" as const, delta: "last" };
    const done = { type: "done" as const, summary: { runId: "paid", toolsCalled: [], durationMs: 1, costCents: 0, tokenUsage: { inputTokens: 1, outputTokens: 1 } } };
    expect(removeDeliveredCommanderChunks([early, early, last, done], [early])).toEqual([early, last, done]);
  });
  it("refuses a non-prefix stream rather than appending accepted text out of order", () => {
    expect(() => removeDeliveredCommanderChunks([{ type: "text", delta: "first" }, { type: "text", delta: "later" }],
      [{ type: "text", delta: "later" }])).toThrow("differs from accepted");
  });
  it("keeps the owned result running after the HTTP iterator disconnects", async () => {
    let emit!: (chunk: { type: "text"; delta: string }) => void; let finish!: (value: string) => void;
    const queue = createCommanderStreamQueue(async (send) => { emit = send; send({ type: "text", delta: "first" });
      return new Promise<string>((resolve) => { finish = resolve; }); });
    const reader = queue.chunks(); await reader.next(); await reader.return();
    emit({ type: "text", delta: "after disconnect" }); finish("persisted original turn");
    expect(await queue.result).toBe("persisted original turn");
  });
  it("stops live delivery at the queue bound without resuming out of order", async () => {
    let emit!: (chunk: { type: "text"; delta: string }) => void; let finish!: (value: string) => void;
    const queue = createCommanderStreamQueue(async (send) => { emit = send;
      for (let i = 0; i < 1025; i += 1) send({ type: "text", delta: String(i) });
      return new Promise<string>((resolve) => { finish = resolve; }); });
    const reader = queue.chunks(); await reader.next(); emit({ type: "text", delta: "late" }); finish("accepted");
    const rest = []; for await (const chunk of reader) rest.push(chunk);
    expect(rest).toHaveLength(1023); expect(rest.some((chunk) => chunk.type === "text" && chunk.delta === "late")).toBe(false);
  });
  it("surfaces an accepted-result failure after partial text", async () => {
    const queue = createCommanderStreamQueue(async (emit) => { emit({ type: "text", delta: "partial" }); throw new Error("result rejected"); });
    const stream = queue.chunks(); expect((await stream.next()).value).toMatchObject({ delta: "partial" });
    expect((await stream.next()).done).toBe(true); await expect(queue.result).rejects.toThrow("result rejected");
  });
});

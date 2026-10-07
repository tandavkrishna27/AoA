import { describe, expect, it } from "vitest";
import { createBrowserOutput } from "../supervisor/browser-output.js";

describe("bounded browser guest output", () => {
  it("assembles split JSON lines and preserves intent order", async () => {
    const seen: unknown[] = []; const output = createBrowserOutput({ receive: async (message) => { seen.push(message); } });
    output.onStdout('{"type":"approval_'); output.onStdout('requested"}\n{"type":"session_completed"}\n');
    expect(await output.close()).toBe(true);
    expect(seen).toEqual([{ type: "approval_requested" }, { type: "session_completed" }]);
    output.onStdout('{}\n'); expect(seen).toHaveLength(2);
  });
  it.each(["x\n", "x".repeat(16385), '{}\n'.repeat(129)])("fails closed on malformed or excessive output", async (chunk) => {
    const output = createBrowserOutput({ receive: async () => {} }); output.onStdout(chunk);
    expect(await output.close()).toBe(false);
  });
  it("propagates a refused approval as failed output without an unhandled rejection", async () => {
    const output = createBrowserOutput({ receive: async () => { throw new Error("closed fence"); } });
    output.onStdout('{}\n'); expect(await output.close()).toBe(false);
  });
});

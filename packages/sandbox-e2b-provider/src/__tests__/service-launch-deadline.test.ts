import { describe, expect, it, vi } from "vitest";
import { E2bSandboxProvider } from "../e2b-provider.js";
import { RealE2bTransport } from "../real-transport.js";

describe("service launch acknowledgement versus runtime", () => {
  it("coalesces retries while a timed-out launch awaits its acknowledgement", async () => {
    let acknowledge!: () => void;
    const gate = new Promise<void>((resolve) => { acknowledge = resolve; });
    const run = vi.fn(async () => { await gate; return { pid: 42 }; });
    const provider = new E2bSandboxProvider({ transport: new RealE2bTransport({ apiKey: "test-key-not-a-credential", sdk: { connect: async () => ({ commands: { run } }) } }) });
    const input = { sandboxId: "owned", command: "node", args: ["serve"], env: {} };
    try {
      await expect(provider.startProcess(input, { deadlineMs: 5, idempotencyKey: "retry" })).rejects.toThrow("timed out");
      const retry = provider.startProcess(input, { deadlineMs: 5000, idempotencyKey: "retry" });
      expect(run).toHaveBeenCalledTimes(1);
      acknowledge();
      const result = await retry;
      expect(await provider.startProcess(input, { deadlineMs: 5000, idempotencyKey: "retry" })).toEqual(result);
      expect(run).toHaveBeenCalledTimes(1);
    } finally { acknowledge(); }
  });
  it("keeps the request bound out of the background command runtime timeout", async () => {
    const run = vi.fn(async () => ({ pid: 42 }));
    const transport = new RealE2bTransport({ apiKey: "test-key-not-a-credential", sdk: {
      connect: async () => ({ commands: { run } }),
    } });
    const provider = new E2bSandboxProvider({ transport });
    expect(await provider.startProcess({ sandboxId: "owned", command: "node", args: ["serve"], env: {} }, { deadlineMs: 5000, idempotencyKey: "service-launch" })).toMatchObject({ handle: "42" });
    expect(run).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ background: true, timeoutMs: 0 }));
  });
  it("refuses an exhausted launch deadline before contacting the SDK", async () => {
    const connect = vi.fn(async () => ({ commands: { run: async () => ({ pid: 42 }) } }));
    const provider = new E2bSandboxProvider({ transport: new RealE2bTransport({ apiKey: "test-key-not-a-credential", sdk: { connect } }) });
    await expect(provider.startProcess({ sandboxId: "owned", command: "node", args: [], env: {} }, { deadlineMs: 0, idempotencyKey: "expired" })).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });
});

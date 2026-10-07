import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { E2bSandboxProvider } from "../e2b-provider.js";
import { MockE2bTransport } from "../mock-transport.js";
import { WRITE_BROWSER_DECISION } from "../browser-decision-script.js";

const response = () => ({ requestId: "77777777-7777-4777-8777-777777777777", decision: "allow_once" as const,
  expiresAt: new Date(Date.now() + 30_000).toISOString() });
const ctx = { deadlineMs: 1000, idempotencyKey: "decision" };
describe("fixed E2B browser decision writer", () => {
  it("runs only the fixed private atomic writer and returns acknowledgement metadata", async () => {
    const transport = new MockE2bTransport();
    const run = vi.spyOn(transport, "runCommand").mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, crashed: false });
    const provider = new E2bSandboxProvider({ transport }); const input = { sandboxId: "owned", response: response() };
    expect(await provider.deliverBrowserDecision(input, ctx)).toEqual({ providerOpId: expect.any(String), delivered: true });
    const [command] = run.mock.calls[0]!;
    expect(command).toMatchObject({ sandboxId: "owned", command: "node", envVars: {}, timeoutMs: 1000 });
    expect(command.args).toHaveLength(3); expect(command.args[0]).toBe("-e"); expect(command.args[2]).toBe(JSON.stringify(input.response));
    expect(command.args[1]).toBe(WRITE_BROWSER_DECISION);
    run.mockResolvedValueOnce({ exitCode: 1, signal: null, timedOut: false, crashed: false });
    await expect(provider.deliverBrowserDecision(input, ctx)).rejects.toThrow("write failed");
  });
  it.each([0o700, 0o755])("the guest writer publishes atomically only inside a private directory (mode %s)", async (mode) => {
    const root = "/home/user/.aoa/browser-approvals"; const metadata = response();
    let exitCode = 0; const steps: string[] = []; let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const fs = {
      lstat: async () => ({ mode, isDirectory: () => true, isSymbolicLink: () => false }), realpath: async () => root,
      open: vi.fn(async (path: string, flags: string, permissions: number) => {
        expect(path).toBe(`${root}/.fixed.tmp`); expect(flags).toBe("wx"); expect(permissions).toBe(0o600);
        return { writeFile: async (body: string) => { expect(JSON.parse(body)).toEqual(metadata); steps.push("write"); }, close: async () => { steps.push("close"); } };
      }),
      rename: vi.fn(async (from: string, to: string) => {
        expect(from).toBe(`${root}/.fixed.tmp`); expect(to).toBe(`${root}/${metadata.requestId}.json`); steps.push("rename");
      }), unlink: async () => { finish(); },
    };
    const guestProcess = { argv: ["node", JSON.stringify(metadata)], set exitCode(value: number) { exitCode = value; finish(); } };
    runInNewContext(WRITE_BROWSER_DECISION, { require: (name: string) => name === "node:fs/promises" ? fs : { randomUUID: () => "fixed" }, process: guestProcess, Date });
    await done;
    if (mode === 0o700) { expect(exitCode).toBe(0); expect(steps).toEqual(["write", "close", "rename"]); }
    else { expect(exitCode).toBe(1); expect(fs.open).not.toHaveBeenCalled(); expect(fs.rename).not.toHaveBeenCalled(); }
  });
  it("refuses malformed, expired and exhausted requests before transport calls", async () => {
    const transport = new MockE2bTransport(); const run = vi.spyOn(transport, "runCommand");
    const provider = new E2bSandboxProvider({ transport }); const input = { sandboxId: "owned", response: response() };
    await expect(provider.deliverBrowserDecision(input, { ...ctx, deadlineMs: 0 })).rejects.toThrow();
    await expect(provider.deliverBrowserDecision({ ...input, response: { ...input.response, requestId: "../escape" } }, ctx)).rejects.toThrow();
    await expect(provider.deliverBrowserDecision({ ...input, response: { ...input.response, expiresAt: new Date(0).toISOString() } }, ctx)).rejects.toThrow();
    await expect(provider.deliverBrowserDecision({ ...input, response: { ...input.response, command: "arbitrary" } } as any, ctx)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it("bounds a stuck writer acknowledgement", async () => {
    const transport = new MockE2bTransport(); const run = vi.spyOn(transport, "runCommand").mockImplementation(() => new Promise(() => {}));
    const provider = new E2bSandboxProvider({ transport });
    await expect(provider.deliverBrowserDecision({ sandboxId: "owned", response: response() }, { ...ctx, deadlineMs: 5 })).rejects.toThrow("timed out");
    expect(run).toHaveBeenCalledTimes(1);
  });
});

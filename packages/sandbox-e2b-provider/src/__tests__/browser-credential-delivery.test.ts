import { runInNewContext } from "node:vm";
import { WRITE_BROWSER_CREDENTIAL } from "../browser-credential-script.js";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { E2bSandboxProvider } from "../e2b-provider.js";
import { MockE2bTransport } from "../mock-transport.js";
import type { ExportScanInput } from "../export-secret-scan.js";

const requestId = "77777777-7777-4777-8777-777777777777";
const artifactId = "88888888-8888-4888-8888-888888888888";
const labels = { organizationId: "org", targetId: "target", workerId: "worker", jobId: "job", attempt: 1, leaseId: "lease", deviceGeneration: 1 };
const ctx = { deadlineMs: 1000, idempotencyKey: "credentials" };
async function setup(scanExportBytes?: (input: ExportScanInput) => void) {
  const payload = { requestId, bindingId: artifactId, policyDigest: "b".repeat(64), origin: "https://example.com",
    expiresAt: new Date(Date.now() + 60_000).toISOString(), cookie: { name: "__Host-session", value: "scoped-cookie-canary-123456" } };
  const bytes = Buffer.from(JSON.stringify(payload));
  const grant = { protocolVersion: 1 as const, operation: "download" as const, method: "GET" as const, artifactId,
    url: `https://control.example/api/worker-control/browser-session-credentials/${artifactId}?grant=signed-token`, headers: {},
    issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30_000).toISOString(), maxBytes: bytes.length,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"), objectKey: "organizations/org/jobs/job/attempts/1/browser-session/request", redaction: "secret" as const };
  const fetcher = vi.fn(async () => new Response(bytes)); const transport = new MockE2bTransport();
  const writer = vi.spyOn(transport, "runCommand").mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, crashed: false });
  const provider = new E2bSandboxProvider({ transport, browserCredentialControlPlaneOrigin: "https://control.example", browserCredentialFetch: fetcher as typeof fetch, scanExportBytes });
  const created = await provider.create({ resourceLabels: labels, command: "node", args: [], env: { SECRET: "existing-canary" }, workloadType: "browser_session" }, ctx);
  return { provider, fetcher, writer, grant, bytes, payload, input: { sandboxId: created.sandboxId, requestId, grant }, transport };
}
describe("provider-only native browser credential redemption", () => {
  it("fetches from the independently pinned native endpoint and returns no cookie bytes", async () => {
    const test = await setup();
    try {
      expect(await test.provider.deliverBrowserCredential(test.input, ctx)).toEqual({ providerOpId: expect.any(String), delivered: true });
      expect(test.fetcher).toHaveBeenCalledWith(test.grant.url, expect.objectContaining({ method: "GET", redirect: "error", signal: expect.any(AbortSignal) }));
      const [command] = test.writer.mock.calls[0]!;
      expect(command.command).toBe("node"); expect(command.args[0]).toBe("-e");
      const metadata = JSON.parse(command.args[2]!); expect(metadata.requestId).toBe(requestId);
      expect(Buffer.from(metadata.bytes, "base64")).toEqual(test.bytes);
    } finally { await test.provider.destroy(test.input.sandboxId, ctx); }
  });
  it.each(["origin", "endpoint", "redirect", "size", "hash", "request", "expired", "budget"])("refuses %s before publishing", async (fault) => {
    const test = await setup();
    try {
      let input = test.input;
      if (fault === "origin") input = { ...input, grant: { ...input.grant, url: input.grant.url.replace("control.example", "other.example") } };
      if (fault === "endpoint") input = { ...input, grant: { ...input.grant, url: input.grant.url.replace("browser-session-credentials", "other-endpoint") } };
      if (fault === "redirect") test.fetcher.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://other.example" } }));
      if (fault === "size") test.fetcher.mockResolvedValueOnce(new Response(Buffer.alloc(8193)));
      if (fault === "hash") input = { ...input, grant: { ...input.grant, expectedSha256: "0".repeat(64) } };
      if (fault === "request") input = { ...input, requestId: artifactId };
      if (fault === "expired") input = { ...input, grant: { ...input.grant, expiresAt: new Date(0).toISOString() } };
      await expect(test.provider.deliverBrowserCredential(input, fault === "budget" ? { ...ctx, deadlineMs: 0 } : ctx)).rejects.toThrow();
      expect(test.writer).not.toHaveBeenCalled();
      if (["origin", "endpoint", "expired", "budget"].includes(fault)) expect(test.fetcher).not.toHaveBeenCalled();
    } finally { await test.provider.destroy(test.input.sandboxId, ctx); }
  });
  it("retains cookie and existing values in only the sandbox scanner without extending its TTL", async () => {
    vi.useFakeTimers();
    const scan = vi.fn((input: ExportScanInput) => { expect(input.secrets).toContain("existing-canary"); expect(input.secrets).toContain("scoped-cookie-canary-123456"); throw new Error("credential export refused"); });
    const test = await setup(scan);
    try {
      await test.provider.deliverBrowserCredential(test.input, ctx);
      const path = "/home/user/aoa-output/credential.txt"; test.transport.plantFile(test.input.sandboxId, path, Buffer.from(test.payload.cookie.value));
      await expect(test.provider.exportArtifact(test.input.sandboxId, path, { ...test.grant, operation: "upload", method: "PUT", maxBytes: test.payload.cookie.value.length,
        expectedSha256: createHash("sha256").update(test.payload.cookie.value).digest("hex") }, ctx)).rejects.toThrow();
      expect(scan).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1001); expect(test.provider.registeredSecretSetCount()).toBe(0);
    } finally { await test.provider.destroy(test.input.sandboxId, ctx); vi.useRealTimers(); }
  });
  it("refuses missing independently configured authority and masks upstream errors", async () => {
    const test = await setup();
    try {
      const unavailable = new E2bSandboxProvider({ transport: test.transport, browserCredentialFetch: test.fetcher as typeof fetch });
      await expect(unavailable.deliverBrowserCredential(test.input, ctx)).rejects.toThrow("delivery refused"); expect(test.fetcher).not.toHaveBeenCalled();
      test.fetcher.mockRejectedValueOnce(new Error(`${test.grant.url} ${test.payload.cookie.value}`));
      await expect(test.provider.deliverBrowserCredential(test.input, ctx)).rejects.toThrow(/^browser credential delivery refused$/);
      expect(test.writer).not.toHaveBeenCalled();
    } finally { await test.provider.destroy(test.input.sandboxId, ctx); }
  });
  it("bounds a stuck fetch and never publishes a late response", async () => {
    const test = await setup(); let release!: (response: Response) => void;
    test.fetcher.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    try {
      await expect(test.provider.deliverBrowserCredential(test.input, { ...ctx, deadlineMs: 5 })).rejects.toThrow("delivery refused");
      release(new Response(test.bytes)); await new Promise((resolve) => setTimeout(resolve, 10)); expect(test.writer).not.toHaveBeenCalled();
    } finally { release?.(new Response(test.bytes)); await test.provider.destroy(test.input.sandboxId, ctx); }
  });
});


it.each([0o700, 0o755])("publishes the credential atomically only in a private mailbox (mode %s)", async (mode) => {
  const root = "/home/user/.aoa/browser-session-credentials";
  const expiresAt = new Date(Date.now() + 30_000).toISOString();
  const bytes = Buffer.from(JSON.stringify({ requestId, expiresAt, cookie: { value: "secret" } }));
  let exitCode = 0; let finish!: () => void; const steps: string[] = [];
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const fs = {
    lstat: async () => ({ mode, isDirectory: () => true, isSymbolicLink: () => false }), realpath: async () => root,
    open: vi.fn(async (path: string, flags: string, permissions: number) => {
      expect(path).toBe(`${root}/.fixed.tmp`); expect(flags).toBe("wx"); expect(permissions).toBe(0o600);
      return { writeFile: async (body: Buffer) => { expect(body.equals(bytes)).toBe(true); steps.push("write"); }, close: async () => { steps.push("close"); } };
    }),
    rename: vi.fn(async (from: string, to: string) => {
      expect(from).toBe(`${root}/.fixed.tmp`); expect(to).toBe(`${root}/${requestId}.json`); steps.push("rename");
    }), unlink: async () => { finish(); },
  };
  const guestProcess = { argv: ["node", JSON.stringify({ requestId, expiresAt, bytes: bytes.toString("base64") })], set exitCode(value: number) { exitCode = value; finish(); } };
  runInNewContext(WRITE_BROWSER_CREDENTIAL, { require: (name: string) => name === "node:fs/promises" ? fs : { randomUUID: () => "fixed" }, process: guestProcess, Date, Buffer });
  await done;
  if (mode === 0o700) { expect(exitCode).toBe(0); expect(steps).toEqual(["write", "close", "rename"]); }
  else { expect(exitCode).toBe(1); expect(fs.open).not.toHaveBeenCalled(); expect(fs.rename).not.toHaveBeenCalled(); }
});

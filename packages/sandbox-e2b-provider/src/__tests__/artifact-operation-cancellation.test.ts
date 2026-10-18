import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ArtifactUploadGrantV1 } from "@armyofagents/worker-protocol";
import type { ProviderOpContext } from "@armyofagents/worker-daemon";
import { E2bSandboxProvider } from "../e2b-provider.js";
import { MockE2bTransport } from "../mock-transport.js";

const OUTPUT_PATH = "/home/user/aoa-output/result.txt";
const OUTPUT_BYTES = new TextEncoder().encode("generated output ✓\n");
const CONTEXT: ProviderOpContext = { deadlineMs: 5_000, idempotencyKey: "artifact-cancellation" };
const GRANT: ArtifactUploadGrantV1 = {
  protocolVersion: 1,
  operation: "upload",
  artifactId: "00000000-0000-4000-8000-000000000001" as ArtifactUploadGrantV1["artifactId"],
  method: "PUT",
  url: "https://store.example/result",
  headers: {},
  issuedAt: "2026-10-18T00:00:00.000Z",
  expiresAt: "2026-10-18T00:05:00.000Z",
  maxBytes: OUTPUT_BYTES.byteLength,
  expectedSha256: createHash("sha256").update(OUTPUT_BYTES).digest("hex"),
  objectKey: "result",
  redaction: "secret",
};

type Stage = "enumerate" | "digest-stat" | "digest" | "export-stat" | "export-read" | "export-scan" | "export-upload";

async function fixture(stage?: Stage) {
  const transport = new MockE2bTransport();
  const calls = { list: 0, read: 0, scan: 0, upload: 0 };
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  let activeSignal: AbortSignal | undefined;
  const stall = async (signal?: AbortSignal) => {
    activeSignal = signal;
    entered();
    await released;
  };
  const instrumented = new Proxy(transport, {
    get(target, property) {
      if (property === "statEntry") return async (sandboxId: string, path: string, options?: { signal?: AbortSignal }) => {
        if (stage === "digest-stat" || stage === "export-stat") await stall(options?.signal);
        return target.statEntry(sandboxId, path);
      };
      if (property === "listDir") return async (sandboxId: string, root: string, options?: { signal?: AbortSignal }) => {
        calls.list += 1;
        if (stage === "enumerate") await stall(options?.signal);
        return target.listDir(sandboxId, root);
      };
      if (property === "readFile") return async (sandboxId: string, path: string, options?: { maxBytes?: number; signal?: AbortSignal }) => {
        calls.read += 1;
        if (stage === "digest" || stage === "export-read") await stall(options?.signal);
        return target.readFile(sandboxId, path, options);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const provider = new E2bSandboxProvider({
    transport: instrumented,
    scanExportBytes: async ({ signal }) => {
      calls.scan += 1;
      if (stage === "export-scan") await stall(signal);
    },
    performUploadGrant: async (_grant, bytes, signal) => {
      calls.upload += 1;
      expect(bytes).toEqual(OUTPUT_BYTES);
      if (stage === "export-upload") await stall(signal);
    },
  });
  const { sandboxId } = await provider.create({
    resourceLabels: { organizationId: "org", targetId: "target", workerId: "worker", jobId: "job", attempt: 1, leaseId: "lease", deviceGeneration: 1 },
    command: "node",
    args: [],
    env: {},
    workloadType: "batch",
  }, CONTEXT);
  transport.plantFile(sandboxId, OUTPUT_PATH, OUTPUT_BYTES);
  const run = (context: ProviderOpContext, operation = stage ?? "export-upload") => operation === "enumerate"
    ? provider.enumerateOutputs(sandboxId, "/home/user/aoa-output", context)
    : operation === "digest" || operation === "digest-stat"
      ? provider.digestArtifact(sandboxId, OUTPUT_PATH, context)
      : provider.exportArtifact(sandboxId, OUTPUT_PATH, GRANT, context);
  return { run, calls, started, release, signal: () => activeSignal };
}

describe("artifact operations respect the caller's operation lifetime", () => {
  it.each<Stage>(["enumerate", "digest-stat", "digest", "export-stat", "export-read", "export-scan", "export-upload"])(
    "aborts stalled %s work and prevents later export stages",
    async (stage) => {
      const test = await fixture(stage);
      const controller = new AbortController();
      const outcome = test.run({ ...CONTEXT, signal: controller.signal }).then(
        () => "completed",
        () => "rejected",
      );
      await test.started;
      controller.abort();
      test.release();
      expect(await outcome).toBe("rejected");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(test.signal()?.aborted).toBe(true);
      if (stage === "digest-stat" || stage === "export-stat") expect(test.calls.read).toBe(0);
      if (stage === "export-read") expect(test.calls.scan).toBe(0);
      if (stage === "export-read" || stage === "export-scan") expect(test.calls.upload).toBe(0);
    },
  );

  it.each(["enumerate", "digest", "export-upload"] as const)("refuses pre-aborted %s before provider effects", async (operation) => {
    const test = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(test.run({ ...CONTEXT, signal: controller.signal }, operation)).rejects.toThrow();
    expect(test.calls).toEqual({ list: 0, read: 0, scan: 0, upload: 0 });
  });

  it.each<Stage>(["enumerate", "digest", "export-read", "export-scan", "export-upload"])(
    "keeps the deadline for stalled %s with an active caller signal",
    async (stage) => {
      const test = await fixture(stage);
      const outcome = test.run({ ...CONTEXT, deadlineMs: 25, signal: new AbortController().signal }).then(
        () => "completed",
        () => "rejected",
      );
      await test.started;
      try {
        expect(await outcome).toBe("rejected");
        expect(test.signal()?.aborted).toBe(true);
        if (stage === "export-read") expect(test.calls.scan).toBe(0);
        if (stage === "export-read" || stage === "export-scan") expect(test.calls.upload).toBe(0);
      } finally {
        test.release();
      }
    },
  );

  it("exports exact bytes with an active caller signal", async () => {
    const test = await fixture();
    await expect(test.run({ ...CONTEXT, signal: new AbortController().signal })).resolves.toEqual({ objectKey: GRANT.objectKey });
    expect(test.calls).toEqual({ list: 0, read: 1, scan: 1, upload: 1 });
  });
});

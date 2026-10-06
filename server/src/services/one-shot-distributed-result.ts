import { createHash } from "node:crypto";
import type { StorageProvider } from "../storage/types.js";
import { ONE_SHOT_RESULT_PATH } from "./one-shot-distributed-invocation.js";

export interface OneShotResultScope {
  organizationId: string; companyId: string; jobId: string; attemptId: string; operationId: string;
}
export interface CapturedOneShotResult {
  version: 1; operationId: string; stdout: string; stderr: string; exitCode: number;
  timedOut: boolean; durationMs: number; captureError: null;
  /** Added only by the ledger reader, never trusted from the worker result object. */
  usageAccepted?: boolean;
  /** Set by the Commander control plane after the accepted reply commits. */
  replyPersisted?: boolean;
}
export type OneShotResultObservation =
  | { state: "pending" }
  | { state: "failed" }
  | { state: "result"; result: CapturedOneShotResult };

/** Matches artifact-export's frozen attempt/path identity; cross-package test prevents drift. */
export function oneShotResultArtifactId(jobId: string, attempt: number): string {
  const bytes = createHash("sha256").update(`artifact-export:${jobId}:${attempt}:${ONE_SHOT_RESULT_PATH}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const MAX_RESULT_BYTES = 2_200_000;
export async function readOneShotResultObject(input: {
  artifact: { objectKey: string; sizeBytes: number; sha256: string };
  operationId: string; getObject: StorageProvider["getObject"];
  signal?: AbortSignal;
}): Promise<CapturedOneShotResult> {
  const { artifact } = input;
  if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0 || artifact.sizeBytes > MAX_RESULT_BYTES ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error("Invalid one-shot result metadata");
  const object = await input.getObject({ objectKey: artifact.objectKey });
  const abort = () => object.stream.destroy(new Error("One-shot result read aborted"));
  if (input.signal?.aborted) { object.stream.destroy(); throw new Error("One-shot result read aborted"); }
  input.signal?.addEventListener("abort", abort, { once: true });
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of object.stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > artifact.sizeBytes || size > MAX_RESULT_BYTES) throw new Error("One-shot result exceeds its committed size");
      chunks.push(bytes);
    }
  } finally {
    input.signal?.removeEventListener("abort", abort);
    object.stream.destroy();
  }
  const bytes = Buffer.concat(chunks);
  if (size !== artifact.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
    throw new Error("One-shot result integrity mismatch");
  }
  const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  if (!value || value.version !== 1 || value.operationId !== input.operationId ||
    typeof value.stdout !== "string" || typeof value.stderr !== "string" ||
    !Number.isSafeInteger(value.exitCode) || typeof value.timedOut !== "boolean" ||
    typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0 ||
    (value.captureError !== null && !(value.timedOut === true && value.captureError === "ETIMEDOUT"))) {
    throw new Error("Invalid or incomplete one-shot result");
  }
  return { version: 1, operationId: input.operationId, stdout: value.stdout, stderr: value.stderr,
    exitCode: value.exitCode as number, timedOut: value.timedOut, durationMs: value.durationMs, captureError: null };
}

/** Once placed, every error stays distributed. Deadline revokes before reporting failure. */
export async function waitForOneShotResult(input: {
  scope: OneShotResultScope; timeoutMs: number;
  read(scope: OneShotResultScope, signal?: AbortSignal): Promise<OneShotResultObservation>;
  cancel(scope: OneShotResultScope): Promise<unknown>;
  now?: () => number; sleep?: (ms: number) => Promise<void>;
}): Promise<CapturedOneShotResult> {
  const now = input.now ?? Date.now;
  const deadline = now() + input.timeoutMs;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const cancel = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([input.cancel(input.scope), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Distributed one-shot cancellation unavailable after deadline")), 5_000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  };
  for (;;) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observed: OneShotResultObservation;
    try {
      observed = await Promise.race([
        input.read(input.scope, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Distributed one-shot wait deadline exceeded")), Math.max(1, deadline - now()));
        }),
      ]);
    } catch (error) {
      controller.abort();
      await cancel();
      throw error;
    } finally { if (timer) clearTimeout(timer); }
    if (observed.state === "result") return observed.result;
    if (observed.state === "failed") throw new Error("Distributed one-shot ended without an accepted result");
    if (now() >= deadline) {
      await cancel();
      throw new Error("Distributed one-shot wait deadline exceeded");
    }
    await sleep(Math.min(250, Math.max(1, deadline - now())));
  }
}

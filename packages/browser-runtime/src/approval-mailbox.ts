import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ApprovalResolver, BrowserApprovalIntent, BrowserPermissionDecision } from "./approval.js";

const DECISIONS = new Set(["allow_once", "allow_run", "allow_always", "deny", "expired", "cancelled"]);

/** The worker completes this intent through its fenced event sequencer. It
 * delivers a decision to this request's file only after validating the control
 * command's source identity. No endpoint or browser credential crosses here. */
export interface BrowserApprovalMessage {
  readonly type: "approval_requested";
  readonly requestId: string;
  readonly expiresAt: string;
  readonly intent: BrowserApprovalIntent;
}

export function createApprovalMailbox(input: {
  directory: string;
  timeoutMs: number;
  pollMs?: number;
  signal?: AbortSignal;
  emit(message: BrowserApprovalMessage): void | Promise<void>;
}): ApprovalResolver {
  const pollMs = input.pollMs ?? 50;
  if (!isAbsolute(input.directory) || !Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 300_000 ||
      !Number.isInteger(pollMs) || pollMs < 1 || pollMs > 1000) throw new Error("invalid browser approval mailbox");

  return async (intent) => {
    if (input.signal?.aborted) return "cancelled";
    await mkdir(input.directory, { recursive: true, mode: 0o700 });
    const directory = await lstat(input.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("unsafe browser approval mailbox");
    const requestId = randomUUID();
    const path = join(input.directory, `${requestId}.json`);
    const deadline = Date.now() + input.timeoutMs;
    let timer: NodeJS.Timeout | undefined;
    let abort: (() => void) | undefined;
    const stopped = new Promise<"expired" | "cancelled">((resolve) => {
      timer = setTimeout(() => resolve("expired"), input.timeoutMs);
      abort = () => resolve("cancelled");
      input.signal?.addEventListener("abort", abort, { once: true });
      if (input.signal?.aborted) abort();
    });
    try {
      const emitted = await Promise.race([
        Promise.resolve().then(() => input.emit({ type: "approval_requested", requestId, expiresAt: new Date(deadline).toISOString(), intent })).then(() => "emitted" as const),
        stopped,
      ]);
      if (emitted !== "emitted") return emitted;
      while (Date.now() < deadline) {
        if (input.signal?.aborted) return "cancelled";
        try {
          const metadata = await lstat(path);
          if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > 2048) {
            throw new Error("unsafe browser approval response");
          }
          const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
          let bytes: Buffer;
          try {
            const opened = await file.stat();
            if (opened.ino !== metadata.ino || opened.dev !== metadata.dev || !opened.isFile() || opened.nlink !== 1) {
              throw new Error("browser approval response changed");
            }
            const buffer = Buffer.alloc(2049);
            const result = await file.read(buffer, 0, buffer.length, 0);
            if (result.bytesRead > 2048) throw new Error("oversized browser approval response");
            bytes = buffer.subarray(0, result.bytesRead);
          } finally { await file.close(); }
          const body: unknown = JSON.parse(bytes.toString("utf8"));
          if (input.signal?.aborted) return "cancelled";
          if (Date.now() >= deadline) return "expired";
          if (typeof body !== "object" || body == null || Array.isArray(body)) throw new Error("invalid browser approval response");
          const decision = body as Record<string, unknown>;
          if (Object.keys(decision).length !== 3 || decision.requestId !== requestId ||
              typeof decision.decision !== "string" || !DECISIONS.has(decision.decision) ||
              typeof decision.expiresAt !== "string" || !(Date.parse(decision.expiresAt) > Date.now())) {
            throw new Error("invalid browser approval response");
          }
          // The session classifier still refuses standing grants.
          return decision.decision as BrowserPermissionDecision;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const waited = await Promise.race([
          new Promise<"poll">((resolve) => setTimeout(() => resolve("poll"), Math.min(pollMs, Math.max(1, deadline - Date.now())))),
          stopped,
        ]);
        if (waited !== "poll") return waited;
      }
      return "expired";
    } finally {
      if (timer) clearTimeout(timer);
      if (abort) input.signal?.removeEventListener("abort", abort);
      await unlink(path).catch(() => undefined);
    }
  };
}

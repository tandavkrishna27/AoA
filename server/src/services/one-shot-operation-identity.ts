import { createHash, randomUUID } from "node:crypto";
import { ONE_SHOT_CAPTURE_SCRIPT } from "./one-shot-distributed-invocation.js";
/** A reclaimed entry with the same invocation rejoins its durable operation. Changed input gets a new identity. */
export function oneShotOperationId(input: {
  operationIdentity?: string; companyId: string; cliTool: string; command: string; args: string[];
  stdinContent?: string; stagedFile?: { remotePath: string; content: string }; timeoutMs: number; source: string;
}): string {
  if (!input.operationIdentity) return randomUUID();
  const bytes = createHash("sha256").update(JSON.stringify([
    "aoa-one-shot-v1", input.companyId, input.operationIdentity, input.source, input.cliTool,
    input.command, input.args, input.stdinContent ?? "", input.stagedFile ?? null, input.timeoutMs, ONE_SHOT_CAPTURE_SCRIPT,
  ])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

import { createHash, randomUUID } from "node:crypto";
import {
  canonicalizeJsonV1, controlCommandV1Schema, matchRuntimeDecisionResultToRequestV1,
  permissionRuntimeDecisionRequestV1Schema,
  type ControlCommandV1, type PermissionRuntimeDecisionRequestV1,
} from "@armyofagents/worker-protocol";

type DeliveryIdentity = Pick<ControlCommandV1, "organizationId" | "companyId" | "workerId" | "jobId" | "attempt" | "leaseId" | "fenceToken">;
const IDENTITY_FIELDS = ["organizationId", "companyId", "workerId", "jobId", "attempt", "leaseId", "fenceToken"] as const;
const MAX_REQUESTS = 64;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** One controller belongs to one fenced run. Guest messages are intents;
 * authority comes only from a matched control-channel decision. The deliver
 * callback must use that run's effect authority at the point of writing. */
export function createBrowserApprovalController(input: {
  identity: DeliveryIdentity;
  deadlineAt: number;
  now(): number;
  scrubText(text: string): string | null;
  emit(request: PermissionRuntimeDecisionRequestV1): Promise<void>;
  deliver(response: { requestId: string; decision: string; expiresAt: string }): Promise<void>;
}) {
  let closed = false;
  let count = 0;
  const pending = new Map<string, { request: PermissionRuntimeDecisionRequestV1; fingerprint: string }>();
  const delivered = new Map<string, string>();
  const delivering = new Map<string, { fingerprint: string; completion: Promise<void> }>();
  return {
    async request(message: unknown): Promise<PermissionRuntimeDecisionRequestV1> {
      if (closed) throw new Error("browser approval run closed");
      if (!record(message) || !exactKeys(message, ["type", "requestId", "expiresAt", "intent"]) ||
          message.type !== "approval_requested" || typeof message.requestId !== "string" ||
          typeof message.expiresAt !== "string" || !record(message.intent)) throw new Error("invalid browser approval intent");
      const intent = message.intent;
      if (!exactKeys(intent, ["action", "title", "summary", "networkTarget", "riskClass"]) ||
          (intent.action !== "navigate" && intent.action !== "download") || typeof intent.title !== "string" ||
          !(intent.summary === null || typeof intent.summary === "string") ||
          !(intent.networkTarget === null || typeof intent.networkTarget === "string") ||
          intent.riskClass !== (intent.action === "navigate" ? "network_egress" : "download")) {
        throw new Error("invalid browser approval intent");
      }
      const title = input.scrubText(intent.title);
      const summary = intent.summary === null ? null : input.scrubText(intent.summary);
      const networkTarget = intent.networkTarget === null ? null : input.scrubText(intent.networkTarget);
      if (title === null || (intent.summary !== null && summary === null) || (intent.networkTarget !== null && networkTarget === null)) {
        throw new Error("unusable browser approval intent");
      }
      if (intent.action === "navigate") {
        let destination: URL;
        try { destination = new URL(networkTarget ?? ""); } catch { throw new Error("invalid browser approval destination"); }
        if (destination.protocol !== "https:" || destination.origin !== networkTarget) throw new Error("invalid browser approval destination");
      } else if (networkTarget !== null) throw new Error("invalid browser download scope");
      const now = input.now();
      const expiry = Math.min(Date.parse(message.expiresAt), input.deadlineAt, now + 300_000);
      if (!Number.isFinite(expiry) || expiry <= now) throw new Error("browser approval request expired");
      const fingerprint = canonicalizeJsonV1({ action: intent.action, title, summary, networkTarget, expiresAt: message.expiresAt });
      const prior = pending.get(message.requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new Error("browser approval request conflict");
        return prior.request;
      }
      if (pending.size !== 0 || delivered.has(message.requestId) || count >= MAX_REQUESTS) throw new Error("browser approval request limit");
      // This recipe is pinned to the server's aggregate prompt hash in a contract
      // test. Hash only scrubbed bytes; the event sequencer scrubs them again.
      const requestDigest = createHash("sha256").update(JSON.stringify({ kind: "permission", title, summary, promptText: null, command: null })).digest("hex");
      const request = permissionRuntimeDecisionRequestV1Schema.parse({
        decisionKind: "permission", requestId: message.requestId, nonce: randomUUID(), requestDigest,
        schemaVersion: 1, sourceRevision: 0, expiresAt: new Date(expiry).toISOString(), title, summary,
        timeoutPolicy: "deny", defaultDecision: null, toolName: `browser.${intent.action}`, command: null,
        cwd: null, path: null, networkTarget, riskClass: intent.riskClass,
      });
      pending.set(request.requestId, { request, fingerprint }); count++;
      try { await input.emit(request); } catch (error) { pending.delete(request.requestId); throw error; }
      return request;
    },

    async apply(raw: ControlCommandV1): Promise<void> {
      if (closed) throw new Error("browser approval run closed");
      const command = controlCommandV1Schema.parse(raw);
      if (IDENTITY_FIELDS.some((field) => command[field] !== input.identity[field]) ||
          command.commandKind !== "runtime_decision_result" || command.result.decisionKind !== "permission") {
        throw new Error("browser approval delivery mismatch");
      }
      const fingerprint = canonicalizeJsonV1(command.result);
      const previous = delivered.get(command.result.requestId);
      if (previous !== undefined) {
        if (previous !== fingerprint) throw new Error("browser approval decision conflict");
        return;
      }
      const inFlight = delivering.get(command.result.requestId);
      if (inFlight) {
        if (inFlight.fingerprint !== fingerprint) throw new Error("browser approval decision conflict");
        await inFlight.completion;
        return;
      }
      const request = pending.get(command.result.requestId)?.request;
      if (!request || !matchRuntimeDecisionResultToRequestV1(request, command.result).ok ||
          input.now() >= Date.parse(request.expiresAt)) throw new Error("browser approval result mismatch");
      const completion = input.deliver({ requestId: request.requestId, decision: command.result.decision, expiresAt: request.expiresAt });
      delivering.set(request.requestId, { fingerprint, completion });
      try {
        await completion;
        if (!closed) delivered.set(request.requestId, fingerprint);
        pending.delete(request.requestId);
      } finally {
        delivering.delete(request.requestId);
      }
    },
    close(): void { closed = true; pending.clear(); delivered.clear(); },
  };
}

export type BrowserApprovalController = ReturnType<typeof createBrowserApprovalController>;

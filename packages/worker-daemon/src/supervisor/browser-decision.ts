import { permissionRuntimeDecisionResultV1Schema } from "@armyofagents/worker-protocol";
import type { BrowserDecisionDeliveryInput } from "./provider.js";

const responseSchema = permissionRuntimeDecisionResultV1Schema.pick({ requestId: true, decision: true, expiresAt: true }).strict();

/** Only the metadata already matched by the fenced approval controller crosses
 * this local provider port. Neither commands nor paths are caller parameters. */
export function readBrowserDecisionDelivery(raw: unknown, now: number): BrowserDecisionDeliveryInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 2) throw new Error("invalid browser decision delivery");
  const input = raw as Record<string, unknown>;
  const response = responseSchema.parse(input.response);
  if (typeof input.sandboxId !== "string" || !input.sandboxId.length || input.sandboxId.length > 512 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(response.requestId) || Date.parse(response.expiresAt) <= now) {
    throw new Error("invalid browser decision delivery");
  }
  return { sandboxId: input.sandboxId, response };
}

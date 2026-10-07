import { artifactDownloadGrantV1Schema } from "@armyofagents/worker-protocol";
import type { BrowserCredentialDeliveryInput } from "./provider.js";

/** The worker carries a scoped native redemption grant, never session bytes. */
export function readBrowserCredentialDelivery(raw: unknown, now: number): BrowserCredentialDeliveryInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 3) throw new Error("invalid browser credential delivery");
  const input = raw as Record<string, unknown>;
  const grant = artifactDownloadGrantV1Schema.safeParse(input.grant);
  if (typeof input.sandboxId !== "string" || !input.sandboxId.length || input.sandboxId.length > 512 ||
      typeof input.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId) ||
      !grant.success || grant.data.maxBytes <= 0 || grant.data.maxBytes > 8192 ||
      Date.parse(grant.data.issuedAt) > now || Date.parse(grant.data.expiresAt) <= now) throw new Error("invalid browser credential delivery");
  return { sandboxId: input.sandboxId, requestId: input.requestId, grant: grant.data };
}

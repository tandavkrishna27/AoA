import { artifactDownloadGrantV1Schema, type ArtifactDownloadGrantV1, type PermissionRuntimeDecisionRequestV1 } from "@armyofagents/worker-protocol";

type Extension = { namespace: string; schemaVersion: number; critical: boolean; value?: unknown };
export interface BrowserSessionBinding { bindingId: string; origin: string; policyDigest: string }
export interface BrowserSessionGrant { requestId: string; bindingId: string; policyDigest: string; grant: ArtifactDownloadGrantV1 }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;
const refused = () => new Error("invalid browser session authority");
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function one(extensions: readonly Extension[], namespace: string): unknown {
  const matches = extensions.filter(entry => entry.namespace === namespace);
  if (!matches.length) return null;
  if (matches.length !== 1 || matches[0].schemaVersion !== 1 || matches[0].critical !== false) throw refused();
  return matches[0].value;
}
export function readBrowserSessionBinding(extensions: readonly Extension[], policyDigest: string): BrowserSessionBinding | null {
  const value = one(extensions, "com.armyofagents.browser/session-binding");
  if (value === null) return null;
  if (!record(value) || !exact(value, ["bindingId", "origin", "policyDigest"]) || typeof value.bindingId !== "string" ||
      !uuid.test(value.bindingId) || value.policyDigest !== policyDigest || !digest.test(policyDigest) || typeof value.origin !== "string") throw refused();
  let origin: URL;
  try { origin = new URL(value.origin); } catch { throw refused(); }
  if (origin.protocol !== "https:" || origin.origin !== value.origin || origin.username || origin.password) throw refused();
  return { bindingId: value.bindingId, origin: value.origin, policyDigest };
}
export function readBrowserSessionGrants(extensions: readonly Extension[]): BrowserSessionGrant[] {
  const value = one(extensions, "com.armyofagents.browser/session-credential-grants");
  if (value === null) return [];
  if (!record(value) || !exact(value, ["grants"]) || !Array.isArray(value.grants) || value.grants.length > 1) throw refused();
  return value.grants.map(entry => {
    if (!record(entry) || !exact(entry, ["requestId", "bindingId", "policyDigest", "grant"]) ||
        typeof entry.requestId !== "string" || !uuid.test(entry.requestId) || typeof entry.bindingId !== "string" || !uuid.test(entry.bindingId) ||
        typeof entry.policyDigest !== "string" || !digest.test(entry.policyDigest)) throw refused();
    const grant = artifactDownloadGrantV1Schema.parse(entry.grant);
    if (grant.maxBytes < 1 || grant.maxBytes > 8192 || Object.keys(grant.headers).length !== 0) throw refused();
    return { requestId: entry.requestId, bindingId: entry.bindingId, policyDigest: entry.policyDigest, grant };
  });
}

/** A renewal grant alone cannot activate credentials: this controller additionally
 * requires the request that the matched human control command allowed once. */
export function createBrowserSessionGrantConsumer(input: {
  binding: BrowserSessionBinding; objectPrefix: string; now(): number; isActive(): boolean;
  approved(requestId: string): PermissionRuntimeDecisionRequestV1 | null;
  consume(requestId: string): void;
  deliver(requestId: string, grant: ArtifactDownloadGrantV1): Promise<void>;
}) {
  let closed = false;
  const delivered = new Set<string>();
  const pending = new Map<string, Promise<void>>();
  return {
    async apply(entry: BrowserSessionGrant): Promise<void> {
      if (closed || !input.isActive()) throw refused();
      if (entry.bindingId !== input.binding.bindingId || entry.policyDigest !== input.binding.policyDigest ||
          !entry.grant.objectKey.startsWith(input.objectPrefix)) throw refused();
      if (delivered.has(entry.requestId)) return;
      const inFlight = pending.get(entry.requestId);
      if (inFlight) return inFlight;
      const request = input.approved(entry.requestId);
      const now = input.now();
      if (!request || request.nonce !== entry.bindingId || request.summary !== entry.policyDigest || request.networkTarget !== input.binding.origin ||
          request.toolName !== "browser.session_credentials" || Date.parse(entry.grant.issuedAt) > now ||
          Date.parse(entry.grant.expiresAt) <= now || Date.parse(entry.grant.expiresAt) > Date.parse(request.expiresAt)) throw refused();
      const completion = input.deliver(entry.requestId, entry.grant);
      pending.set(entry.requestId, completion);
      try {
        await completion;
        if (closed || !input.isActive()) throw refused();
        delivered.add(entry.requestId); input.consume(entry.requestId);
      } finally { pending.delete(entry.requestId); }
    },
    close(): void { closed = true; delivered.clear(); },
  };
}

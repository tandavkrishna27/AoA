import { createHash } from "node:crypto";
import type { BrowserCredentialDeliveryInput } from "@armyofagents/worker-daemon";

/** This origin is configured at the provider, independently of the worker grant. */
export function browserCredentialOrigin(raw: string): string {
  const origin = new URL(raw);
  if (origin.protocol !== "https:" || origin.origin !== raw || origin.username || origin.password) throw new Error("invalid browser credential authority");
  return origin.origin;
}

export async function redeemBrowserCredential(input: BrowserCredentialDeliveryInput, origin: string, fetcher: typeof fetch, signal: AbortSignal) {
  const { grant } = input; const url = new URL(grant.url);
  if (url.origin !== origin || url.protocol !== "https:" || url.username || url.password || url.hash ||
      url.pathname !== `/api/worker-control/browser-session-credentials/${grant.artifactId}` ||
      [...url.searchParams.keys()].length !== 1 || !url.searchParams.get("grant") || Object.keys(grant.headers).length !== 0) throw new Error("browser credential endpoint refused");
  const response = await fetcher(grant.url, { method: "GET", headers: {}, redirect: "error", signal });
  if (signal.aborted || Date.parse(grant.expiresAt) <= Date.now() || !response.ok || response.redirected ||
      (response.url !== "" && response.url !== url.href) || !response.body) throw new Error("browser credential redemption refused");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (signal.aborted || Date.parse(grant.expiresAt) <= Date.now()) throw new Error("browser credential redemption expired");
      if (next.done) break;
      size += next.value.byteLength;
      if (size > grant.maxBytes || size > 8192) throw new Error("browser credential size refused");
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(chunks, size);
  if (size !== grant.maxBytes || createHash("sha256").update(bytes).digest("hex") !== grant.expectedSha256) throw new Error("browser credential integrity refused");
  const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid browser credential payload");
  const body = payload as Record<string, unknown>; const cookie = body.cookie;
  if (Object.keys(body).length !== 6 || !["requestId", "bindingId", "policyDigest", "origin", "expiresAt", "cookie"].every((key) => Object.hasOwn(body, key)) ||
      body.requestId !== input.requestId || typeof body.bindingId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.bindingId) ||
      typeof body.policyDigest !== "string" || !/^[a-f0-9]{64}$/.test(body.policyDigest) || typeof body.origin !== "string" || body.origin.length > 2048 ||
      typeof body.expiresAt !== "string" || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= Date.now() ||
      Date.parse(body.expiresAt) > Date.now() + 300_000 || !cookie || typeof cookie !== "object" || Array.isArray(cookie)) throw new Error("invalid browser credential payload");
  const destination = new URL(body.origin);
  if (destination.protocol !== "https:" || destination.origin !== body.origin || destination.username || destination.password) throw new Error("invalid browser credential origin");
  const scoped = cookie as Record<string, unknown>;
  if (Object.keys(scoped).length !== 2 || typeof scoped.name !== "string" || !/^__Host-[A-Za-z0-9_-]{1,100}$/.test(scoped.name) ||
      typeof scoped.value !== "string" || !/^[A-Za-z0-9._~-]{16,4096}$/.test(scoped.value)) throw new Error("invalid browser credential cookie");
  return { bytes, cookieValue: scoped.value, expiresAt: body.expiresAt };
}

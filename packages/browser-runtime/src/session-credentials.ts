import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { browserOriginAllowed, type BrowserNetworkConfig } from "./egress-proxy.js";

export const SESSION_CREDENTIAL_DIRECTORY = "/home/user/.aoa/browser-session-credentials";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const refused = (): Error => new Error("Browser session credentials refused");
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

/** This binding is authored by the control plane only when its session issuer is
 * configured. No cookie, endpoint, token or arbitrary storage state is in config. */
export interface SessionCredentialAuthority { readonly bindingId: string; readonly origin: string; readonly cookieName: string }
export interface SessionCredentialRequest {
  readonly type: "session_credentials_requested";
  readonly requestId: string; readonly bindingId: string; readonly policyDigest: string; readonly expiresAt: string;
}
export interface ScopedSessionCookie {
  readonly name: string; readonly value: string; readonly url: string; readonly expires: number;
  readonly secure: true; readonly httpOnly: true; readonly sameSite: "Strict";
}
export function validateSessionCredential(raw: unknown, network: BrowserNetworkConfig): SessionCredentialAuthority {
  if (!object(raw) || !exact(raw, ["bindingId", "origin", "cookieName"]) || typeof raw.bindingId !== "string" || !UUID.test(raw.bindingId) ||
      typeof raw.origin !== "string" || typeof raw.cookieName !== "string" || !/^__Host-[A-Za-z0-9_-]{1,64}$/.test(raw.cookieName)) throw refused();
  try {
    if (new URL(raw.origin).origin !== raw.origin || !browserOriginAllowed(raw.origin, network)) throw refused();
  } catch { throw refused(); }
  return { bindingId: raw.bindingId, origin: raw.origin, cookieName: raw.cookieName };
}

/** Reads only the matched provider-staged one-use file. The worker's live fence
 * and encrypted control-plane staging prove its authority; guest checks preserve
 * request/binding/policy/origin/expiry scope. No secret is emitted or returned to page script. */
export function createSessionCredentialMailbox(input: {
  authority: SessionCredentialAuthority; network: BrowserNetworkConfig; directory: string; timeoutMs?: number; signal?: AbortSignal;
  emit(request: SessionCredentialRequest): void | Promise<void>;
}): () => Promise<ScopedSessionCookie> {
  const authority = validateSessionCredential(input.authority, input.network);
  const timeout = input.timeoutMs ?? 30_000;
  if (!isAbsolute(input.directory) || !Number.isInteger(timeout) || timeout < 1 || timeout > 300_000) throw refused();
  return async () => {
    if (input.signal?.aborted) throw refused();
    await mkdir(input.directory, { recursive: true, mode: 0o700 });
    const directory = await lstat(input.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw refused();
    const requestId = randomUUID(); const path = join(input.directory, `${requestId}.json`);
    const deadline = Date.now() + timeout;
    // Exchange wait and cookie TTL are distinct: the wait is at most 30 seconds
    // in production; the issuer additionally caps the cookie at the active lease.
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    let timer: ReturnType<typeof setTimeout> | undefined; let abort: (() => void) | undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(refused()), timeout);
      abort = () => reject(refused()); input.signal?.addEventListener("abort", abort, { once: true });
      if (input.signal?.aborted) abort();
    });
    try {
      await Promise.race([Promise.resolve().then(() => input.emit({ type: "session_credentials_requested", requestId,
        bindingId: authority.bindingId, policyDigest: input.network.networkPolicy.digest, expiresAt })), stopped]);
      while (Date.now() < deadline) {
        if (input.signal?.aborted) throw refused();
        try {
          const metadata = await lstat(path);
          if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > 8192) throw refused();
          const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
          let bytes: Buffer;
          try {
            const stat = await file.stat();
            if (!stat.isFile() || stat.nlink !== 1 || stat.ino !== metadata.ino || stat.dev !== metadata.dev) throw refused();
            const buffer = Buffer.alloc(8193); const read = await file.read(buffer, 0, buffer.length, 0);
            if (read.bytesRead > 8192) throw refused(); bytes = buffer.subarray(0, read.bytesRead);
          } finally { await file.close(); }
          const reply: unknown = JSON.parse(bytes.toString("utf8"));
          if (input.signal?.aborted || Date.now() >= deadline || !object(reply) ||
              !exact(reply, ["requestId", "bindingId", "policyDigest", "origin", "expiresAt", "cookie"]) ||
              reply.requestId !== requestId || reply.bindingId !== authority.bindingId || reply.policyDigest !== input.network.networkPolicy.digest ||
              reply.origin !== authority.origin || typeof reply.expiresAt !== "string" || !object(reply.cookie) || !exact(reply.cookie, ["name", "value"]) ||
              reply.cookie.name !== authority.cookieName || typeof reply.cookie.value !== "string" || !/^[A-Za-z0-9._~-]{16,4096}$/.test(reply.cookie.value)) throw refused();
          const expiry = Date.parse(reply.expiresAt);
          if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== reply.expiresAt || expiry <= Date.now() || expiry > Date.parse(expiresAt)) throw refused();
          // Removal is mandatory before injecting: failure never becomes reusable
          // authenticated state. The sandbox lifecycle also destroys its profile.
          await unlink(path);
          if (input.signal?.aborted || Date.now() >= deadline || expiry <= Date.now()) throw refused();
          return { name: authority.cookieName, value: reply.cookie.value, url: `${authority.origin}/`, expires: expiry / 1000,
            secure: true, httpOnly: true, sameSite: "Strict" };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw refused();
        }
        await Promise.race([new Promise<void>((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now())))), stopped]);
      }
      throw refused();
    } catch { throw refused(); }
    finally { if (timer) clearTimeout(timer); if (abort) input.signal?.removeEventListener("abort", abort); await unlink(path).catch(() => {}); }
  };
}

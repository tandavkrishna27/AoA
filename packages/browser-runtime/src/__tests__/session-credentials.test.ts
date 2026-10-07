import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createSessionCredentialMailbox, validateSessionCredential } from "../session-credentials.js";
import { fixtureNetwork } from "./network-fixture.js";
const authority = { bindingId: "92c68644-99e1-4db9-8515-c09a6eea1fbd", origin: "https://allowed.example", cookieName: "__Host-session" };
const value = "fixture-application-session-only";
describe("guest scoped session materialization", () => {
  it("requires an allowed exact HTTPS origin and named host cookie", () => {
    expect(validateSessionCredential(authority, fixtureNetwork())).toEqual(authority);
    for (const bad of [{ ...authority, origin: "https://unknown.example" }, { ...authority, origin: "https://allowed.example:8443" },
      { ...authority, origin: "http://allowed.example" }, { ...authority, origin: "https://allowed.example/path" },
      { ...authority, cookieName: "accessToken" }, { ...authority, domain: ".example" }]) {
      expect(() => validateSessionCredential(bad, fixtureNetwork())).toThrow();
    }
  });
  it("consumes only a matched one-use reply and synthesizes an HttpOnly secure host cookie", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aoa-session-cookie-")); let path = "";
    const network = fixtureNetwork();
    try {
      const establish = createSessionCredentialMailbox({ authority, network, directory, timeoutMs: 1000, emit: async (request) => {
        path = join(directory, `${request.requestId}.json`);
        await writeFile(path, JSON.stringify({ requestId: request.requestId, bindingId: authority.bindingId, policyDigest: network.networkPolicy.digest,
          origin: authority.origin, expiresAt: new Date(Date.now() + 500).toISOString(), cookie: { name: authority.cookieName, value } }));
      } });
      const cookie = await establish();
      expect(cookie).toMatchObject({ name: authority.cookieName, value, url: `${authority.origin}/`, secure: true, httpOnly: true, sameSite: "Strict" });
      expect(cookie).not.toHaveProperty("domain"); await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it.each(["binding", "request", "policy", "origin", "expiry", "expired", "domain", "refreshToken", "cookieName"])("refuses hostile %s reply without disclosure", async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), "aoa-session-hostile-")); const network = fixtureNetwork();
    try {
      const establish = createSessionCredentialMailbox({ authority, network, directory, timeoutMs: 1000, emit: async (request) => {
        const reply: Record<string, unknown> = { requestId: request.requestId, bindingId: authority.bindingId, policyDigest: network.networkPolicy.digest,
          origin: authority.origin, expiresAt: new Date(Date.now() + 500).toISOString(), cookie: { name: authority.cookieName, value } };
        if (mode === "binding") reply.bindingId = "another-binding";
        if (mode === "request") reply.requestId = "another-request";
        if (mode === "policy") reply.policyDigest = "a".repeat(64);
        if (mode === "origin") reply.origin = "https://allowed.example:8443";
        if (mode === "expiry") reply.expiresAt = new Date(Date.now() + 600_000).toISOString();
        if (mode === "expired") reply.expiresAt = new Date(Date.now() - 1000).toISOString();
        if (mode === "domain") reply.cookie = { name: authority.cookieName, value, domain: ".example" };
        if (mode === "refreshToken") reply.refreshToken = value;
        if (mode === "cookieName") reply.cookie = { name: "__Host-other", value };
        await writeFile(join(directory, `${request.requestId}.json`), JSON.stringify(reply));
      } });
      await expect(establish()).rejects.toThrow("Browser session credentials refused");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("refuses timeout, cancellation and lease-loss signals before injection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aoa-session-cancel-"));
    try {
      const input = { authority, network: fixtureNetwork(), directory, timeoutMs: 10, emit: () => {} };
      await expect(createSessionCredentialMailbox(input)()).rejects.toThrow("Browser session credentials refused");
      for (const reason of ["cancelled", "lease_lost"]) {
        const controller = new AbortController();
        const establish = createSessionCredentialMailbox({ ...input, timeoutMs: 1000, signal: controller.signal,
          emit: () => { controller.abort(reason); } });
        await expect(establish()).rejects.toThrow("Browser session credentials refused");
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

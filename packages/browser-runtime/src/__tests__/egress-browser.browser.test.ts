import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { fixtureNetwork } from "./network-fixture.js";
import { startBrowserEgressProxy } from "../egress-proxy.js";
import { createPlaywrightDriver } from "../playwright-driver.js";
import { createSessionCredentialMailbox, type SessionCredentialRequest } from "../session-credentials.js";

describe.skipIf(process.env.AOA_RUN_BROWSER_TESTS !== "1")("real guest Chromium proxy enforcement", () => {
  it("authenticates the scoped application login fixture with an HttpOnly one-use cookie", async () => {
    const cookieValue = "keyless-application-login-fixture"; let authenticated = 0; let anonymous = 0;
    const site = createServer({ cert: readFileSync(new URL("../../../../docker/d1/certs/public.crt", import.meta.url)),
      key: readFileSync(new URL("../../../../docker/d1/certs/private.key", import.meta.url)) }, (req, res) => {
      if (req.headers.cookie?.includes(`__Host-session=${cookieValue}`)) { authenticated++; res.end("signed-in-fixture"); }
      else { anonymous++; res.writeHead(401).end("login-required"); }
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    const address = site.address(); if (!address || typeof address === "string") throw new Error("fixture bind");
    const config = fixtureNetwork([{ scheme: "https", host: "allowed.example", port: address.port }]);
    const proxy = await startBrowserEgressProxy(config, { resolve: async () => ["93.184.216.34"],
      dial: () => connect(address.port, "127.0.0.1") });
    const directory = mkdtempSync(join(tmpdir(), "aoa-login-browser-"));
    const launch = chromium.launchPersistentContext.bind(chromium); let context: BrowserContext | undefined;
    const spy = vi.spyOn(chromium, "launchPersistentContext").mockImplementation(async (path, options) => {
      context = await launch(path, { ...options, args: [...(options?.args ?? []), "--ignore-certificate-errors"] }); return context;
    });
    const origin = `https://allowed.example:${address.port}`;
    const authority = { bindingId: "92c68644-99e1-4db9-8515-c09a6eea1fbd", origin, cookieName: "__Host-session" };
    const emitted: SessionCredentialRequest[] = [];
    const materialize = createSessionCredentialMailbox({ authority, network: config, directory: join(directory, "mailbox"), emit: async (request) => {
      emitted.push(request);
      // This guest fixture models only the issuer's matched, cookie-only reply;
      // control-plane broker/exchange/staging has independent fenced tests.
      await writeFile(join(directory, "mailbox", `${request.requestId}.json`), JSON.stringify({ requestId: request.requestId,
        bindingId: authority.bindingId, policyDigest: config.networkPolicy.digest, origin, expiresAt: new Date(Date.now() + 30_000).toISOString(),
        cookie: { name: authority.cookieName, value: cookieValue } }));
    } });
    const driver = (name: string, authenticatedSession: boolean) => createPlaywrightDriver({ userDataDir: join(directory, name), downloadsStagingPath: join(directory, `${name}-downloads`),
      egress: { server: proxy.server, config, denied: () => {} }, ...(authenticatedSession ? { sessionCredential: { authority, materialize } } : {}) });
    let page: Awaited<ReturnType<ReturnType<typeof createPlaywrightDriver>["launch"]>> | undefined;
    try {
      page = await driver("anonymous", false).launch({ chromiumSandbox: true }); await page.navigate(`${origin}/protected`);
      expect(anonymous).toBeGreaterThan(0); expect(authenticated).toBe(0); await page.close();
      page = await driver("authenticated", true).launch({ chromiumSandbox: true }); await page.navigate(`${origin}/protected`);
      expect(authenticated).toBeGreaterThan(0);
      expect(await context!.pages()[0]!.evaluate(() => document.cookie)).not.toContain(cookieValue);
      expect(JSON.stringify(emitted)).not.toContain(cookieValue); expect(emitted).toHaveLength(1);
      const beforeClose = authenticated; await page.close();
      page = await driver("authenticated", false).launch({ chromiumSandbox: true }); await page.navigate(`${origin}/protected`);
      expect(authenticated).toBe(beforeClose);
    } finally { await page?.close(); spy.mockRestore(); await proxy.close(); await new Promise<void>((resolve) => site.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
  }, 30_000);
  it("loads allowed HTTPS and rejects unlisted redirect, port and IP origins", async () => {
    let requests = 0;
    const site = createServer({ cert: readFileSync(new URL("../../../../docker/d1/certs/public.crt", import.meta.url)),
      key: readFileSync(new URL("../../../../docker/d1/certs/private.key", import.meta.url)) }, (req, res) => {
      requests++; if (req.url === "/redirect") res.writeHead(302, { Location: "https://unlisted.example/secret" }).end();
      else res.end("allowed-guest-marker");
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    const address = site.address(); if (!address || typeof address === "string") throw new Error("fixture bind");
    const config = fixtureNetwork([{ scheme: "https", host: "allowed.example", port: address.port }]);
    const denied: string[] = [];
    const proxy = await startBrowserEgressProxy(config, { resolve: async () => ["93.184.216.34"], denied: (value) => denied.push(value),
      dial: (ip, port) => { expect(ip).toBe("93.184.216.34"); expect(port).toBe(address.port); return connect(address.port, "127.0.0.1"); } });
    const directory = mkdtempSync(join(tmpdir(), "aoa-egress-browser-"));
    const launch = chromium.launchPersistentContext.bind(chromium);
    // Test-only trust override for the local fixture certificate. This option
    // cannot enter the staged production config or the launch argument guard.
    const spy = vi.spyOn(chromium, "launchPersistentContext").mockImplementation((path, options) => launch(path, {
      ...options, args: [...(options?.args ?? []), "--ignore-certificate-errors"],
    }));
    let page: Awaited<ReturnType<ReturnType<typeof createPlaywrightDriver>["launch"]>> | undefined;
    try {
      page = await createPlaywrightDriver({ userDataDir: join(directory, "profile"), downloadsStagingPath: join(directory, "downloads"),
        egress: { server: proxy.server, config, denied: () => denied.push("not_allowlisted") } }).launch({ chromiumSandbox: true, headless: true });
      await page.navigate(`https://allowed.example:${address.port}/`); expect(requests).toBeGreaterThan(0);
      await expect(page.navigate(`https://allowed.example:${address.port}/redirect`)).rejects.toThrow();
      for (const url of ["https://127.0.0.1/", "https://allowed.example:1/", "http://allowed.example/"]) await expect(page.navigate(url)).rejects.toThrow();
      expect(denied).toContain("not_allowlisted");
    } finally { await page?.close(); spy.mockRestore(); await proxy.close(); await new Promise<void>((resolve) => site.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
  }, 30_000);
});

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { fixtureNetwork } from "./network-fixture.js";
import { startBrowserEgressProxy } from "../egress-proxy.js";
import { createPlaywrightDriver } from "../playwright-driver.js";

describe.skipIf(process.env.AOA_RUN_BROWSER_TESTS !== "1")("real guest Chromium proxy enforcement", () => {
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

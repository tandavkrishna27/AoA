import { describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ launch: vi.fn(), traceStart: vi.fn(async () => {}), traceStop: vi.fn(async () => {}),
  close: vi.fn(async () => {}), saveVideo: vi.fn(async () => {}) }));
vi.mock("playwright", () => ({ chromium: { launchPersistentContext: fake.launch } }));
import { createPlaywrightDriver } from "../playwright-driver.js";
import { fixtureNetwork } from "./network-fixture.js";

function context() {
  const page = { on: vi.fn(), video: () => ({ saveAs: fake.saveVideo }) };
  return { pages: () => [page], on: vi.fn(), close: fake.close, tracing: { start: fake.traceStart, stop: fake.traceStop } };
}
describe("guest Playwright settings and persistence", () => {
  it("binds fixed proxy and blocks redirects, popups, insecure origins and socket channels", async () => {
    const ctx = { ...context(), route: vi.fn(async () => {}), routeWebSocket: vi.fn(async () => {}) };
    fake.launch.mockResolvedValueOnce(ctx); const denied = vi.fn();
    const page = await createPlaywrightDriver({ userDataDir: "/profile", downloadsStagingPath: "/staging",
      egress: { server: "http://127.0.0.1:12345", config: fixtureNetwork(), denied } }).launch({ chromiumSandbox: true });
    expect(fake.launch).toHaveBeenLastCalledWith("/profile", expect.objectContaining({
      proxy: { server: "http://127.0.0.1:12345" }, serviceWorkers: "block",
      args: expect.arrayContaining(["--proxy-bypass-list=<-loopback>", "--disable-quic"]),
    }));
    const handler = (ctx.route.mock.calls[0] as unknown as [string, (route: unknown) => Promise<void>])[1];
    for (const url of ["https://unlisted.example", "http://allowed.example", "https://127.0.0.1", "https://user:secret@allowed.example", "https://allowed.example:8443"]) {
      const route = { request: () => ({ url: () => url }), abort: vi.fn(async () => {}), continue: vi.fn(async () => {}) };
      await handler(route); expect(route.abort).toHaveBeenCalledWith("blockedbyclient"); expect(route.continue).not.toHaveBeenCalled();
    }
    const allowed = { request: () => ({ url: () => "https://allowed.example/a" }), continue: vi.fn(async () => {}) };
    await handler(allowed); expect(allowed.continue).toHaveBeenCalledOnce();
    const wsHandler = (ctx.routeWebSocket.mock.calls[0] as unknown as [RegExp, (socket: unknown) => void])[1];
    const socket = { close: vi.fn() }; wsHandler(socket); expect(socket.close).toHaveBeenCalledOnce();
    expect(denied).toHaveBeenCalledTimes(6); await page.close();
  });
  it("maps frozen browser settings and exposes trace/video persistence to session orchestration", async () => {
    fake.launch.mockResolvedValueOnce(context());
    const page = await createPlaywrightDriver({ userDataDir: "/profile", downloadsStagingPath: "/staging", videoDir: "/video" }).launch({
      chromiumSandbox: true, viewport: { width: 1000, height: 700 }, locale: "en-GB", timezoneId: "Asia/Kolkata", recordTrace: true });
    expect(fake.launch).toHaveBeenLastCalledWith("/profile", expect.objectContaining({ viewport: { width: 1000, height: 700 },
      locale: "en-GB", timezoneId: "Asia/Kolkata", chromiumSandbox: true, recordVideo: { dir: "/video" } }));
    expect(fake.traceStart).toHaveBeenCalledWith({ screenshots: true, snapshots: true });
    await page.stopTracing!("/output/trace.zip"); await page.close(); await page.video!.saveAs("/output/video.webm");
    expect(fake.traceStop).toHaveBeenCalledWith({ path: "/output/trace.zip" });
    expect(fake.saveVideo).toHaveBeenCalledWith("/output/video.webm");
  });
  it("does not expose unrequested recording and closes guest browser if trace startup fails", async () => {
    fake.launch.mockResolvedValueOnce(context());
    const page = await createPlaywrightDriver({ userDataDir: "/profile", downloadsStagingPath: "/staging" }).launch({ chromiumSandbox: true });
    expect(page.stopTracing).toBeUndefined(); expect(page.video).toBeUndefined(); await page.close();
    fake.close.mockClear(); fake.launch.mockResolvedValueOnce(context()); fake.traceStart.mockRejectedValueOnce(new Error("trace failed"));
    await expect(createPlaywrightDriver({ userDataDir: "/profile", downloadsStagingPath: "/staging" }).launch({ chromiumSandbox: true, recordTrace: true })).rejects.toThrow("trace failed");
    expect(fake.close).toHaveBeenCalledOnce();
  });
});

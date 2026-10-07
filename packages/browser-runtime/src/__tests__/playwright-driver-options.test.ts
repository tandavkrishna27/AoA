import { describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ launch: vi.fn(), traceStart: vi.fn(async () => {}), traceStop: vi.fn(async () => {}),
  close: vi.fn(async () => {}), pageClose:vi.fn(async()=>{}), videoPath:vi.fn(async()=>'/video/completed.webm'), copyVideo:vi.fn(async()=>{}) }));
vi.mock("playwright", () => ({ chromium: { launchPersistentContext: fake.launch } }));
vi.mock('node:fs/promises',async original=>({...await original<typeof import('node:fs/promises')>(),copyFile:fake.copyVideo}));
import { createPlaywrightDriver } from "../playwright-driver.js";
import { fixtureNetwork } from "./network-fixture.js";

function context() {
  const page = { on: vi.fn(), close:fake.pageClose, video: () => ({ path:fake.videoPath }) };
  return { pages: () => [page], newPage:vi.fn(async()=>page), on: vi.fn(), close: fake.close, tracing: { start: fake.traceStart, stop: fake.traceStop } };
}
describe("guest Playwright settings and persistence", () => {
  it("injects scoped session before navigation and refuses trace, cancellation or late lease loss", async () => {
    const authority = { bindingId: "92c68644-99e1-4db9-8515-c09a6eea1fbd", origin: "https://allowed.example", cookieName: "__Host-session" };
    const cookie = { name: authority.cookieName, value: "application-session-fixture", url: `${authority.origin}/`, expires: Date.now() / 1000 + 30,
      secure: true as const, httpOnly: true as const, sameSite: "Strict" as const };
    const controller = new AbortController(); const materialize = vi.fn(async () => cookie);
    const ctx = { ...context(), route: vi.fn(async () => {}), routeWebSocket: vi.fn(async () => {}), addCookies: vi.fn(async () => {}), clearCookies: vi.fn(async () => {}) };
    const config = fixtureNetwork([{ scheme: "https", host: "allowed.example", port: 443 }, { scheme: "https", host: "allowed.example", port: 8443 }]);
    const driver = createPlaywrightDriver({ userDataDir: "/profile", downloadsStagingPath: "/staging",
      egress: { server: "http://127.0.0.1:12345", config, denied: vi.fn() }, sessionCredential: { authority, materialize, signal: controller.signal } });
    fake.launch.mockClear();
    await expect(driver.launch({ chromiumSandbox: true, recordTrace: true })).rejects.toThrow("Browser session credentials refused");
    expect(fake.launch).not.toHaveBeenCalled();
    fake.launch.mockResolvedValueOnce(ctx); const page = await driver.launch({ chromiumSandbox: true });
    expect(ctx.addCookies).toHaveBeenCalledWith([cookie]);
    const routeHandler = (ctx.route.mock.calls[0] as unknown as [string, (route: unknown) => Promise<void>])[1];
    const route = { request: () => ({ url: () => "https://allowed.example:8443/private" }), abort: vi.fn(async () => {}), continue: vi.fn(async () => {}) };
    await routeHandler(route); expect(route.abort).toHaveBeenCalledWith("blockedbyclient"); await page.close();
    expect(ctx.clearCookies).toHaveBeenCalledOnce();
    fake.close.mockClear(); fake.launch.mockResolvedValueOnce(ctx); ctx.addCookies.mockImplementationOnce(async () => { controller.abort("lease_lost"); });
    await expect(driver.launch({ chromiumSandbox: true })).rejects.toThrow("Browser session credentials refused");
    expect(fake.close).toHaveBeenCalledOnce();
    fake.launch.mockClear(); await expect(driver.launch({ chromiumSandbox: true })).rejects.toThrow(); expect(fake.launch).not.toHaveBeenCalled();
  });
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
    const ctx=context();fake.launch.mockResolvedValueOnce(ctx);
    const page = await createPlaywrightDriver({ userDataDir: "/profile", downloadsStagingPath: "/staging", videoDir: "/video" }).launch({
      chromiumSandbox: true, viewport: { width: 1000, height: 700 }, locale: "en-GB", timezoneId: "Asia/Kolkata", recordTrace: true });
    expect(fake.launch).toHaveBeenLastCalledWith("/profile", expect.objectContaining({ viewport: { width: 1000, height: 700 },
      locale: "en-GB", timezoneId: "Asia/Kolkata", chromiumSandbox: true, recordVideo: { dir: "/video" } }));
    expect(fake.traceStart).toHaveBeenCalledWith({ screenshots: true, snapshots: true });
    await page.stopTracing!("/output/trace.zip"); await page.close(); await page.video!.saveAs("/output/video.webm");
    expect(fake.traceStop).toHaveBeenCalledWith({ path: "/output/trace.zip" });
    expect(fake.pageClose).toHaveBeenCalled();expect(fake.videoPath).toHaveBeenCalled();
    expect(fake.copyVideo).toHaveBeenCalledWith('/video/completed.webm',"/output/video.webm");
  });
  it("does not expose unrequested recording and closes guest browser if trace startup fails", async () => {
    fake.launch.mockResolvedValueOnce(context());
    const page = await createPlaywrightDriver({ userDataDir: "/profile", downloadsStagingPath: "/staging" }).launch({ chromiumSandbox: true });
    expect(page.stopTracing).toBeUndefined(); expect(page.video).toBeUndefined(); await page.close();
    fake.close.mockClear(); fake.launch.mockResolvedValueOnce(context()); fake.traceStart.mockRejectedValueOnce(new Error("trace failed"));
    await expect(createPlaywrightDriver({ userDataDir: "/profile", downloadsStagingPath: "/staging" }).launch({ chromiumSandbox: true, recordTrace: true })).rejects.toThrow("trace failed");
    expect(fake.close).toHaveBeenCalledOnce();
  });
  it.each(['page','video','context'] as const)('surfaces %s close failure and still attempts context teardown',async fault=>{
    fake.close.mockClear();fake.pageClose.mockClear();fake.videoPath.mockClear();fake.copyVideo.mockClear();
    const ctx=context();fake.launch.mockResolvedValueOnce(ctx);
    if(fault==='page')fake.pageClose.mockRejectedValueOnce(new Error('page close failed'));
    if(fault==='video')fake.videoPath.mockRejectedValueOnce(new Error('video flush failed'));
    if(fault==='context')fake.close.mockRejectedValueOnce(new Error('context close failed'));
    const page=await createPlaywrightDriver({userDataDir:'/profile',downloadsStagingPath:'/staging',videoDir:'/video'}).launch({chromiumSandbox:true});
    await expect(page.close()).rejects.toThrow();expect(fake.close).toHaveBeenCalledOnce();expect(fake.copyVideo).not.toHaveBeenCalled();
  });
});

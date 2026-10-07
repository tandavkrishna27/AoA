import { describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ launch: vi.fn(), traceStart: vi.fn(async () => {}), traceStop: vi.fn(async () => {}),
  close: vi.fn(async () => {}), saveVideo: vi.fn(async () => {}) }));
vi.mock("playwright", () => ({ chromium: { launchPersistentContext: fake.launch } }));
import { createPlaywrightDriver } from "../playwright-driver.js";

function context() {
  const page = { on: vi.fn(), video: () => ({ saveAs: fake.saveVideo }) };
  return { pages: () => [page], on: vi.fn(), close: fake.close, tracing: { start: fake.traceStart, stop: fake.traceStop } };
}
describe("guest Playwright settings and persistence", () => {
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

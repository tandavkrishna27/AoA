import { describe, expect, it } from "vitest";
import { browserArtifactLifetimeSeconds } from "../services/browser-artifact-expiry.js";
import { MAX_GRANT_TTL_SECONDS } from "../services/artifact-grant-ttl.js";

describe("control-plane browser artifact expiry", () => {
  it.each(["browser_cookie_state", "browser_storage_state"])("limits credential material %s to five minutes", (kind) => {
    expect(browserArtifactLifetimeSeconds(kind)).toBe(300);
    // A URL minted before commit must expire before deletion can begin.
    expect(browserArtifactLifetimeSeconds(kind)).toBeGreaterThanOrEqual(MAX_GRANT_TTL_SECONDS);
  });
  it.each(["screenshot", "dom_snapshot", "playwright_trace", "browser_video", "download"])("retains %s evidence for one day", (kind) => {
    expect(browserArtifactLifetimeSeconds(kind)).toBe(86_400);
  });
  it.each(["workspace_patch", "service_checkpoint", "log", "other", "__proto__", "unknown"])("leaves non-browser policy %s unchanged", (kind) => {
    expect(browserArtifactLifetimeSeconds(kind)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { buildMcpConfig, PLAYWRIGHT_MCP_PACKAGE } from "../services/internal-agent/cli-mode.js";

const baseParams = {
  companyId: "c1",
  userId: "u1",
  userRole: "founder",
  bridgeEntrypoint: "/fake/bridge.js",
  enabledCapabilities: [] as readonly string[],
};

describe("buildMcpConfig: browser_use capability", () => {
  it("uses a narrow authenticated governed endpoint only for explicit brokered Commander selection", () => {
    const config = buildMcpConfig({ ...baseParams, enabledCapabilities: ["browser_use"], actorType: "commander", brokered: true,
      apiBaseUrl: "https://control.example/api", governedBrowser: true });
    expect(config.mcpServers.playwright).toMatchObject({ type: "http", url: "https://control.example/api/companies/c1/browser-mcp" });
    expect(JSON.stringify(config.mcpServers.playwright)).not.toMatch(/npx|playwright\/mcp|cdp|refresh_token/i);
    expect(buildMcpConfig({ ...baseParams, enabledCapabilities: [], actorType: "commander", brokered: true, apiBaseUrl: "https://control.example/api", governedBrowser: true }).mcpServers).not.toHaveProperty("playwright");
  });
  it("does NOT include playwright server when browser_use is absent", () => {
    const config = buildMcpConfig({
      ...baseParams,
      enabledCapabilities: ["system_actions"],
    });
    expect(config.mcpServers).not.toHaveProperty("playwright");
  });

  it("includes playwright server entry when browser_use is enabled", () => {
    const config = buildMcpConfig({
      ...baseParams,
      enabledCapabilities: ["system_actions", "browser_use"],
    });
    expect(config.mcpServers).toHaveProperty("playwright");
    expect(config.mcpServers.playwright!.command).toBe("npx");
    expect(config.mcpServers.playwright!.args).toContain(PLAYWRIGHT_MCP_PACKAGE);
    expect(config.mcpServers.playwright!.args).toContain("--headless");
  });

  it("aoa bridge is always present regardless of browser_use", () => {
    const config = buildMcpConfig({
      ...baseParams,
      enabledCapabilities: ["browser_use"],
    });
    expect(config.mcpServers).toHaveProperty("aoa");
  });
});

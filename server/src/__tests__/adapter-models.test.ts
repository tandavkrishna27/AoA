import { beforeEach, describe, expect, it, vi } from "vitest";
import { models as cursorFallbackModels } from "@armyofagents/adapter-cursor-local";
import { resetOpenCodeModelsCacheForTests } from "@armyofagents/adapter-opencode-local/server";
import { resetPiModelsCacheForTests } from "@armyofagents/adapter-pi-local/server";
import { resolveManagedCodexHomeDir, type CodexModelCatalogRequest } from "@armyofagents/adapter-codex-local/server";
import { listCodexModelsForAgent } from "../adapters/codex-models.js";
import { listAdapterModels } from "../adapters/index.js";
import { resetCursorModelsCacheForTests, setCursorModelsRunnerForTests } from "../adapters/cursor-models.js";

const agentCatalogIdentity = {
  companyId: "company-one",
  authHome: resolveManagedCodexHomeDir(
    { CODEX_HOME: "C:/aoa/shared" },
    "company-one",
    "agent-one",
  ),
  authGeneration: "key-generation-one",
  authMode: "apikey" as const,
  cliVersion: "0.145.0",
};

describe("adapter model listing", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.AOA_OPENCODE_COMMAND;
    delete process.env.AOA_PI_COMMAND;
    delete process.env.PAPERCLIP_PI_COMMAND;
    resetCursorModelsCacheForTests();
    setCursorModelsRunnerForTests(null);
    resetOpenCodeModelsCacheForTests();
    resetPiModelsCacheForTests();
    vi.restoreAllMocks();
  });

  it("returns an empty list for unknown adapters", async () => {
    const models = await listAdapterModels("unknown_adapter");
    expect(models).toEqual([]);
  });

  it("does not expose a global or static Codex model fallback without company auth context", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const models = await listAdapterModels("codex_local");

    expect(models).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses only the selected agent's resolved API key and derived managed home for its picker", async () => {
    process.env.OPENAI_API_KEY = "ambient-server-key";
    const getCatalog = vi.fn(async (_request: CodexModelCatalogRequest) => ({
      identity: agentCatalogIdentity,
      models: [
        { id: "gpt-account-default", displayName: "Account Default", isDefault: true },
        { id: "gpt-api-codex", isDefault: false },
        { id: "gpt-hidden", hidden: true, isDefault: false },
        { id: "gpt-retired", retired: true, isDefault: false },
        { id: "claude-sonnet-4-6", isDefault: false },
      ],
    }));

    const models = await listCodexModelsForAgent(
      {
        companyId: "company-one",
        agentId: "agent-one",
        adapterConfig: {
          command: "codex",
          env: { OPENAI_API_KEY: "agent-one-key" },
        },
      },
      {
        env: { CODEX_HOME: "C:/aoa/shared", OPENAI_API_KEY: "ambient-server-key" },
        getCatalog,
      },
    );

    expect(getCatalog).toHaveBeenCalledOnce();
    const request = getCatalog.mock.calls[0]![0];
    expect(request).toMatchObject({
      companyId: "company-one",
      authHome: agentCatalogIdentity.authHome,
      authMode: "auto",
      command: "codex",
      env: {
        CODEX_HOME: agentCatalogIdentity.authHome,
        OPENAI_API_KEY: "agent-one-key",
      },
    });
    expect(request.env.OPENAI_API_KEY).not.toBe("ambient-server-key");
    expect(models).toEqual([
      { id: "gpt-account-default", label: "Account Default" },
      { id: "gpt-api-codex", label: "gpt-api-codex" },
    ]);
  });

  it("does not probe or copy a shared login when an agent has no scoped auth file or API key", async () => {
    const getCatalog = vi.fn();
    const stat = vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    const models = await listCodexModelsForAgent(
      {
        companyId: "company-one",
        agentId: "agent-one",
        adapterConfig: { command: "codex" },
      },
      { env: { CODEX_HOME: "C:/aoa/shared" }, stat, getCatalog },
    );

    expect(models).toEqual([]);
    expect(stat).toHaveBeenCalledOnce();
    expect(getCatalog).not.toHaveBeenCalled();
  });

  it("ignores caller-controlled home values and refuses non-Codex commands", async () => {
    const getCatalog = vi.fn();
    const models = await listCodexModelsForAgent(
      {
        companyId: "company-one",
        agentId: "agent-one",
        adapterConfig: {
          command: "cmd.exe",
          env: { CODEX_HOME: "C:/attacker-home", OPENAI_API_KEY: "agent-one-key" },
        },
      },
      { env: { CODEX_HOME: "C:/aoa/shared" }, getCatalog },
    );

    expect(models).toEqual([]);
    expect(getCatalog).not.toHaveBeenCalled();
  });

  it("does not execute a malformed configured command containing shell controls", async () => {
    const getCatalog = vi.fn();
    const models = await listCodexModelsForAgent(
      {
        companyId: "company-one",
        agentId: "agent-one",
        adapterConfig: {
          command: "codex & x/codex.exe",
          env: { OPENAI_API_KEY: "agent-one-key" },
        },
      },
      { env: { CODEX_HOME: "C:/aoa/shared" }, getCatalog },
    );

    expect(models).toEqual([]);
    expect(getCatalog).not.toHaveBeenCalled();
  });

  it("does not inspect a local catalog for an agent assigned to a remote target", async () => {
    const getCatalog = vi.fn();
    const stat = vi.fn().mockResolvedValue({ isFile: () => true });
    const models = await listCodexModelsForAgent(
      {
        companyId: "company-one",
        agentId: "agent-one",
        adapterConfig: {
          command: "codex",
          executionTarget: {
            type: "provider-sandbox",
            provider: "e2b",
            providerLeaseId: "lease-one",
            remoteCwd: "/workspace",
          },
        },
      },
      { env: { CODEX_HOME: "C:/aoa/shared" }, stat, getCatalog },
    );

    expect(models).toEqual([]);
    expect(stat).not.toHaveBeenCalled();
    expect(getCatalog).not.toHaveBeenCalled();
  });


  it("returns cursor fallback models when CLI discovery is unavailable", async () => {
    setCursorModelsRunnerForTests(() => ({
      status: null,
      stdout: "",
      stderr: "",
      hasError: true,
    }));

    const models = await listAdapterModels("cursor");
    expect(models).toEqual(cursorFallbackModels);
  });

  it("loads cursor models dynamically and caches them", async () => {
    const runner = vi.fn(() => ({
      status: 0,
      stdout: "Available models: auto, composer-1.5, gpt-5.3-codex-high, sonnet-4.6",
      stderr: "",
      hasError: false,
    }));
    setCursorModelsRunnerForTests(runner);

    const first = await listAdapterModels("cursor");
    const second = await listAdapterModels("cursor");

    expect(runner).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.some((model) => model.id === "auto")).toBe(true);
    expect(first.some((model) => model.id === "gpt-5.3-codex-high")).toBe(true);
    expect(first.some((model) => model.id === "composer-1")).toBe(true);
  });

  it("returns opencode fallback models when opencode command is unavailable", async () => {
    process.env.AOA_OPENCODE_COMMAND = "__paperclip_missing_opencode_command__";

    const models = await listAdapterModels("opencode_local");
    expect(models.map((model) => model.id)).toContain("openai/gpt-5.2-codex");
  });

  it("returns an empty list for pi_local when CLI discovery is unavailable", async () => {
    process.env.AOA_PI_COMMAND = "__missing_pi_command__";
    process.env.PAPERCLIP_PI_COMMAND = "__missing_pi_command__";

    const models = await listAdapterModels("pi_local");
    expect(models).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import {
  resolveCodexChatModel,
  CodexModelAvailabilityError,
  isCodexCompatibleModel,
  isOpenAiFamilyModel,
  isShellSafeModel,
  DEFAULT_CODEX_CHAT_MODEL,
  COMMANDER_CODEX_REASONING_EFFORT,
  type CodexModelCatalog,
  type CodexModelCatalogIdentity,
} from "../services/internal-agent/codex-model.js";

const identity: CodexModelCatalogIdentity = {
  companyId: "company-fixture",
  authHome: "C:/tmp/aoa-codex-home-fixture",
  authGeneration: "fixture-auth-generation",
  authMode: "subscription",
  cliVersion: "0.130.0-fixture",
};

const catalog: CodexModelCatalog = {
  identity,
  models: [
    { id: "gpt-test-default", isDefault: true },
    { id: "gpt-test-listed", isDefault: false },
    { id: "gpt-test-hidden", isDefault: false, hidden: true },
    { id: "gpt-test-retired", isDefault: false, retired: true },
    { id: "gpt-test-codex", isDefault: false },
  ],
};

function availabilityError(run: () => unknown, code: string) {
  try {
    run();
    throw new Error(`Expected CodexModelAvailabilityError(${code})`);
  } catch (error) {
    expect(error).toBeInstanceOf(CodexModelAvailabilityError);
    expect((error as CodexModelAvailabilityError).code).toBe(code);
  }
}

describe("isShellSafeModel", () => {
  it("accepts bare ids, provider/model, and nested namespace opencode ids", () => {
    expect(isShellSafeModel("gpt-test-listed")).toBe(true);
    expect(isShellSafeModel("openai/gpt-test-listed")).toBe(true);
    expect(isShellSafeModel("openrouter/anthropic/claude-sonnet-fixture")).toBe(true);
    expect(isShellSafeModel("  anthropic/claude-sonnet-fixture  ")).toBe(true);
    expect(isShellSafeModel("ollama/llama3.1:8b")).toBe(true);
  });
  it("rejects shell-unsafe segments, empty segments, and empty input", () => {
    expect(isShellSafeModel("gpt-test; rm -rf /")).toBe(false);
    expect(isShellSafeModel("a/b && calc")).toBe(false);
    expect(isShellSafeModel("a//b")).toBe(false);
    expect(isShellSafeModel("/leading")).toBe(false);
    expect(isShellSafeModel("")).toBe(false);
    expect(isShellSafeModel(null)).toBe(false);
  });
});

describe("Codex model family checks", () => {
  it("distinguishes OpenAI API-key family ids from subscription-compatible ids", () => {
    expect(isOpenAiFamilyModel("gpt-test-listed")).toBe(true);
    expect(isOpenAiFamilyModel("codex-test-api")).toBe(true);
    expect(isOpenAiFamilyModel("openai/gpt-test-listed")).toBe(false);
    expect(isCodexCompatibleModel("gpt-test-listed")).toBe(true);
    expect(isCodexCompatibleModel("gpt-test-codex")).toBe(false);
    expect(isCodexCompatibleModel("codex-test-api")).toBe(false);
    expect(isCodexCompatibleModel("claude-test")).toBe(false);
  });
});

describe("resolveCodexChatModel", () => {
  it("requires an account catalog and does not guess a permanent model id", () => {
    availabilityError(() => resolveCodexChatModel(null, null), "catalog_required");
    expect(DEFAULT_CODEX_CHAT_MODEL).toBe("");
  });

  it("preserves an explicitly selected model only when it is listed for the exact account", () => {
    expect(resolveCodexChatModel("gpt-test-listed", null, catalog, identity)).toBe("gpt-test-listed");
  });

  it("uses a listed inherited model, otherwise the single catalog default", () => {
    expect(resolveCodexChatModel(null, "gpt-test-listed", catalog, identity)).toBe("gpt-test-listed");
    expect(resolveCodexChatModel("", "gpt-test-no-longer-listed", catalog, identity)).toBe("gpt-test-default");
    expect(resolveCodexChatModel(null, null, catalog, identity)).toBe("gpt-test-default");
  });

  it.each([
    ["unlisted", "gpt-test-unlisted", "model_unavailable"],
    ["hidden", "gpt-test-hidden", "model_unavailable"],
    ["retired", "gpt-test-retired", "model_unavailable"],
    ["subscription-incompatible", "gpt-test-codex", "model_auth_mode_incompatible"],
    ["invalid", "gpt-test;calc", "model_identifier_invalid"],
  ])("refuses an explicit %s choice without silently substituting", (_case, model, code) => {
    availabilityError(() => resolveCodexChatModel(model, null, catalog, identity), code);
  });

  it("refuses a catalog from another company, auth home, generation, mode, or CLI version", () => {
    const mismatches: Partial<CodexModelCatalogIdentity>[] = [
      { companyId: "other-company" },
      { authHome: "C:/tmp/other-home" },
      { authGeneration: "replaced-login" },
      { authMode: "apikey" },
      { cliVersion: "0.131.0-fixture" },
    ];
    for (const mismatch of mismatches) {
      const other: CodexModelCatalog = {
        ...catalog,
        identity: { ...identity, ...mismatch },
      };
      availabilityError(
        () => resolveCodexChatModel(null, null, other, identity),
        "catalog_identity_mismatch",
      );
    }
  });

  it("allows a listed Codex API-key model only with an API-key catalog", () => {
    const apiCatalog: CodexModelCatalog = {
      identity: { ...identity, authMode: "apikey" },
      models: [
        { id: "gpt-test-api-codex", isDefault: true },
        { id: "gpt-test-listed", isDefault: false },
      ],
    };
    expect(resolveCodexChatModel("gpt-test-api-codex", null, apiCatalog)).toBe("gpt-test-api-codex");
    availabilityError(() => resolveCodexChatModel("gpt-test-codex", null, catalog), "model_auth_mode_incompatible");
  });

  it("requires one safe, visible, non-retired account default when inheritance has no valid choice", () => {
    const noDefault = { ...catalog, models: catalog.models.map((model) => ({ ...model, isDefault: false })) };
    availabilityError(() => resolveCodexChatModel(null, null, noDefault), "catalog_default_missing");
    const multipleDefaults = {
      ...catalog,
      models: [...catalog.models, { id: "gpt-test-second-default", isDefault: true }],
    };
    availabilityError(() => resolveCodexChatModel(null, null, multipleDefaults), "catalog_default_missing");
  });

  it("exposes the Commander reasoning-effort setting", () => {
    expect(COMMANDER_CODEX_REASONING_EFFORT).toBe("high");
  });
});

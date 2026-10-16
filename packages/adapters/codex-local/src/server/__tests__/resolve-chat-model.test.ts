import { describe, expect, it } from "vitest";
import { resolveCodexChatModel, isCodexCompatibleModel } from "../resolve-chat-model.js";
import type { CodexModelCatalog } from "../model-availability.js";

const catalog: CodexModelCatalog = {
  identity: {
    companyId: "company-test",
    authHome: "C:/codex/company-test",
    authGeneration: "auth-test",
    authMode: "subscription",
    cliVersion: "0.145.0",
  },
  models: [
    { id: "gpt-account-default", isDefault: true },
    { id: "gpt-4o", isDefault: false },
  ],
};

describe("resolveCodexChatModel (package-local mirror)", () => {
  it("requires a live account catalog rather than restoring a built-in model slug", () => {
    expect(() => resolveCodexChatModel("", null)).toThrow(
      expect.objectContaining({ code: "catalog_required" }),
    );
  });

  it("resolves an empty inherited setting to the account catalog default", () => {
    expect(resolveCodexChatModel("", null, catalog)).toBe("gpt-account-default");
  });

  it("preserves a listed explicit config model", () => {
    expect(resolveCodexChatModel("gpt-4o", null, catalog)).toBe("gpt-4o");
  });

  it("refuses an explicit model missing from the account catalog", () => {
    expect(() => resolveCodexChatModel("gpt-retired", null, catalog)).toThrow(
      expect.objectContaining({ code: "model_unavailable" }),
    );
  });

  it("uses a listed inherited shared model when the agent override is blank", () => {
    expect(resolveCodexChatModel("", "gpt-4o", catalog)).toBe("gpt-4o");
  });

  it("isCodexCompatibleModel rejects codex-family + empty + unsafe", () => {
    expect(isCodexCompatibleModel("gpt-5.3-codex")).toBe(false);
    expect(isCodexCompatibleModel("")).toBe(false);
    expect(isCodexCompatibleModel("claude-sonnet-4")).toBe(false);
    expect(isCodexCompatibleModel("gpt-4o")).toBe(true);
  });
});

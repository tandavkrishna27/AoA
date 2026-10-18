/** Subscription model-selection parity between crew and Commander paths. */
import { describe, it, expect } from "vitest";
import { applyModelResolutionToConfig } from "../services/internal-agent/aoa-agents/runner-model-resolution.js";
import {
  resolveCodexChatModel,
  type CodexModelCatalog,
} from "../services/internal-agent/codex-model.js";

const identity = {
  companyId: "parity-company",
  authHome: "C:/tmp/parity-codex-home",
  authGeneration: "parity-generation",
  authMode: "subscription" as const,
  cliVersion: "0.130.0-fixture",
};
const catalog: CodexModelCatalog = {
  identity,
  models: [
    { id: "gpt-test-default", isDefault: true },
    { id: "gpt-test-listed", isDefault: false },
    { id: "gpt-test-retired", isDefault: false, retired: true },
  ],
};

function crewResolved(model: string): string {
  const config = applyModelResolutionToConfig(
    "codex_local",
    { model },
    { authMode: "chatgpt", defaultModelResolved: null },
  );
  return resolveCodexChatModel(
    typeof config.model === "string" ? config.model : null,
    null,
    catalog,
    identity,
  );
}

function commanderResolved(model: string): string {
  return resolveCodexChatModel(model || null, null, catalog, identity);
}

function expectUnavailable(resolve: () => string) {
  try {
    resolve();
    throw new Error("Expected unavailable model to be refused");
  } catch (error) {
    expect(error).toMatchObject({ code: "model_unavailable" });
  }
}

describe("provider-switching parity: crew and Commander use the same account catalog", () => {
  it("preserves the same explicitly listed model", () => {
    expect(crewResolved("gpt-test-listed")).toBe("gpt-test-listed");
    expect(crewResolved("gpt-test-listed")).toBe(commanderResolved("gpt-test-listed"));
  });

  it("leaves blank selection inherited so both paths resolve the active account default", () => {
    expect(crewResolved("")).toBe("gpt-test-default");
    expect(crewResolved("")).toBe(commanderResolved(""));
  });

  it("refuses a stale explicit model in both execution paths without fallback or rewrite", () => {
    const persisted = "gpt-test-retired";
    expectUnavailable(() => crewResolved(persisted));
    expectUnavailable(() => commanderResolved(persisted));
    expect(persisted).toBe("gpt-test-retired");
  });

  it("retains API-key-only model selection for the API-key catalog", () => {
    const apiCatalog: CodexModelCatalog = {
      identity: { ...identity, authMode: "apikey" },
      models: [{ id: "gpt-test-api-codex", isDefault: true }],
    };
    expect(
      resolveCodexChatModel("gpt-test-api-codex", null, apiCatalog),
    ).toBe("gpt-test-api-codex");
  });
});

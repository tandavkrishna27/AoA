// server/src/__tests__/resolve-crew-adapter-model-override.test.ts
import { describe, it, expect } from "vitest";
import { resolveCrewAdapterFor } from "../services/internal-agent/aoa-agents/resolve-crew-adapter.js";
import { DEFAULT_CODEX_CHAT_MODEL } from "../services/internal-agent/codex-model.js";

describe("resolveCrewAdapterFor model override", () => {
  it("applies a shell-safe claude override for anthropic", () => {
    expect(resolveCrewAdapterFor("anthropic", "claude-opus-4-1").adapterConfig.model).toBe("claude-opus-4-1");
  });
  it("falls back to the anthropic default for a shell-UNSAFE override", () => {
    expect(resolveCrewAdapterFor("anthropic", "evil; rm -rf").adapterConfig.model).toBe("claude-sonnet-4-5-20250929");
  });
  it("applies a codex-compatible override for openai", () => {
    expect(resolveCrewAdapterFor("openai", "gpt-fixture-listed").adapterConfig.model).toBe("gpt-fixture-listed");
  });
  it("preserves explicit Codex choices so the active account catalog can accept or refuse them", () => {
    expect(resolveCrewAdapterFor("openai", "gpt-fixture-codex").adapterConfig.model).toBe("gpt-fixture-codex");
    expect(resolveCrewAdapterFor("openai", "claude-fixture").adapterConfig.model).toBe("claude-fixture");
  });
  it("omits a blank Codex model so execution inherits the signed-in account default", () => {
    expect(resolveCrewAdapterFor("openai").adapterConfig).not.toHaveProperty("model");
    expect(resolveCrewAdapterFor("openai", "  ").adapterConfig).not.toHaveProperty("model");
  });
  it("requires slash form for opencode override; bare → default", () => {
    expect(resolveCrewAdapterFor("opencode", "anthropic/claude-sonnet-4").adapterConfig.model).toBe("anthropic/claude-sonnet-4");
    expect(resolveCrewAdapterFor("opencode", "gpt-5.5").adapterConfig.model).toBe("openai/gpt-5.2-codex");
  });
  it("applies a shell-safe gemini override for google", () => {
    expect(resolveCrewAdapterFor("google", "gemini-2.0-flash").adapterConfig.model).toBe("gemini-2.0-flash");
  });
  it("no override → unchanged per-provider defaults", () => {
    expect(resolveCrewAdapterFor("anthropic").adapterConfig.model).toBe("claude-sonnet-4-5-20250929");
    expect(resolveCrewAdapterFor("google").adapterConfig.model).toBe("gemini-2.5-pro");
    expect(DEFAULT_CODEX_CHAT_MODEL).toBe("");
  });
});

// server/src/__tests__/resolve-commander-adapter.test.ts
import { describe, it, expect } from "vitest";
import { resolveCommanderAdapterFor } from "../services/internal-agent/aoa-agents/resolve-crew-adapter.js";

describe("resolveCommanderAdapterFor (keyed on cliTool, not provider)", () => {
  it("claude_cli / null → claude_local", () => {
    expect(resolveCommanderAdapterFor("claude_cli", null).adapterType).toBe("claude_local");
    expect(resolveCommanderAdapterFor(null, null).adapterType).toBe("claude_local");
  });
  it("codex → codex_local", () => {
    expect(resolveCommanderAdapterFor("codex", null).adapterType).toBe("codex_local");
  });
  it("honors a valid Commander model override per cliTool", () => {
    expect(resolveCommanderAdapterFor("codex", "gpt-fixture-listed").adapterConfig.model).toBe("gpt-fixture-listed");
    expect(resolveCommanderAdapterFor("claude_cli", "claude-opus-4-1").adapterConfig.model).toBe("claude-opus-4-1");
  });
  it("preserves an explicit incompatible model so execution can refuse it without rewriting", () => {
    // The account-scoped execution resolver owns compatibility checks; this
    // persistence/config helper must not replace an explicit stored choice.
    expect(resolveCommanderAdapterFor("codex", "claude-sonnet-4-6").adapterConfig.model)
      .toBe("claude-sonnet-4-6");
  });
  it("leaves a blank Codex model unset for account-catalog inheritance", () => {
    expect(resolveCommanderAdapterFor("codex", "").adapterConfig).not.toHaveProperty("model");
  });
});

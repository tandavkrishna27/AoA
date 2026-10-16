// server/src/__tests__/resolve-crew-adapter.test.ts
//
// Verify provider-switch behavior while preserving Codex model selections for
// execution-time account-catalog validation.
//
// Companion to resolve-crew-adapter-opencode.test.ts (same import/mock pattern).

import { describe, it, expect } from "vitest";
import { resolveCrewAdapterFor, needsAdapterBackfill, shouldRewriteCrewAdapter, mergeAdapterConfig, mergeCrewAdapterConfig } from "../services/internal-agent/aoa-agents/resolve-crew-adapter.js";

describe("resolve-crew-adapter (provider-switching fixes)", () => {
  it("omits a blank Codex model so each managed account can inherit its own catalog default", () => {
    const a = resolveCrewAdapterFor("openai");
    expect(a.adapterType).toBe("codex_local");
    expect(a.adapterConfig).not.toHaveProperty("model");
  });
  it("opencode default is a valid provider/model slash id, not a bare codex id", () => {
    const a = resolveCrewAdapterFor("opencode");
    expect(String(a.adapterConfig.model)).toMatch(/\//);
  });
  it("does not rewrite explicit, blank, or absent Codex choices during backfill", () => {
    expect(needsAdapterBackfill("codex_local", { model: "gpt-fixture-codex" })).toBe(false);
    expect(needsAdapterBackfill("codex_local", { model: "" })).toBe(false);
    expect(needsAdapterBackfill("codex_local", {})).toBe(false);
  });

  // Codex P2 (Case 4): the previous opencode crew default seeded a BARE
  // `gpt-5.3-codex` (API-key-only, 400s on a ChatGPT login). The corrected
  // default is the slash-format `openai/gpt-5.2-codex`. Existing rows must
  // self-heal on boot, so the legacy bare model is flagged for backfill while
  // valid slash-format / ChatGPT-safe models are left alone.
  it("backfill flags a legacy bare codex model on an opencode_local row", () => {
    expect(needsAdapterBackfill("opencode_local", { model: "gpt-5.3-codex" })).toBe(true);
  });
  it("backfill does NOT flag the corrected slash-format opencode default", () => {
    expect(needsAdapterBackfill("opencode_local", { model: "openai/gpt-5.2-codex" })).toBe(false);
  });
  it("backfill leaves a founder's valid slash-format opencode model alone", () => {
    expect(needsAdapterBackfill("opencode_local", { model: "anthropic/claude-sonnet-4-5" })).toBe(false);
    expect(needsAdapterBackfill("opencode_local", { model: "google/gemini-2.5-pro" })).toBe(false);
  });
  it("backfill leaves a ChatGPT-safe bare opencode model (e.g. gpt-5.5) untouched", () => {
    expect(needsAdapterBackfill("opencode_local", { model: "gpt-5.5" })).toBe(false);
  });
  it("backfill ignores an opencode_local row with no model set", () => {
    expect(needsAdapterBackfill("opencode_local", {})).toBe(false);
    expect(needsAdapterBackfill("opencode_local", null)).toBe(false);
  });

  // Codex P2: a backfill rewrite must preserve the founder's per-agent settings —
  // only the resolved model (+ bypass flags from `next`) should change.
  it("mergeAdapterConfig preserves per-agent env/cwd/command/extraArgs while rewriting the model", () => {
    const merged = mergeAdapterConfig(
      { model: "gpt-5.3-codex", env: { OPENAI_API_KEY: "sk-x" }, cwd: "/w", command: "codex", extraArgs: ["--foo"] },
      { model: "gpt-5.5", dangerouslyBypassApprovalsAndSandbox: true },
    );
    expect(merged.model).toBe("gpt-5.5");
    expect(merged.dangerouslyBypassApprovalsAndSandbox).toBe(true);
    expect(merged.env).toEqual({ OPENAI_API_KEY: "sk-x" });
    expect(merged.cwd).toBe("/w");
    expect(merged.command).toBe("codex");
    expect(merged.extraArgs).toEqual(["--foo"]);
  });
  it("mergeAdapterConfig still preserves instructions* fields", () => {
    const merged = mergeAdapterConfig({ instructionsFilePath: "/i.md", model: "old" }, { model: "gpt-5.5" });
    expect(merged.instructionsFilePath).toBe("/i.md");
    expect(merged.model).toBe("gpt-5.5");
  });
});

// Codex P1: a company that switches internal_agent_config.provider must migrate
// EXISTING crew agents, not just broken ones — a healthy old-provider row would
// otherwise keep running the old CLI forever.
describe("shouldRewriteCrewAdapter — provider-switch migration", () => {
  it("migrates a HEALTHY old-provider row when the resolved adapter differs (provider switch)", () => {
    // claude_local crew row is perfectly healthy (has dangerouslySkipPermissions)
    // but the company switched provider → target is codex_local → must rewrite.
    expect(
      shouldRewriteCrewAdapter("claude_local", { model: "claude-sonnet-4-5", dangerouslySkipPermissions: true }, "codex_local", { model: "gpt-5.5" }),
    ).toBe(true);
    // codex_local row with a ChatGPT-safe model is healthy, but the company
    // switched to anthropic → target claude_local → must rewrite.
    expect(shouldRewriteCrewAdapter("codex_local", { model: "gpt-5.5" }, "claude_local", { model: "claude-sonnet-4-5-20250929" })).toBe(true);
  });
  it("does NOT rewrite a healthy row already on the target adapter (no provider change)", () => {
    expect(
      shouldRewriteCrewAdapter("claude_local", { model: "claude-sonnet-4-5", dangerouslySkipPermissions: true }, "claude_local", { model: "claude-sonnet-4-5", dangerouslySkipPermissions: true }),
    ).toBe(false);
    expect(shouldRewriteCrewAdapter("codex_local", { model: "gpt-5.5" }, "codex_local", { model: "gpt-5.5" })).toBe(false);
  });
  it("does not rewrite a Codex row based on guessed model compatibility", () => {
    // The execution-time account catalog owns availability; persisted choices
    // have no reliable explicit-versus-inherited provenance and stay untouched.
    expect(shouldRewriteCrewAdapter("codex_local", { model: "gpt-fixture-codex", env: {} }, "codex_local", { model: "gpt-fixture-codex", env: {} })).toBe(false);
  });
  it("preserves a founder's api-key codex row on the same adapter (opts.isApiKeyAuth)", () => {
    expect(
      shouldRewriteCrewAdapter("codex_local", { model: "gpt-fixture-codex", env: {} }, "codex_local", { model: "gpt-fixture-codex", env: {} }, { isApiKeyAuth: true }),
    ).toBe(false);
  });
  it("is consistent with needsAdapterBackfill when the adapter is unchanged", () => {
    const cfg = { model: "gpt-fixture-codex", env: {} };
    expect(shouldRewriteCrewAdapter("codex_local", cfg, "codex_local", { model: "gpt-fixture-codex", env: {} })).toBe(
      needsAdapterBackfill("codex_local", cfg),
    );
  });
});

// Task 4b (review P0): a model-only change (same provider → same adapter type)
// must still rewrite the row, otherwise the new model never lands on existing
// crew rows and dispatch reads the stale model.
describe("shouldRewriteCrewAdapter — same-adapter model drift", () => {
  it("rewrites when the model differs on the SAME adapter", () => {
    expect(shouldRewriteCrewAdapter(
      "claude_local", { model: "claude-sonnet-4-5-20250929", dangerouslySkipPermissions: true },
      "claude_local", { model: "claude-opus-4-1", dangerouslySkipPermissions: true },
    )).toBe(true);
  });
  it("does NOT rewrite when the model is identical and the row is healthy", () => {
    expect(shouldRewriteCrewAdapter(
      "claude_local", { model: "claude-opus-4-1", dangerouslySkipPermissions: true },
      "claude_local", { model: "claude-opus-4-1", dangerouslySkipPermissions: true },
    )).toBe(false);
  });
  it("still rewrites on an adapter-type switch (unchanged behavior)", () => {
    expect(shouldRewriteCrewAdapter(
      "claude_local", { model: "x" }, "codex_local", { model: "gpt-5.5" },
    )).toBe(true);
  });
});

// Codex P2: a provider switch must NOT carry over provider-specific fields
// (command/extraArgs/bypass flags) — they'd make the new CLI run the wrong
// executable/args — while neutral fields (cwd/env/instructions*) are preserved.
describe("mergeCrewAdapterConfig", () => {
  const existing = {
    model: "claude-sonnet-4-5",
    command: "/opt/claude",          // provider-specific — must NOT survive a switch
    extraArgs: ["--print"],          // provider-specific
    dangerouslySkipPermissions: true, // claude-specific
    cwd: "/work",                    // neutral
    env: { ANTHROPIC_API_KEY: "sk-ant", HTTP_PROXY: "http://proxy:8080" }, // provider-auth + neutral
    instructionsFilePath: "/i.md",   // neutral
  };
  const nextCodex = { model: "gpt-5.5", dangerouslyBypassApprovalsAndSandbox: true };

  it("provider SWITCH drops command/extraArgs/old-bypass and applies the new adapter's fields", () => {
    const merged = mergeCrewAdapterConfig(existing, nextCodex, "claude_local", "codex_local");
    expect(merged.command).toBeUndefined();
    expect(merged.extraArgs).toBeUndefined();
    expect(merged.dangerouslySkipPermissions).toBeUndefined(); // old provider flag dropped
    expect(merged.model).toBe("gpt-5.5"); // new adapter wins
    expect(merged.dangerouslyBypassApprovalsAndSandbox).toBe(true); // new adapter sets it
  });
  it("provider SWITCH drops the SOURCE provider's auth env but keeps neutral env vars (Codex P2)", () => {
    const merged = mergeCrewAdapterConfig(existing, nextCodex, "claude_local", "codex_local");
    const env = merged.env as Record<string, unknown>;
    expect(env.ANTHROPIC_API_KEY).toBeUndefined(); // claude's key — codex doesn't use it → dropped
    expect(env.HTTP_PROXY).toBe("http://proxy:8080"); // neutral var preserved
  });
  it("provider SWITCH KEEPS an auth key the TARGET still needs — opencode→codex preserves OPENAI_API_KEY (Codex P2)", () => {
    const merged = mergeCrewAdapterConfig(
      { model: "openai/gpt-5.2-codex", command: "/opt/opencode", env: { OPENAI_API_KEY: "sk-agent", FOO: "bar" } },
      { model: "gpt-5.5", dangerouslyBypassApprovalsAndSandbox: true },
      "opencode_local",
      "codex_local",
    );
    const env = merged.env as Record<string, unknown>;
    expect(env.OPENAI_API_KEY).toBe("sk-agent"); // codex reads it → MUST survive the switch
    expect(env.FOO).toBe("bar");
    expect(merged.command).toBeUndefined(); // opencode's command still dropped
  });
  it("provider SWITCH drops a differently-cased SOURCE auth env key (case-insensitive)", () => {
    const merged = mergeCrewAdapterConfig(
      { model: "gpt-5.5", env: { OpenAI_API_Key: "sk-x", FOO: "bar" } },
      { model: "claude-sonnet-4-5", dangerouslySkipPermissions: true },
      "codex_local",
      "claude_local", // target=claude doesn't use OPENAI_API_KEY → drop it
    );
    const env = merged.env as Record<string, unknown>;
    expect(env.OpenAI_API_Key).toBeUndefined();
    expect(env.FOO).toBe("bar");
  });
  it("provider SWITCH preserves neutral fields (cwd, instructions*)", () => {
    const merged = mergeCrewAdapterConfig(existing, nextCodex, "claude_local", "codex_local");
    expect(merged.cwd).toBe("/work");
    expect(merged.instructionsFilePath).toBe("/i.md");
  });
  // Codex P1: the allowlist must drop EVERY provider-specific tuning key, not just
  // command/extraArgs — each adapter's execute.ts reads its own set, and a stale
  // one would flow into the wrong CLI.
  it("provider SWITCH drops ALL provider-specific tuning keys (allowlist, not just command/extraArgs)", () => {
    const richSource = {
      model: "claude-sonnet-4-5",
      cwd: "/work",
      env: { HTTP_PROXY: "p" },
      // a grab-bag of provider-specific tuning keys read by various adapters:
      reasoningEffort: "high",
      modelReasoningEffort: "high",
      chrome: true,
      sandbox: true,
      variant: "fast",
      thinking: "extended",
      maxTurnsPerRun: 9,
      permissionMode: "yolo",
      search: true,
      effort: "max",
      command: "/opt/claude",
      extraArgs: ["--print"],
      args: ["--legacy-flag"], // legacy fallback the adapters still read when extraArgs is absent
    };
    const merged = mergeCrewAdapterConfig(richSource, nextCodex, "claude_local", "codex_local");
    for (const k of ["reasoningEffort", "modelReasoningEffort", "chrome", "sandbox", "variant", "thinking", "maxTurnsPerRun", "permissionMode", "search", "effort", "command", "extraArgs", "args"]) {
      expect(merged[k], `${k} must be dropped on a provider switch`).toBeUndefined();
    }
    // neutral + the resolved adapter's own fields survive:
    expect(merged.cwd).toBe("/work");
    expect(merged.model).toBe("gpt-5.5");
    expect(merged.dangerouslyBypassApprovalsAndSandbox).toBe(true);
  });
  // Codex P2: claude's auth is more than ANTHROPIC_API_KEY — Bedrock flags + the
  // auth token are part of its auth env and must be treated as a unit.
  it("provider SWITCH away from claude drops the full claude auth env set", () => {
    const merged = mergeCrewAdapterConfig(
      { model: "claude-sonnet-4-5", env: { ANTHROPIC_API_KEY: "sk-ant", ANTHROPIC_AUTH_TOKEN: "tok", CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_BEDROCK_BASE_URL: "https://bedrock", FOO: "bar" } },
      nextCodex, "claude_local", "codex_local",
    );
    const env = merged.env as Record<string, unknown>;
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(env.ANTHROPIC_BEDROCK_BASE_URL).toBeUndefined();
    expect(env.FOO).toBe("bar"); // neutral preserved
  });
  it("provider SWITCH INTO claude keeps the claude auth env the target needs", () => {
    const merged = mergeCrewAdapterConfig(
      { model: "openai/...", env: { ANTHROPIC_API_KEY: "sk-ant", CLAUDE_CODE_USE_BEDROCK: "1" } },
      { model: "claude-sonnet-4-5", dangerouslySkipPermissions: true },
      "opencode_local", "claude_local",
    );
    const env = merged.env as Record<string, unknown>;
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant"); // claude reads it → kept
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
  });
  it("provider SWITCH INTO gemini keeps gemini's auth env, drops others", () => {
    const merged = mergeCrewAdapterConfig(
      { model: "gpt-5.5", env: { GEMINI_API_KEY: "g", GOOGLE_API_KEY: "g2", OPENAI_API_KEY: "sk-open", FOO: "bar" } },
      { model: "gemini-2.5-pro" },
      "codex_local", "gemini_local",
    );
    const env = merged.env as Record<string, unknown>;
    expect(env.GEMINI_API_KEY).toBe("g"); // gemini reads these → kept
    expect(env.GOOGLE_API_KEY).toBe("g2");
    expect(env.OPENAI_API_KEY).toBeUndefined(); // source codex key — gemini doesn't read it → dropped
    expect(env.FOO).toBe("bar"); // neutral preserved
  });
  it("provider SWITCH from a grok SOURCE drops XAI_API_KEY but keeps the codex target's key", () => {
    const merged = mergeCrewAdapterConfig(
      { model: "grok-2", env: { XAI_API_KEY: "xai", OPENAI_API_KEY: "sk-open" } },
      nextCodex, "grok_local", "codex_local",
    );
    const env = merged.env as Record<string, unknown>;
    expect(env.XAI_API_KEY).toBeUndefined(); // grok's key — codex doesn't read it → dropped
    expect(env.OPENAI_API_KEY).toBe("sk-open"); // codex reads it → kept
  });
  it("same adapter (no switch) preserves ALL fields like mergeAdapterConfig", () => {
    const merged = mergeCrewAdapterConfig(existing, { model: "gpt-5.5" }, "claude_local", "claude_local");
    expect(merged).toEqual(mergeAdapterConfig(existing, { model: "gpt-5.5" }));
    expect(merged.command).toBe("/opt/claude"); // preserved on a same-CLI backfill
    expect((merged.env as Record<string, unknown>).ANTHROPIC_API_KEY).toBe("sk-ant"); // env untouched
  });
});

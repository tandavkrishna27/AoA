import { describe, it, expect } from "vitest";
import { resolveModel, ShellUnsafeModelError } from "../model-resolution.js";
import { CodexModelAvailabilityError, DEFAULT_CODEX_CHAT_MODEL } from "../codex-model.js";

const chatgpt = { authMode: "chatgpt" as const, defaultModelResolved: "gpt-5.5" };

function expectAvailabilityError(action: () => unknown, code: string) {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CodexModelAvailabilityError);
  expect((thrown as CodexModelAvailabilityError).code).toBe(code);
}

describe("resolveModel", () => {
  it("has no permanent Codex model slug", () => {
    expect(DEFAULT_CODEX_CHAT_MODEL).toBe("");
  });
  it("THROWS on a shell-unsafe model regardless of tier", () => {
    expect(() => resolveModel("codex_local", "gpt-5 & calc.exe", chatgpt)).toThrow(ShellUnsafeModelError);
  });
  it("refuses an API-key-only codex model on ChatGPT auth instead of silently replacing it", () => {
    expectAvailabilityError(
      () => resolveModel("codex_local", "gpt-5.3-codex", chatgpt),
      "model_auth_mode_incompatible",
    );
  });
  it("passes a compatible codex model through unchanged", () => {
    expect(resolveModel("codex_local", "gpt-5.5", chatgpt).model).toBe("gpt-5.5");
  });
  it("empty Codex model stays inherited for account-scoped catalog resolution", () => {
    expect(resolveModel("codex_local", "", chatgpt)).toEqual({ omitModelFlag: true });
  });
  it("claude passes a claude model through; gemini 'auto' is allowed (omit)", () => {
    expect(resolveModel("claude_local", "claude-sonnet-4-5-20250929", { authMode: "subscription", defaultModelResolved: null }).model)
      .toBe("claude-sonnet-4-5-20250929");
    expect(resolveModel("gemini_local", "auto", { authMode: "unknown", defaultModelResolved: null }).omitModelFlag).toBe(true);
  });
  it("passes an opencode provider/model slash model through unchanged (shell-safe)", () => {
    const r = resolveModel("opencode_local", "openai/gpt-5.2-codex", { authMode: "unknown", defaultModelResolved: null });
    expect(r.model).toBe("openai/gpt-5.2-codex");
    expect(r.omitModelFlag).toBe(false);
  });
  it("passes a codex -codex model through unchanged on an apikey login (no correction, no note)", () => {
    const r = resolveModel("codex_local", "gpt-5.3-codex", { authMode: "apikey", defaultModelResolved: "gpt-5.5" });
    expect(r.model).toBe("gpt-5.3-codex");
    expect(r.note).toBeUndefined();
  });
  it("passes a non-auto gemini model through unchanged", () => {
    const r = resolveModel("gemini_local", "gemini-2.5-pro", { authMode: "unknown", defaultModelResolved: null });
    expect(r.model).toBe("gemini-2.5-pro");
    expect(r.omitModelFlag).toBe(false);
  });

  // Codex finding P2: in apikey mode a blank requested model falls back to the
  // ~/.codex/config.toml default WITHOUT the shell-safety gate (that gate only
  // runs for a non-empty requested model). Validate the fallback too.
  it("apikey mode: an unsafe config-default fallback (blank requested) is rejected, not passed to --model", () => {
    expect(() =>
      resolveModel("codex_local", "", { authMode: "apikey", defaultModelResolved: "gpt-5 && rm -rf /" }),
    ).toThrow(ShellUnsafeModelError);
  });
  it("apikey mode: a safe config-default fallback (blank requested) passes through", () => {
    const r = resolveModel("codex_local", "", { authMode: "apikey", defaultModelResolved: "gpt-5.3-codex" });
    expect(r.model).toBe("gpt-5.3-codex");
  });
  it("apikey mode: blank requested + null config default stays inherited", () => {
    const r = resolveModel("codex_local", "", { authMode: "apikey", defaultModelResolved: null });
    expect(r).toEqual({ omitModelFlag: true });
  });
  it("apikey mode: a safe-but-padded config default is trimmed", () => {
    const r = resolveModel("codex_local", "", { authMode: "apikey", defaultModelResolved: "  gpt-5.3-codex  " });
    expect(r.model).toBe("gpt-5.3-codex");
  });

  // An unsafe inherited preference is omitted so the Codex CLI's exact
  // account-scoped catalog default can be resolved without persisting a slug.
  it("apikey mode: a NON-OpenAI config default is omitted for account catalog resolution", () => {
    expect(resolveModel("codex_local", "", { authMode: "apikey", defaultModelResolved: "claude-sonnet-4-5-20250929" }))
      .toEqual({ omitModelFlag: true });
    expect(resolveModel("codex_local", "", { authMode: "apikey", defaultModelResolved: "gemini-2.5-pro" }))
      .toEqual({ omitModelFlag: true });
  });
  it("apikey mode: an EXPLICIT gpt-*-codex request is preserved even when the config default is non-OpenAI", () => {
    const r = resolveModel("codex_local", "gpt-5.3-codex", { authMode: "apikey", defaultModelResolved: "claude-sonnet-4-5-20250929" });
    expect(r.model).toBe("gpt-5.3-codex");
    expect(r.note).toBeUndefined();
  });

  // An explicit API-key selection must be OpenAI/Codex-family. Refuse invalid
  // provenance rather than rewriting it to a guessed account default.
  it("apikey mode: an explicit opencode-style slash model is refused instead of replaced", () => {
    expectAvailabilityError(
      () => resolveModel("codex_local", "openai/gpt-5.5", { authMode: "apikey", defaultModelResolved: "gpt-5.5" }),
      "model_unavailable",
    );
  });
  it("apikey mode: an explicit non-OpenAI alias (claude/gemini) is refused instead of replaced", () => {
    for (const model of ["claude-sonnet-4-5-20250929", "gemini-2.5-pro"]) {
      expectAvailabilityError(
        () => resolveModel("codex_local", model, { authMode: "apikey", defaultModelResolved: "gpt-5.5" }),
        "model_unavailable",
      );
    }
  });
  // Codex-* identifiers are valid for API-key auth; a valid explicit choice is
  // preserved and the account catalog later checks that it is currently listed.
  it("apikey mode: an explicit codex-prefixed model (codex-mini-latest) is preserved", () => {
    const r = resolveModel("codex_local", "codex-mini-latest", { authMode: "apikey", defaultModelResolved: "gpt-5.5" });
    expect(r.model).toBe("codex-mini-latest");
    expect(r.note).toBeUndefined();
  });
});

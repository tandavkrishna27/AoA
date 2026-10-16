/** Generalized model resolution for all adapter types (Unit B core). */
import {
  isShellSafeModel,
  isCodexCompatibleModel,
  isOpenAiFamilyModel,
  CodexModelAvailabilityError,
} from "./codex-model.js";

export class ShellUnsafeModelError extends Error {
  constructor(model: string) {
    super(`Unsafe model identifier: ${JSON.stringify(model)}`);
    this.name = "ShellUnsafeModelError";
  }
}

export interface ResolveModelStatus {
  authMode: "subscription" | "chatgpt" | "apikey" | "unknown";
  defaultModelResolved: string | null;
}

export interface ResolvedModel {
  model?: string;
  omitModelFlag: boolean;
  note?: string;
}

/**
 * Validate stored selections without replacing them. Subscription defaults
 * are resolved later by codex-local against its managed home and exact CLI
 * catalog, immediately before the selected model reaches execution.
 */
export function resolveModel(
  adapterType: string,
  requested: string | null | undefined,
  status: ResolveModelStatus,
): ResolvedModel {
  const model = (requested ?? "").trim();
  if (model && !isShellSafeModel(model)) throw new ShellUnsafeModelError(model);

  if (adapterType === "codex_local") {
    if (status.authMode === "apikey") {
      if (model) {
        if (isOpenAiFamilyModel(model)) return { model, omitModelFlag: false };
        throw new CodexModelAvailabilityError(
          "model_unavailable",
          `The configured Codex model "${model}" is not an OpenAI/Codex model. Choose a model from this API-key account's Codex model list.`,
        );
      }
      const shared = (status.defaultModelResolved ?? "").trim();
      if (shared && !isShellSafeModel(shared)) throw new ShellUnsafeModelError(shared);
      return isOpenAiFamilyModel(shared)
        ? { model: shared, omitModelFlag: false }
        : { omitModelFlag: true };
    }

    // A blank setting means inherit from the CLI catalog. Do not materialize a
    // permanent slug before the adapter can see that account's catalog.
    if (!model) return { omitModelFlag: true };
    if (!isCodexCompatibleModel(model)) {
      throw new CodexModelAvailabilityError(
        "model_auth_mode_incompatible",
        `The configured Codex model "${model}" is not compatible with ChatGPT subscription auth. Choose a listed subscription model or configure API-key auth explicitly.`,
      );
    }
    return { model, omitModelFlag: false };
  }

  if (adapterType === "gemini_local") {
    return !model || model === "auto"
      ? { omitModelFlag: true }
      : { model, omitModelFlag: false };
  }

  return model ? { model, omitModelFlag: false } : { omitModelFlag: true };
}

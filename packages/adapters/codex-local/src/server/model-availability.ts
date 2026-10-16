/**
 * Account-scoped Codex catalog validation shared by the adapter and server.
 *
 * A `model/list` catalog is a CLI picker catalog, not an entitlement check.
 * It is still the only supported source for choosing the client's inherited
 * default; the selected model can fail at inference time and that error must be
 * surfaced without switching authentication or billing modes.
 */

export type CodexModelAuthMode = "subscription" | "chatgpt" | "apikey";

export interface CodexModelCatalogIdentity {
  companyId: string;
  /** The managed CODEX_HOME path used for this catalog. */
  authHome: string;
  /** Opaque value that changes when credentials are replaced or re-authenticated. */
  authGeneration: string;
  authMode: CodexModelAuthMode;
  /** Exact version reported by this executable's `codex --version`. */
  cliVersion: string;
}

export interface CodexCatalogModel {
  id: string;
  displayName?: string;
  isDefault: boolean;
  hidden?: boolean;
  /** True when Codex reports that the model's retirement time has passed. */
  retired?: boolean;
}

export interface CodexModelCatalog {
  identity: CodexModelCatalogIdentity;
  models: CodexCatalogModel[];
}

export type CodexModelAvailabilityErrorCode =
  | "catalog_required"
  | "catalog_unavailable"
  | "catalog_identity_mismatch"
  | "catalog_default_missing"
  | "model_identifier_invalid"
  | "model_unavailable"
  | "model_auth_mode_incompatible";

export class CodexModelAvailabilityError extends Error {
  readonly code: CodexModelAvailabilityErrorCode;

  constructor(code: CodexModelAvailabilityErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodexModelAvailabilityError";
    this.code = code;
  }
}

const SAFE_MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const OPENAI_CODEX_FAMILY_RE = /^(gpt-|o\d|chatgpt|codex)/i;
// Codex's ChatGPT auth path has rejected GPT-Codex identifiers with HTTP 400.
// Keep this compatibility guard separate from syntax and catalog membership.
const SUBSCRIPTION_INCOMPATIBLE_RE = /codex/i;

export function isSafeCodexModelIdentifier(model: string): boolean {
  return SAFE_MODEL_RE.test(model) && OPENAI_CODEX_FAMILY_RE.test(model);
}

/** Known ChatGPT-login compatibility rule, separate from syntax and listing. */
export function isCodexCompatibleModel(model: string | null | undefined): boolean {
  return typeof model === "string" &&
    isSafeCodexModelIdentifier(model.trim()) &&
    !SUBSCRIPTION_INCOMPATIBLE_RE.test(model.trim());
}

function canonicalIdentity(identity: CodexModelCatalogIdentity): string {
  const home = identity.authHome.replace(/\\/g, "/");
  const normalizedHome = /^[a-z]:\//i.test(home) ? home.toLowerCase() : home;
  return JSON.stringify([
    identity.companyId,
    normalizedHome,
    identity.authGeneration,
    identity.authMode,
    identity.cliVersion,
  ]);
}

export function codexModelCatalogIdentityMatches(
  left: CodexModelCatalogIdentity,
  right: CodexModelCatalogIdentity,
): boolean {
  return canonicalIdentity(left) === canonicalIdentity(right);
}

export interface CodexModelCatalogCacheOptions {
  freshTtlMs?: number;
  staleTtlMs?: number;
}

/**
 * In-memory, account-scoped cache. A stale entry is usable only for the exact
 * same company, managed auth home, auth generation/mode and CLI version.
 */
export class CodexModelCatalogCache {
  private readonly freshTtlMs: number;
  private readonly staleTtlMs: number;
  private readonly entries = new Map<
    string,
    { catalog: CodexModelCatalog; fetchedAt: number }
  >();

  constructor(options: CodexModelCatalogCacheOptions = {}) {
    this.freshTtlMs = Math.max(0, options.freshTtlMs ?? 30_000);
    this.staleTtlMs = Math.max(this.freshTtlMs, options.staleTtlMs ?? 120_000);
  }

  async get(
    identity: CodexModelCatalogIdentity,
    load: () => Promise<CodexModelCatalog>,
    now = Date.now(),
  ): Promise<CodexModelCatalog> {
    const key = canonicalIdentity(identity);
    const existing = this.entries.get(key);
    if (existing && now - existing.fetchedAt <= this.freshTtlMs) {
      return existing.catalog;
    }

    try {
      const loaded = await load();
      if (!codexModelCatalogIdentityMatches(loaded.identity, identity)) {
        throw new CodexModelAvailabilityError(
          "catalog_identity_mismatch",
          "Codex model catalog came from a different account, auth home, or CLI version. Recheck Codex sign-in and retry.",
        );
      }
      this.entries.set(key, { catalog: loaded, fetchedAt: now });
      return loaded;
    } catch (err) {
      if (err instanceof CodexModelAvailabilityError && err.code === "catalog_identity_mismatch") {
        throw err;
      }
      if (existing && now - existing.fetchedAt <= this.staleTtlMs) {
        return existing.catalog;
      }
      throw new CodexModelAvailabilityError(
        "catalog_unavailable",
        "Could not read the model catalog for this Codex login. Check Codex sign-in and CLI version, then retry; no API-key fallback was attempted.",
        { cause: err },
      );
    }
  }

  clear(identity?: CodexModelCatalogIdentity): void {
    if (identity) this.entries.delete(canonicalIdentity(identity));
    else this.entries.clear();
  }
}

/**
 * Resolve an explicit selection or inherited default against one exact CLI
 * catalog. A non-empty agent selection is treated as explicit because the
 * persisted config has no reliable provenance marker; it is never rewritten.
 */
export function resolveCodexChatModel(
  configModel: string | null | undefined,
  sharedModel: string | null | undefined,
  catalog: CodexModelCatalog | null | undefined,
  expectedIdentity?: CodexModelCatalogIdentity,
): string {
  if (!catalog) {
    throw new CodexModelAvailabilityError(
      "catalog_required",
      "Codex could not resolve a model because its signed-in model catalog is unavailable. Verify Codex sign-in and retry.",
    );
  }
  if (expectedIdentity && !codexModelCatalogIdentityMatches(catalog.identity, expectedIdentity)) {
    throw new CodexModelAvailabilityError(
      "catalog_identity_mismatch",
      "Codex model catalog does not match the active account, managed auth home, or pinned CLI version. Refresh the login/catalog and retry.",
    );
  }

  const authMode = catalog.identity.authMode;
  const resolveCandidate = (candidate: string, explicit: boolean): string | null => {
    const id = candidate.trim();
    if (!isSafeCodexModelIdentifier(id)) {
      if (explicit) {
        throw new CodexModelAvailabilityError(
          "model_identifier_invalid",
          `The configured Codex model "${candidate}" is not a valid Codex model identifier. Choose a model from the Codex model list.`,
        );
      }
      return null;
    }
    if (authMode !== "apikey" && SUBSCRIPTION_INCOMPATIBLE_RE.test(id)) {
      if (explicit) {
        throw new CodexModelAvailabilityError(
          "model_auth_mode_incompatible",
          `The configured Codex model "${id}" requires API-key auth and cannot run with this ChatGPT subscription login. Choose a subscription-compatible model or configure API-key auth explicitly.`,
        );
      }
      return null;
    }
    const listed = catalog.models.find((model) => model.id === id);
    if (!listed || listed.retired || listed.hidden) {
      if (explicit) {
        throw new CodexModelAvailabilityError(
          "model_unavailable",
          `The configured Codex model "${id}" is not available in this login's current CLI catalog. Select a listed model or clear the model override to inherit the account default.`,
        );
      }
      return null;
    }
    return id;
  };

  const explicit = typeof configModel === "string" && configModel.trim().length > 0;
  if (explicit) {
    return resolveCandidate(configModel!.trim(), true)!;
  }

  if (typeof sharedModel === "string" && sharedModel.trim().length > 0) {
    // The shared user config is only an inherited preference, not a saved
    // AoA agent/company selection. If it is stale or incompatible with this
    // account, use the exact account default; nonblank agent config remains
    // explicit and is refused above rather than rewritten.
    const inherited = resolveCandidate(sharedModel.trim(), false);
    if (inherited) return inherited;
  }

  const defaults = catalog.models.filter(
    (model) => model.isDefault && !model.hidden && !model.retired,
  );
  if (defaults.length !== 1 || !isSafeCodexModelIdentifier(defaults[0]!.id)) {
    throw new CodexModelAvailabilityError(
      "catalog_default_missing",
      "The active Codex CLI catalog did not provide one safe default model. Update or sign in to the pinned Codex CLI, then retry.",
    );
  }
  if (authMode !== "apikey" && SUBSCRIPTION_INCOMPATIBLE_RE.test(defaults[0]!.id)) {
    throw new CodexModelAvailabilityError(
      "catalog_default_missing",
      "The active Codex CLI catalog default is incompatible with ChatGPT subscription auth. Update or sign in to the pinned Codex CLI, then retry.",
    );
  }
  return defaults[0]!.id;
}

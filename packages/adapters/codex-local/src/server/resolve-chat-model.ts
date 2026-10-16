/** Package-local facade over the account/catalog-aware resolver. */
import {
  isSafeCodexModelIdentifier,
  resolveCodexChatModel as resolveFromCatalog,
  type CodexModelCatalog,
  type CodexModelCatalogIdentity,
} from "./model-availability.js";

/** ChatGPT/subscription auth rejects the known GPT-Codex API-only variants. */
export function isCodexCompatibleModel(model: string | null | undefined): boolean {
  return typeof model === "string" &&
    isSafeCodexModelIdentifier(model.trim()) &&
    !/codex/i.test(model.trim());
}

/**
 * Resolve only against an account-scoped CLI catalog. The optional arguments
 * preserve the historic call shape during migration; omitting the catalog now
 * fails closed instead of reviving a hardcoded model slug.
 */
export function resolveCodexChatModel(
  configModel: string | null | undefined,
  sharedModel: string | null | undefined,
  catalog?: CodexModelCatalog | null,
  expectedIdentity?: CodexModelCatalogIdentity,
): string {
  return resolveFromCatalog(configModel, sharedModel, catalog, expectedIdentity);
}

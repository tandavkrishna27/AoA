import type { CodexModelCatalog } from "../model-availability.js";
import type { CodexModelCatalogRequest } from "../model-catalog.js";

export function testModelCatalog(request: CodexModelCatalogRequest): CodexModelCatalog {
  const authMode = request.env.OPENAI_API_KEY || request.env.CODEX_API_KEY
    ? "apikey"
    : "subscription";
  return {
    identity: {
      companyId: request.companyId,
      authHome: request.authHome,
      authGeneration: "test-auth-generation",
      authMode,
      cliVersion: "0.145.0",
    },
    models: [
      { id: authMode === "apikey" ? "gpt-5.3-codex" : "gpt-account-default", isDefault: true },
      { id: "gpt-account-default", isDefault: false },
      { id: "gpt-4o", isDefault: false },
      // Codex can list this in subscription mode; the resolver must still apply
      // the known auth-mode compatibility rule.
      { id: "gpt-5.3-codex", isDefault: false },
    ],
  };
}

export async function testModelCatalogLoader(request: CodexModelCatalogRequest): Promise<CodexModelCatalog> {
  return testModelCatalog(request);
}

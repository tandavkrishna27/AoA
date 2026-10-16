import { describe, expect, it } from "vitest";
import {
  CodexModelAvailabilityError,
  CodexModelCatalogCache,
  resolveCodexChatModel,
  type CodexModelCatalog,
  type CodexModelCatalogIdentity,
} from "../model-availability.js";

const identity: CodexModelCatalogIdentity = {
  companyId: "company-a",
  authHome: "C:/codex/company-a",
  authGeneration: "auth-generation-1",
  authMode: "subscription",
  cliVersion: "0.145.0",
};

function catalog(
  models: CodexModelCatalog["models"] = [
    { id: "gpt-account-current", displayName: "Current account default", isDefault: true },
    { id: "gpt-account-secondary", displayName: "Secondary", isDefault: false },
  ],
  catalogIdentity: CodexModelCatalogIdentity = identity,
): CodexModelCatalog {
  return { identity: catalogIdentity, models };
}

describe("resolveCodexChatModel account availability", () => {
  it("resolves an empty/inherited setting from the signed-in account default", () => {
    expect(resolveCodexChatModel(null, null, catalog())).toBe("gpt-account-current");
  });

  it("refuses a saved retired default instead of silently rewriting its unknown provenance", () => {
    expect(() => resolveCodexChatModel("gpt-retired-default", null, catalog())).toThrow(
      expect.objectContaining({ code: "model_unavailable" }),
    );
  });

  it("preserves an explicit model when the signed-in account catalog contains it", () => {
    expect(resolveCodexChatModel("gpt-account-secondary", null, catalog())).toBe(
      "gpt-account-secondary",
    );
  });

  it("refuses the known API-key-only Codex variant under subscription auth even if listed", () => {
    const apiOnly = "gpt-5.3-codex";
    const subscriptionCatalog = catalog([
      { id: "gpt-account-current", displayName: "Current account default", isDefault: true },
      { id: apiOnly, displayName: "Codex API model", isDefault: false },
    ]);
    expect(() => resolveCodexChatModel(apiOnly, null, subscriptionCatalog)).toThrow(
      expect.objectContaining({ code: "model_auth_mode_incompatible" }),
    );
  });

  it("refuses an explicit model absent from the current catalog with an actionable error", () => {
    expect(() => resolveCodexChatModel("gpt-retired-model", null, catalog())).toThrow(
      expect.objectContaining({ code: "model_unavailable" }),
    );
  });

  it("uses the account default if the inherited shared Codex preference is retired", () => {
    expect(resolveCodexChatModel(null, "gpt-retired-shared-default", catalog())).toBe(
      "gpt-account-current",
    );
  });

  it("refuses when the catalog is absent or has no default instead of guessing a model id", () => {
    expect(() => resolveCodexChatModel(null, null, null)).toThrow(CodexModelAvailabilityError);
    expect(() => resolveCodexChatModel(null, null, catalog([]))).toThrow(
      expect.objectContaining({ code: "catalog_default_missing" }),
    );
  });

  it("rejects malformed identifiers before they can reach the CLI", () => {
    expect(() => resolveCodexChatModel("gpt-account-default && calc.exe", null, catalog())).toThrow(
      expect.objectContaining({ code: "model_identifier_invalid" }),
    );
  });

  it("refuses a catalog produced by a different CLI pin", () => {
    const oldCatalog = catalog(undefined, { ...identity, cliVersion: "0.130.0" });
    expect(() =>
      resolveCodexChatModel("gpt-account-secondary", null, oldCatalog, {
        ...identity,
        cliVersion: "0.145.0",
      }),
    ).toThrow(expect.objectContaining({ code: "catalog_identity_mismatch" }));
  });
});

describe("CodexModelCatalogCache", () => {
  it("uses a bounded same-account catalog on outage, but refuses when no cache exists", async () => {
    const cache = new CodexModelCatalogCache({ freshTtlMs: 10, staleTtlMs: 100 });
    const original = catalog();
    await expect(
      cache.get(identity, async () => original, 1_000),
    ).resolves.toEqual(original);
    await expect(
      cache.get(identity, async () => {
        throw new Error("catalog unavailable");
      }, 1_020),
    ).resolves.toEqual(original);

    const uncached = new CodexModelCatalogCache({ freshTtlMs: 10, staleTtlMs: 100 });
    await expect(
      uncached.get(identity, async () => {
        throw new Error("catalog unavailable");
      }, 1_000),
    ).rejects.toThrow(CodexModelAvailabilityError);
  });

  it("does not share availability across companies, auth homes, account changes, or CLI pins", async () => {
    const cache = new CodexModelCatalogCache({ freshTtlMs: 100, staleTtlMs: 100 });
    const original = catalog();
    const calls: string[] = [];
    await cache.get(identity, async () => original, 1_000);

    const changedIdentities: CodexModelCatalogIdentity[] = [
      { ...identity, companyId: "company-b" },
      { ...identity, authHome: "C:/codex/company-b" },
      { ...identity, authGeneration: "auth-generation-2" },
      { ...identity, cliVersion: "0.154.0" },
    ];
    for (const changed of changedIdentities) {
      await expect(
        cache.get(changed, async () => {
          calls.push(changed.companyId + changed.authHome + changed.authGeneration + changed.cliVersion);
          throw new Error("catalog unavailable");
        }, 1_001),
      ).rejects.toThrow(CodexModelAvailabilityError);
    }
    expect(calls).toHaveLength(changedIdentities.length);
  });

  it("expires an outage fallback after the stale window", async () => {
    const cache = new CodexModelCatalogCache({ freshTtlMs: 10, staleTtlMs: 20 });
    await cache.get(identity, async () => catalog(), 1_000);
    await expect(
      cache.get(identity, async () => {
        throw new Error("catalog unavailable");
      }, 1_031),
    ).rejects.toThrow(CodexModelAvailabilityError);
  });
});

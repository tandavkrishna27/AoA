import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommanderWarmCanaryVault, mergeCommanderWarmCanaries } from "../services/commander-warm-canaries.js";
const state = { organizationId: "org-a", companyId: "company-a", userId: "user-a", conversationId: "conversation-a", id: "session-a", generation: 1 };
afterEach(() => vi.unstubAllEnvs());
function vault() { vi.stubEnv("AOA_SECRETS_MASTER_KEY", "a1".repeat(32)); return createCommanderWarmCanaryVault(); }
describe("encrypted durable warm redaction history", () => {
  it("persists only encrypted material and reopens old keys in the same session after a new vault instance", async () => {
    const one = vault(); const material = await one.seal(state, ["old-private-key"]);
    expect(JSON.stringify(material)).not.toContain("old-private-key");
    expect(await createCommanderWarmCanaryVault().open({ ...state, generation: 2 }, material)).toEqual(["old-private-key"]);
    expect(await one.seal(state, ["old-private-key"])).not.toEqual(material);
  });
  it.each(["organizationId", "companyId", "userId", "conversationId", "id"] as const)("refuses history substituted from another %s", async (key) => {
    const one = vault(); const material = await one.seal(state, ["old-private-key"]);
    await expect(one.open({ ...state, [key]: "other" }, material)).rejects.toThrow("Commander warm redaction history unavailable");
  });
  it("refuses future-generation history and modified authenticated ciphertext without exposing it", async () => {
    const one = vault(); const material = await one.seal({ ...state, generation: 2 }, ["private-key"]);
    await expect(one.open(state, material)).rejects.toThrow("Commander warm redaction history unavailable");
    await expect(one.open({ ...state, generation: 2 }, { ...material, ciphertext: (material.ciphertext[0] === "a" ? "b" : "a") + material.ciphertext.slice(1) })).rejects.toThrow("Commander warm redaction history unavailable");
  });
  it("deduplicates and bounds the complete history before encryption", async () => {
    const one = vault(); expect(mergeCommanderWarmCanaries(["old", "old"], ["current", "old"])).toEqual(["old", "current"]);
    await expect(one.seal(state, Array.from({ length: 65 }, (_, index) => "key-" + index))).rejects.toThrow();
    await expect(one.seal(state, ["x".repeat(65537)])).rejects.toThrow();
    await expect(one.seal(state, [""])).rejects.toThrow();
  });
});

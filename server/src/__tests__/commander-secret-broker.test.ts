import { describe, expect, it, vi } from "vitest";
import { resolveCommanderConnectionSecret, resolveCommanderRunJwtValue } from "../services/commander-secret-broker.js";
const connectionId = "b2000000-0000-4000-8000-000000000001";
const authority = { companyId: "company", jobId: "job", turnId: "turn", userId: "user", userRole: "team_member", conversationId: "conversation", connectionId, secretId: "secret" };
describe("Commander at-use broker", () => {
  it("rechecks the exact live connection before resolving its secret", async () => {
    const load = vi.fn(async () => authority); const value = vi.fn(async () => "fake-secret");
    await expect(resolveCommanderConnectionSecret({ load, value }, { companyId: "company", handleId: "handle", refId: "secret", refVersion: `commander-connection:${connectionId}` })).resolves.toBe("fake-secret");
    expect(value).toHaveBeenCalledWith(authority);
  });
  it.each([null, { ...authority, connectionId: "other" }, { ...authority, secretId: "other" }, { ...authority, companyId: "other" }])("denies stale or crossed connection authority before reading any value", async (row) => {
    const value = vi.fn();
    await expect(resolveCommanderConnectionSecret({ load: async () => row, value }, { companyId: "company", handleId: "handle", refId: "secret", refVersion: `commander-connection:${connectionId}` })).rejects.toThrow();
    expect(value).not.toHaveBeenCalled();
  });
  it("mints the distinct Commander identity with the actual user, role, conversation and turn", async () => {
    const mint = vi.fn(() => "fake-commander-jwt");
    await expect(resolveCommanderRunJwtValue({ load: async () => authority, mint }, { companyId: "company", jobId: "job", ownerPrincipalId: "turn" })).resolves.toBe("fake-commander-jwt");
    expect(mint).toHaveBeenCalledWith({ companyId: "company", userId: "user", userRole: "team_member", conversationId: "conversation", turnId: "turn" });
    expect(mint.mock.calls[0]![0]).not.toHaveProperty("agentId");
  });
  it.each([null, { ...authority, turnId: "other" }, { ...authority, companyId: "other" }, { ...authority, jobId: "other" }])("never mints a JWT with missing or crossed run authority", async (row) => {
    const mint = vi.fn();
    await expect(resolveCommanderRunJwtValue({ load: async () => row, mint }, { companyId: "company", jobId: "job", ownerPrincipalId: "turn" })).rejects.toThrow();
    expect(mint).not.toHaveBeenCalled();
  });
});

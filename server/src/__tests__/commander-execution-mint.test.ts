import { describe, expect, it, vi } from "vitest";
import { mintExecutionSecretHandleForPlacement, mintRunJwtHandleForPlacement } from "../services/execution-secret-handle-mint-runner.js";
const turnId = "b1000000-0000-4000-8000-000000000001";
const connectionId = "b2000000-0000-4000-8000-000000000001";
const secretId = "b3000000-0000-4000-8000-000000000001";
const base = { companyId: "company", organizationId: "org", jobId: "job", deploymentMode: "cloud_auth", executorPrincipalKind: "sandbox", executorPrincipalId: turnId, placementOwner: "platform_managed_cloud", credentialKind: "company_api_key", targetGeneration: 1 };
const source = { sourceKind: "commander_turn", sourceIdentity: turnId, sourceIntent: { kind: "commander_turn", internalAgentRunId: turnId, conversationId: "b4000000-0000-4000-8000-000000000001" }, input: {} };
const credential = { connectionId, secretId, provider: "openai", adapterType: "codex_local" };
function repo() { return { loadAgentAdapterBinding: vi.fn(async () => null), insertExecutionSecretHandle: vi.fn(async (input) => ({ handle: input.handle, minted: true })) }; }
describe("Commander source-specific credential mint", () => {
  it("pins the actual authorized connection and secret, without an agent or company-default fallback", async () => {
    const r = repo();
    expect(await mintExecutionSecretHandleForPlacement(r, { ...base, jobSource: source, commanderCredential: credential })).toMatchObject({ minted: true, refKind: "company_secret" });
    expect(r.loadAgentAdapterBinding).not.toHaveBeenCalled();
    expect(r.insertExecutionSecretHandle).toHaveBeenCalledWith(expect.objectContaining({ refKind: "company_secret", refId: secretId,
      refVersion: `commander-connection:${connectionId}`, envTarget: "OPENAI_API_KEY", ownerPrincipalId: turnId }));
  });
  it.each([
    { commanderCredential: undefined }, { commanderCredential: { ...credential, provider: "anthropic" } },
    { executorPrincipalId: "other" }, { executorPrincipalKind: "worker" },
    { commanderCredential: { ...credential, connectionId: "-".repeat(36) } },
    { commanderCredential: { ...credential, secretId: "a".repeat(36) } },
    { jobSource: { ...source, sourceIdentity: "other" } },
  ])("refuses incomplete source/credential authority %j", async (change) => {
    const r = repo();
    expect(await mintExecutionSecretHandleForPlacement(r, { ...base, jobSource: source, commanderCredential: credential, ...change })).toMatchObject({ minted: false });
    expect(r.loadAgentAdapterBinding).not.toHaveBeenCalled(); expect(r.insertExecutionSecretHandle).not.toHaveBeenCalled();
  });
  it("mints a Commander tool handle bound to the actual turn, without loading a fake agent", async () => {
    const r = repo();
    expect(await mintRunJwtHandleForPlacement(r, { ...base, jobSource: source, commanderCredential: { ...credential, provider: "anthropic", adapterType: "claude_local" }, toolSurfaceAuthorized: true })).toMatchObject({ minted: true });
    expect(r.loadAgentAdapterBinding).not.toHaveBeenCalled();
    expect(r.insertExecutionSecretHandle).toHaveBeenCalledWith(expect.objectContaining({ refKind: "run_jwt", refId: "job", ownerPrincipalId: turnId, envTarget: "AOA_API_KEY" }));
  });
});

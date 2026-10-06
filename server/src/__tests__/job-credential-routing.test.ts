import { describe, expect, it, vi } from "vitest";
import type { CandidateRow } from "../services/provider-resolution.js";
import { createJobCredentialRoutingResolver } from "../services/job-credential-routing.js";
import { CANARY_CREDENTIAL_BINDING } from "../services/canary-credential-binding.js";

const request = { organizationId: "org", companyId: "company", jobId: "job", sourceKind: "commander_turn" as const };
const source = { userId: "founder", provider: "openai", adapterType: "codex_local" };
const row: CandidateRow = {
  connectionId: "connection", authMethod: "personal_subscription",
  scopeType: "personal_execution_default", scopeId: "founder", priority: 1,
  connectionUpdatedAt: 1, state: "verified", termsAttestedAt: new Date(),
  sharingPolicy: "owner_only", connectionCompanyId: "company", connectionOrganizationId: "org",
  connectionOwnerUserId: "founder", executionTargetId: "founder-desktop", config: {}, secretRef: null,
};
function setup(rows: CandidateRow[] = [row]) {
  const deps = {
    loadCommanderSource: vi.fn(async () => source),
    loadCandidates: vi.fn(async () => rows),
    ownerMembershipActive: vi.fn(async () => true),
  };
  return { deps, resolve: createJobCredentialRoutingResolver(deps) };
}

describe("trusted job credential routing", () => {
  it.each(["task_run", "crew_run"] as const)("preserves %s canary binding and never reads metadata", async (sourceKind) => {
    const { deps, resolve } = setup();
    expect(await resolve({ ...request, sourceKind })).toEqual(CANARY_CREDENTIAL_BINDING);
    expect(deps.loadCommanderSource).not.toHaveBeenCalled();
    expect(deps.loadCandidates).not.toHaveBeenCalled();
  });
  it("uses the durable Commander user and connection owner, without materializing secrets", async () => {
    const { deps, resolve } = setup();
    expect(await resolve(request)).toEqual({
      credentialId: "connection", credentialKind: "personal_subscription",
      executionTargetSlug: "founder-desktop", pinnedTargetId: null,
      credentialOwnerPrincipalId: "founder",
    });
    expect(deps.loadCandidates).toHaveBeenCalledWith(request, source);
    expect(deps.ownerMembershipActive).toHaveBeenCalledWith("company", "founder");
  });
  it.each([
    { connectionCompanyId: "foreign" }, { connectionOrganizationId: "foreign" },
    { connectionOwnerUserId: "other" }, { scopeId: "other" },
    { state: "revoked" }, { termsAttestedAt: null }, { executionTargetId: null },
  ])("refuses unusable metadata %j", async (change) => {
    const { resolve } = setup([{ ...row, ...change }]);
    await expect(resolve(request)).rejects.toMatchObject({ code: "provider_unavailable" });
  });
  it("refuses a suspended owner", async () => {
    const { deps, resolve } = setup();
    deps.ownerMembershipActive.mockResolvedValue(false);
    await expect(resolve(request)).rejects.toMatchObject({ code: "provider_unavailable" });
  });
  it("refuses ambiguous equally ranked personal bindings", async () => {
    const { resolve } = setup([row, { ...row, connectionId: "second" }]);
    await expect(resolve(request)).rejects.toMatchObject({ code: "provider_unavailable" });
  });
  it("uses company assignment precedence without reading secret values", async () => {
    const { resolve } = setup([{ ...row, authMethod: "api_key", scopeType: "company_default",
      scopeId: null, sharingPolicy: "company_agents", secretRef: "vault-reference", executionTargetId: null }]);
    expect(await resolve(request)).toEqual({ credentialId: "connection", credentialKind: "company_api_key",
      executionTargetSlug: "aoa-canary-e2b", pinnedTargetId: null,
      commanderCredential: { connectionId: "connection", secretId: "vault-reference", provider: "openai", adapterType: "codex_local" } });
  });
  it("refuses unsupported sources before any authority read", async () => {
    const { deps, resolve } = setup();
    await expect(resolve({ ...request, sourceKind: "browser_request" })).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(deps.loadCommanderSource).not.toHaveBeenCalled();
  });
  it("refuses Commander agent overrides instead of borrowing a crew identity", async () => {
    const { resolve } = setup([{ ...row, scopeType: "agent_override", scopeId: "some-agent" }]);
    await expect(resolve(request)).rejects.toMatchObject({ code: "provider_unavailable" });
  });
  it("refuses a missing or mismatched durable source", async () => {
    const { deps, resolve } = setup();
    deps.loadCommanderSource.mockResolvedValue(null as never);
    await expect(resolve(request)).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(deps.loadCandidates).not.toHaveBeenCalled();
  });
});

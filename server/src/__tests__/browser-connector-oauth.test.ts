import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@armyofagents/db";
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  get: vi.fn(),
  token: vi.fn(),
  policy: vi.fn(),
  blocked: vi.fn(),
}));
vi.mock("../services/secrets.js", () => ({
  secretService: () => ({ resolveByName: mocks.resolve, getByName: mocks.get }),
}));
vi.mock("../services/mcp-connector-token-refresh.js", () => ({
  resolveConnectorToken: mocks.token,
  createDbRefreshLeaseStore: () => ({}),
  createDbRefreshCommitter: () => vi.fn(),
}));
vi.mock("../services/mcp-connector-oauth-policy.js", () => ({
  requireOAuthProviderPolicy: mocks.policy,
}));
vi.mock("../services/mcp-connector-emergency-policy.js", () => ({
  isMcpConnectorBlocked: mocks.blocked,
}));
vi.mock("../services/mcp-connector-consent.js", () => ({
  resolveConsentSecret: () => "s".repeat(64),
}));
import {
  createBrowserConnectorOAuthResolver,
  assertBrowserConnectorCurrent,
} from "../services/browser-connector-oauth.js";
const connector = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  status: "active",
  source: "catalog",
  serverName: "test-connector",
  catalogEntryId: "catalog-entry",
  oauthPolicyVersion: 1,
  secretRef: "mcp:oauth:11111111-1111-4111-8111-111111111111",
  transport: "http", url: "https://mcp.notion.com/mcp",
};
const scope = {
  companyId: connector.companyId,
  connectorId: connector.id,
  agentId: "33333333-3333-4333-8333-333333333333",
};
let current: any;
let db: Db;
beforeEach(() => {
  vi.clearAllMocks();
  current = { ...connector };
  const chain = {
    $dynamic: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => Promise.resolve(current ? [{ ...current }] : []),
  };
  db = { select: () => chain } as unknown as Db;
  mocks.policy.mockReturnValue({
    resourceUrl: "https://mcp.notion.com/mcp", entryId: connector.catalogEntryId,
    version: 1,
  });
  mocks.blocked.mockReturnValue(false);
  mocks.resolve.mockResolvedValue("encrypted-oauth-bundle");
  mocks.token.mockImplementation(async (deps: any) => {
    await deps.assertRefreshAllowed();
    return "resolved-access-token";
  });
});
describe("browser CP connector OAuth composition", () => {
  it("resolves Commander company connector authority without an agent grant", async () => {
    expect(await createBrowserConnectorOAuthResolver(db)({ companyId: scope.companyId, connectorId: scope.connectorId, userId: "human-owner", origin: "https://mcp.notion.com", assertAuthorityCurrent: async () => {} })).toBe("resolved-access-token");
    await assertBrowserConnectorCurrent(db, { companyId: scope.companyId, connectorId: scope.connectorId, userId: "human-owner", origin: "https://mcp.notion.com" });
  });
  it("refuses mixed human and agent identities before reading a secret", async () => {
    await expect(createBrowserConnectorOAuthResolver(db)({ ...scope, userId: "human-owner", origin: "https://mcp.notion.com" } as any)).rejects.toThrow();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("refuses a human origin outside the connector OAuth resource", async () => {
    await expect(createBrowserConnectorOAuthResolver(db)({companyId:scope.companyId,connectorId:scope.connectorId,userId:'human-owner',origin:'https://other.example',assertAuthorityCurrent:async()=>{}})).rejects.toThrow();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("requires a trusted live parent/fence recheck before resolving human credentials", async () => {
    await expect(createBrowserConnectorOAuthResolver(db)({companyId:scope.companyId,connectorId:scope.connectorId,userId:'human-owner',origin:'https://mcp.notion.com'})).rejects.toThrow();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("rechecks human parent authority before token refresh", async () => {
    const assertAuthorityCurrent=vi.fn().mockRejectedValue(new Error('lost parent'));
    await expect(createBrowserConnectorOAuthResolver(db)({companyId:scope.companyId,connectorId:scope.connectorId,userId:'human-owner',origin:'https://mcp.notion.com',assertAuthorityCurrent})).rejects.toThrow();
    expect(assertAuthorityCurrent).toHaveBeenCalled(); expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("uses owner-bound secret access and existing refresh leases/committer, returning only access token", async () => {
    expect(await createBrowserConnectorOAuthResolver(db)(scope)).toBe(
      "resolved-access-token"
    );
    expect(mocks.resolve).toHaveBeenCalledWith(
      scope.companyId,
      connector.secretRef,
      expect.objectContaining({
        consumerType: "system",
        consumerId: "browser-session-broker",
        mcpOAuthOwner: {
          connectorId: connector.id,
          catalogEntryId: connector.catalogEntryId,
          oauthPolicyVersion: 1,
        },
      })
    );
    expect(mocks.token).toHaveBeenCalledWith(
      expect.objectContaining({
        leases: {},
        commitRefresh: expect.any(Function),
        assertRefreshAllowed: expect.any(Function),
      }),
      expect.objectContaining({
        companyId: scope.companyId,
        connectorId: scope.connectorId,
      }),
      "encrypted-oauth-bundle"
    );
  });
  it("rechecks opt-in/connector authority immediately before refresh", async () => {
    mocks.token.mockImplementation(async (deps: any) => {
      current = null;
      await deps.assertRefreshAllowed();
      return "must-not-return";
    });
    await expect(
      createBrowserConnectorOAuthResolver(db)(scope)
    ).rejects.toThrow("authority changed");
  });
  it.each([
    "disabled",
    "missing",
    "emergency",
    "secret-pointer",
    "policy-version",
  ])("refuses %s without resolving a token", async (fault) => {
    if (fault === "disabled") current.status = "disabled";
    if (fault === "missing") current = null;
    if (fault === "emergency") mocks.blocked.mockReturnValue(true);
    if (fault === "secret-pointer") current.secretRef = "other-secret";
    if (fault === "policy-version") current.oauthPolicyVersion = null;
    await expect(
      createBrowserConnectorOAuthResolver(db)(scope)
    ).rejects.toThrow();
    expect(mocks.resolve).not.toHaveBeenCalled();
    await expect(assertBrowserConnectorCurrent(db, scope)).rejects.toThrow();
  });
});

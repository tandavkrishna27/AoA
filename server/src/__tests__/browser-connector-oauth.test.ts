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
    from: () => chain,
    innerJoin: () => chain,
    where: () => Promise.resolve(current ? [{ ...current }] : []),
  };
  db = { select: () => chain } as unknown as Db;
  mocks.policy.mockReturnValue({
    entryId: connector.catalogEntryId,
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

import { and, eq, inArray } from "drizzle-orm";
import {
  companyMcpConnectors,
  companyMcpConnectorAgents,
  companies, companyMemberships, organizationMemberships,
  type Db,
} from "@armyofagents/db";
import { secretService } from "./secrets.js";
import { requireOAuthProviderPolicy } from "./mcp-connector-oauth-policy.js";
import { isMcpConnectorBlocked } from "./mcp-connector-emergency-policy.js";
import { deriveOAuthBundleKey } from "./mcp-connector-oauth-bundle.js";
import { resolveConsentSecret } from "./mcp-connector-consent.js";
import {
  createDbRefreshCommitter,
  createDbRefreshLeaseStore,
  resolveConnectorToken,
} from "./mcp-connector-token-refresh.js";

export type BrowserConnectorScope = { companyId: string; connectorId: string } &
  ({ agentId: string; userId?: never } | { userId: string; origin: string; agentId?: never }) & { assertAuthorityCurrent?: () => Promise<void> };

async function readConnector(db: Db, input: BrowserConnectorScope) {
  if (Boolean(input.agentId) === Boolean(input.userId)) throw new Error("browser connector principal unavailable");
  let query = db.select({ id: companyMcpConnectors.id, companyId: companyMcpConnectors.companyId,
    status: companyMcpConnectors.status, source: companyMcpConnectors.source, serverName: companyMcpConnectors.serverName,
    catalogEntryId: companyMcpConnectors.catalogEntryId, oauthPolicyVersion: companyMcpConnectors.oauthPolicyVersion,
    transport: companyMcpConnectors.transport, url: companyMcpConnectors.url,
    secretRef: companyMcpConnectors.secretRef }).from(companyMcpConnectors).$dynamic();
  if (input.userId) {
    query = query.innerJoin(companies, eq(companies.id, companyMcpConnectors.companyId))
      .innerJoin(companyMemberships, and(eq(companyMemberships.companyId, input.companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, input.userId), eq(companyMemberships.status, "active")))
      .innerJoin(organizationMemberships, and(eq(organizationMemberships.organizationId, companies.organizationId), eq(organizationMemberships.userId, input.userId), eq(organizationMemberships.status, "active"), inArray(organizationMemberships.role, ["owner", "admin", "member"])));
  } else {
    query = query.innerJoin(companyMcpConnectorAgents, and(eq(companyMcpConnectorAgents.connectorId, companyMcpConnectors.id), eq(companyMcpConnectorAgents.companyId, input.companyId), eq(companyMcpConnectorAgents.agentId, input.agentId!)));
  }
  return query.where(and(eq(companyMcpConnectors.id, input.connectorId), eq(companyMcpConnectors.companyId, input.companyId))).then(rows => rows[0]);
}

export async function assertBrowserConnectorCurrent(
  db: Db,
  input: BrowserConnectorScope
) {
  const connector = await readConnector(db, input);
  if (
    !connector ||
    connector.status !== "active" ||
    connector.source !== "catalog" ||
    !connector.catalogEntryId ||
    !connector.oauthPolicyVersion ||
    connector.secretRef !== `mcp:oauth:${input.connectorId}` ||
    isMcpConnectorBlocked(connector.serverName)
  )
    throw new Error("browser connector authority unavailable");
  const policy = requireOAuthProviderPolicy(
    connector.catalogEntryId,
    connector.oauthPolicyVersion
  );
  if (input.userId && (input.origin !== new URL(policy.resourceUrl).origin || connector.transport !== "http" || connector.url !== policy.resourceUrl)) throw new Error("browser connector origin refused");
}

/** CP-only connector OAuth broker. The generic sandbox-local resolver remains
 * denied; this entrypoint is used only after scoped browser fence/permission checks. */
export function createBrowserConnectorOAuthResolver(db: Db) {
  return async (input: BrowserConnectorScope): Promise<string> => {
    if (input.userId && typeof input.assertAuthorityCurrent !== "function") throw new Error("browser human fence authority unavailable");
    const read = () => readConnector(db, input);
    const connector = await read();
    if (
      !connector ||
      connector.status !== "active" ||
      connector.source !== "catalog" ||
      !connector.catalogEntryId ||
      !connector.oauthPolicyVersion ||
      connector.secretRef !== `mcp:oauth:${connector.id}` ||
      isMcpConnectorBlocked(connector.serverName)
    )
      throw new Error("browser connector authority unavailable");
    const policy = requireOAuthProviderPolicy(
      connector.catalogEntryId,
      connector.oauthPolicyVersion
    );
    if (input.userId && (input.origin !== new URL(policy.resourceUrl).origin || connector.transport !== "http" || connector.url !== policy.resourceUrl)) throw new Error("browser connector origin refused");
    const assertRefreshAllowed = async () => {
      await input.assertAuthorityCurrent?.();
      const current = await read();
      if (
        !current ||
        current.status !== "active" ||
        current.source !== "catalog" ||
        current.secretRef !== connector.secretRef ||
        current.catalogEntryId !== policy.entryId ||
        current.oauthPolicyVersion !== policy.version ||
        current.serverName !== connector.serverName ||
        (input.userId && (current.transport !== connector.transport || current.url !== connector.url)) ||
        isMcpConnectorBlocked(current.serverName)
      )
        throw new Error("browser connector authority changed");
      requireOAuthProviderPolicy(
        current.catalogEntryId,
        current.oauthPolicyVersion
      );
    };
    const secrets = secretService(db),
      context = {
        companyId: input.companyId,
        connectorId: connector.id,
        catalogEntryId: policy.entryId,
        oauthPolicyVersion: policy.version,
        secretName: connector.secretRef,
        bundleKey: deriveOAuthBundleKey(resolveConsentSecret()),
        serverName: connector.serverName,
      };
    const consumer = {
      consumerType: "system" as const,
      consumerId: "browser-session-broker",
      actorType: "system" as const,
      configPath: `mcp.connector.${connector.serverName}`,
      mcpOAuthOwner: {
        connectorId: connector.id,
        catalogEntryId: policy.entryId,
        oauthPolicyVersion: policy.version,
      },
    };
    await assertRefreshAllowed();
    const raw = await secrets.resolveByName(
      input.companyId,
      connector.secretRef,
      consumer
    );
    return resolveConnectorToken(
      {
        secrets: {
          getByName: (company, name) => secrets.getByName(company, name),
          resolveByName: (company, name) =>
            secrets.resolveByName(company, name, consumer),
        },
        leases: createDbRefreshLeaseStore(db),
        commitRefresh: createDbRefreshCommitter(db, context),
        assertRefreshAllowed,
      },
      context,
      raw
    );
  };
}

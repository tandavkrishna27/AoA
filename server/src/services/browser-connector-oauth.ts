import { and, eq } from "drizzle-orm";
import {
  companyMcpConnectors,
  companyMcpConnectorAgents,
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

export async function assertBrowserConnectorCurrent(
  db: Db,
  input: { companyId: string; connectorId: string; agentId: string }
) {
  const [connector] = await db
    .select({
      status: companyMcpConnectors.status,
      source: companyMcpConnectors.source,
      serverName: companyMcpConnectors.serverName,
      catalogEntryId: companyMcpConnectors.catalogEntryId,
      oauthPolicyVersion: companyMcpConnectors.oauthPolicyVersion,
      secretRef: companyMcpConnectors.secretRef,
    })
    .from(companyMcpConnectors)
    .innerJoin(
      companyMcpConnectorAgents,
      and(
        eq(companyMcpConnectorAgents.connectorId, companyMcpConnectors.id),
        eq(companyMcpConnectorAgents.companyId, input.companyId),
        eq(companyMcpConnectorAgents.agentId, input.agentId)
      )
    )
    .where(
      and(
        eq(companyMcpConnectors.id, input.connectorId),
        eq(companyMcpConnectors.companyId, input.companyId)
      )
    );
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
  requireOAuthProviderPolicy(
    connector.catalogEntryId,
    connector.oauthPolicyVersion
  );
}

/** CP-only connector OAuth broker. The generic sandbox-local resolver remains
 * denied; this entrypoint is used only after scoped browser fence/permission checks. */
export function createBrowserConnectorOAuthResolver(db: Db) {
  return async (input: {
    companyId: string;
    connectorId: string;
    agentId: string;
  }): Promise<string> => {
    const read = async () =>
      db
        .select({
          id: companyMcpConnectors.id,
          companyId: companyMcpConnectors.companyId,
          status: companyMcpConnectors.status,
          source: companyMcpConnectors.source,
          serverName: companyMcpConnectors.serverName,
          catalogEntryId: companyMcpConnectors.catalogEntryId,
          oauthPolicyVersion: companyMcpConnectors.oauthPolicyVersion,
          secretRef: companyMcpConnectors.secretRef,
        })
        .from(companyMcpConnectors)
        .innerJoin(
          companyMcpConnectorAgents,
          and(
            eq(companyMcpConnectorAgents.connectorId, companyMcpConnectors.id),
            eq(companyMcpConnectorAgents.companyId, input.companyId),
            eq(companyMcpConnectorAgents.agentId, input.agentId)
          )
        )
        .where(
          and(
            eq(companyMcpConnectors.id, input.connectorId),
            eq(companyMcpConnectors.companyId, input.companyId)
          )
        )
        .then((rows) => rows[0]);
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
    const assertRefreshAllowed = async () => {
      const current = await read();
      if (
        !current ||
        current.status !== "active" ||
        current.source !== "catalog" ||
        current.secretRef !== connector.secretRef ||
        current.catalogEntryId !== policy.entryId ||
        current.oauthPolicyVersion !== policy.version ||
        current.serverName !== connector.serverName ||
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

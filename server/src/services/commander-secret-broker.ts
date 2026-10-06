import { and, eq } from "drizzle-orm";
import { jobSecretHandles, jobs, type Db } from "@armyofagents/db";
import { createCommanderRunJwt } from "../agent-auth-jwt.js";
import { loadConfig } from "../config.js";
import { COMMANDER_CONNECTION_SELECTOR } from "./commander-execution-credential.js";
import { loadCommanderJobAuthority } from "./commander-job-authority.js";
import { createDrizzleJobCredentialRoutingResolver } from "./job-credential-routing.js";
import { buildResolveDeps } from "./provider-resolution-deps.js";
import { resolveCliAuthTopology } from "./cli-auth-topology.js";
import type { ResolveArgs } from "./provider-resolution.js";

interface CommanderAuthority {
  companyId: string; jobId: string; turnId: string; userId: string; userRole: string; conversationId: string;
}
interface ConnectionAuthority extends CommanderAuthority { connectionId: string; secretId: string }
export async function resolveCommanderConnectionSecret<T extends ConnectionAuthority>(deps: {
  load(input: { companyId: string; handleId: string }): Promise<T | null>; value(authority: T): Promise<string>;
}, input: { companyId: string; handleId: string; refId: string; refVersion: string | null }): Promise<string> {
  const selected = input.refVersion?.startsWith(COMMANDER_CONNECTION_SELECTOR)
    ? input.refVersion.slice(COMMANDER_CONNECTION_SELECTOR.length) : null;
  if (!selected) throw new Error("Commander connection selector missing");
  const authority = await deps.load(input);
  if (!authority || authority.companyId !== input.companyId || authority.connectionId !== selected || authority.secretId !== input.refId) {
    throw new Error("Commander connection is no longer authorized");
  }
  const value = await deps.value(authority);
  if (!value) throw new Error("Commander connection credential unavailable");
  return value;
}
export async function resolveCommanderRunJwtValue(deps: {
  load(input: { companyId: string; jobId: string }): Promise<CommanderAuthority | null>;
  mint(input: { companyId: string; userId: string; userRole: string; conversationId: string; turnId: string }): string | null;
}, input: { companyId: string; jobId: string; ownerPrincipalId: string | null }): Promise<string> {
  const authority = await deps.load(input);
  if (!authority || authority.companyId !== input.companyId || authority.jobId !== input.jobId ||
    authority.turnId !== input.ownerPrincipalId) throw new Error("Commander run JWT authority mismatch");
  const jwt = deps.mint({ companyId: authority.companyId, userId: authority.userId, userRole: authority.userRole,
    conversationId: authority.conversationId, turnId: authority.turnId });
  if (!jwt) throw new Error("Commander run JWT signing unavailable");
  return jwt;
}

export function createCommanderExecutionBrokers(db: Db) {
  const topology = resolveCliAuthTopology(loadConfig());
  const routing = createDrizzleJobCredentialRoutingResolver(db, topology);
  const providers = buildResolveDeps(db, topology);
  const load = async (input: { companyId: string; jobId: string }) => {
    const authority = await loadCommanderJobAuthority(db, input);
    return authority?.executionOwner === "distributed" && authority.distributedJobId === input.jobId && authority.status === "running"
      ? authority : null;
  };
  return {
    resolveRunJwt: (input: { companyId: string; jobId: string; ownerPrincipalId: string | null }) =>
      resolveCommanderRunJwtValue({ load, mint: createCommanderRunJwt }, input),
    resolveConnectionSecret: (input: { companyId: string; handleId: string; refId: string; refVersion: string | null }) =>
      resolveCommanderConnectionSecret({
        async load({ companyId, handleId }) {
          const [rowHandle] = await db.select({ handle: jobSecretHandles }).from(jobSecretHandles)
            .innerJoin(jobs, and(eq(jobs.id, jobSecretHandles.jobId), eq(jobs.organizationId, jobSecretHandles.organizationId)))
            .where(and(eq(jobs.companyId, companyId), eq(jobSecretHandles.handle, handleId))).limit(1);
          const handle = rowHandle?.handle;
          if (!handle || handle.refKind !== "company_secret" || handle.refId !== input.refId || handle.refVersion !== input.refVersion) return null;
          const authority = await load({ companyId, jobId: handle.jobId });
          if (!authority || handle.ownerPrincipalKind !== "sandbox" || handle.ownerPrincipalId !== authority.turnId) return null;
          const binding = await routing({ companyId, organizationId: authority.organizationId, jobId: handle.jobId, sourceKind: "commander_turn" });
          const credential = binding.commanderCredential;
          if (!credential || binding.credentialKind !== "company_api_key") return null;
          const args: ResolveArgs = { companyId, organizationId: authority.organizationId, agentId: null,
            actorKind: "commander", adapterType: authority.adapterType, provider: authority.provider,
            executionTargetId: binding.executionTargetSlug ?? "", currentEnv: {},
            context: { actorType: "user", actorId: authority.userId, consumerType: "system", consumerId: authority.userId } };
          const row = (await providers.loadCandidateRows(db, args)).find((row) => row.connectionId === credential.connectionId && row.secretRef === credential.secretId);
          if (!row) return null;
          return { ...authority, connectionId: credential.connectionId, secretId: credential.secretId, row, args };
        },
        async value(authority) {
          return await providers.resolveSecretValueForConnection(db, authority.row, authority.args) ?? "";
        },
      }, input),
  };
}

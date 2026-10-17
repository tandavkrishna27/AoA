import type { Db } from "@armyofagents/db";
import { agents, internalAgentRuns } from "@armyofagents/db";
import { and, eq } from "drizzle-orm";
import { forbidden } from "../../errors.js";
import { deriveEnabledCapabilities } from "./aoa-agents/derive-capabilities.js";
import type { AgentTool, ToolContext } from "./types.js";

export interface CrewRunIdentity {
  companyId: string;
  agentId: string;
  runId: string;
}

export interface CrewToolAuthority {
  toolAllowlist: string[];
}

export async function resolveCrewRunAuthority(db: Db, identity: CrewRunIdentity): Promise<CrewToolAuthority | null> {
  if (!identity.companyId || !identity.agentId || !identity.runId) throw forbidden("Crew run is not authorized");
  const [agent] = await db.select().from(agents).where(and(
    eq(agents.id, identity.agentId), eq(agents.companyId, identity.companyId),
  )).limit(1);
  if (!agent || agent.id !== identity.agentId || agent.companyId !== identity.companyId) {
    throw forbidden("Crew run is not authorized");
  }
  if (agent.kind !== "aoa") return null;
  if (!["active", "idle", "running", "error"].includes(agent.status)) throw forbidden("Crew run is not authorized");
  const [run] = await db.select({
    id: internalAgentRuns.id, companyId: internalAgentRuns.companyId,
    agentId: internalAgentRuns.agentId, status: internalAgentRuns.status,
  }).from(internalAgentRuns).where(and(
    eq(internalAgentRuns.id, identity.runId), eq(internalAgentRuns.companyId, identity.companyId),
    eq(internalAgentRuns.agentId, identity.agentId),
  )).limit(1);
  if (!run || run.id !== identity.runId || run.companyId !== identity.companyId || run.agentId !== identity.agentId || run.status !== "running") {
    throw forbidden("Crew run is not authorized");
  }
  const runtimeConfig = (agent.runtimeConfig ?? {}) as Record<string, unknown>;
  const aoaConfig = (runtimeConfig.aoa ?? {}) as Record<string, unknown>;
  const toolAllowlist = Array.isArray(aoaConfig.toolAllowlist)
    ? aoaConfig.toolAllowlist.filter((name): name is string => typeof name === "string")
    : [];
  return { toolAllowlist };
}

export async function refreshCrewToolContext(context: ToolContext, tools: readonly AgentTool[]): Promise<ToolContext> {
  if (context.actorType !== "agent" || context.agentKind !== "aoa") return context;
  if (!context.agentId || !context.runId) throw forbidden("Crew run is not authorized");
  const authority = await resolveCrewRunAuthority(context.db, {
    companyId: context.companyId, agentId: context.agentId, runId: context.runId,
  });
  if (!authority) throw forbidden("Crew run is not authorized");
  return {
    ...context,
    toolAllowlist: authority.toolAllowlist,
    enabledCapabilities: deriveEnabledCapabilities(authority.toolAllowlist, tools),
  };
}

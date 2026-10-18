import { beforeEach, describe, expect, it, vi } from "vitest";
import { agents, internalAgentConfig, internalAgentRuns } from "@armyofagents/db";
import { resolveCrewRunAuthority, refreshCrewToolContext } from "../services/internal-agent/crew-tool-authority.js";
import { createToolCallHandler } from "../services/internal-agent/mcp-bridge.js";
import type { AgentTool, ToolContext } from "../services/internal-agent/types.js";

vi.mock("../services/internal-agent/runtime-approvals.js", () => ({ runtimeApprovalService: vi.fn() }));
vi.mock("../services/internal-agent/tool-registry.js", () => ({ filterAuthorizedToolsForContext: vi.fn() }));
vi.mock("../middleware/logger.js", () => ({ logger: { child: () => ({ warn: vi.fn() }), debug: vi.fn() } }));

function fixture() {
  const agent = { id: "agent-1", companyId: "co-1", kind: "aoa", status: "idle", runtimeConfig: { aoa: { toolAllowlist: ["hub.updateCurationSummary"] } } };
  const run = { id: "run-1", companyId: "co-1", agentId: "agent-1", status: "running" };
  const config = { companyId: "co-1", crewPaused: false, crewAutonomyLevel: 1 };
  const queried = vi.fn();
  const db = { select: () => {
    let rows: unknown[] = [];
    const chain: any = {
      from: (table: unknown) => {
        queried(table);
        rows = table === agents ? [agent] : table === internalAgentRuns ? [run] : table === internalAgentConfig ? [config] : [];
        return chain;
      },
      where: () => chain,
      limit: () => Promise.resolve(rows),
      then: (resolve: (result: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return chain;
  } };
  return { agent, run, config, db: db as never, queried };
}

const identity = { companyId: "co-1", agentId: "agent-1", runId: "run-1" };
const tool: AgentTool = {
  name: "hub.updateCurationSummary", description: "fixture", parameters: { type: "object", properties: {} },
  category: "coordination", requiredRole: "team_member", requiresConfirmation: false,
  execute: async () => ({ success: true, data: null, summary: "fixture" }),
};

function context(db: never): ToolContext {
  return {
    ...identity, actorType: "agent", agentKind: "aoa", userId: "aoa-subagent", userRole: "founder",
    toolAllowlist: [tool.name], enabledCapabilities: [], db, services: {} as never,
  };
}

describe("current crew tool authority", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reloads the current allowlist without treating admission pause as revocation", async () => {
    const state = fixture();
    state.config.crewPaused = true;
    expect(await resolveCrewRunAuthority(state.db, identity)).toEqual({ toolAllowlist: [tool.name] });
  });

  it.each(["paused", "terminated", "pending_approval"])("refuses an agent whose current status is %s", async (status) => {
    const state = fixture();
    state.agent.status = status;
    await expect(resolveCrewRunAuthority(state.db, identity)).rejects.toMatchObject({ status: 403 });
  });

  it.each(["completed", "failed", "cancelled"])("refuses a %s run", async (status) => {
    const state = fixture();
    state.run.status = status;
    await expect(resolveCrewRunAuthority(state.db, identity)).rejects.toMatchObject({ status: 403 });
  });

  it.each([
    { companyId: "co-other", agentId: "agent-1", id: "run-1" },
    { companyId: "co-1", agentId: "agent-other", id: "run-1" },
    { companyId: "co-1", agentId: "agent-1", id: "run-other" },
  ])("refuses a mismatched run binding %j", async (binding) => {
    const state = fixture();
    Object.assign(state.run, binding);
    await expect(resolveCrewRunAuthority(state.db, identity)).rejects.toMatchObject({ status: 403 });
  });

  it("does not apply crew run checks to an organization agent", async () => {
    const state = fixture();
    state.agent.kind = "org";
    state.run.status = "completed";
    expect(await resolveCrewRunAuthority(state.db, identity)).toBeNull();
    expect(state.queried).not.toHaveBeenCalledWith(internalAgentRuns);
  });

  it("refreshes the native callback context before every call and denies revoked tools without executing them", async () => {
    const state = fixture();
    const snapshot = context(state.db);
    const executeTool = vi.fn().mockResolvedValue({ success: true, data: null, summary: "fixture" });
    const handle = createToolCallHandler({
      tools: [tool], executeTool, toolContext: snapshot,
      resolveToolContext: () => refreshCrewToolContext(snapshot, [tool]),
    } as never);
    expect((await handle(tool.name, {})).isError).toBe(false);
    state.agent.runtimeConfig.aoa.toolAllowlist = [];

    expect((await handle(tool.name, {})).isError).toBe(true);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it("denies a native callback after its run is cancelled without mutating the original snapshot", async () => {
    const state = fixture();
    const snapshot = context(state.db);
    const executeTool = vi.fn();
    const handle = createToolCallHandler({
      tools: [tool], executeTool, toolContext: snapshot,
      resolveToolContext: () => refreshCrewToolContext(snapshot, [tool]),
    } as never);
    state.run.status = "cancelled";

    expect((await handle(tool.name, {})).isError).toBe(true);
    expect(executeTool).not.toHaveBeenCalled();
    expect(snapshot.toolAllowlist).toEqual([tool.name]);
  });
});

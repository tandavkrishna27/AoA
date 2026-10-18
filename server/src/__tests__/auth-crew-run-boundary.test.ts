import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentApiKeys, agents, internalAgentConfig, internalAgentRuns } from "@armyofagents/db";

const auth = vi.hoisted(() => ({ valid: true }));
vi.mock("../agent-auth-jwt.js", () => ({
  verifyCommanderRunJwt: () => null,
  verifyLocalAgentJwt: () => auth.valid ? { sub: "agent-1", company_id: "co-1", adapter_type: "codex_local", run_id: "run-signed" } : null,
}));
vi.mock("../config/deployment-mode.js", () => ({ tenantIsolationEnforced: () => false }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), child: () => ({ warn: vi.fn() }) } }));
vi.mock("../services/upgrade-socket-authorization.js", () => ({ hasActiveCloudMembership: vi.fn() }));
vi.mock("../services/index.js", () => {
  const factory = () => ({});
  return {
    agentService: factory, artifactService: factory, companyService: factory, debriefService: factory,
    extractionService: factory, goalService: factory, issueService: factory, memoryService: factory,
    mcpService: factory, permissionService: factory, accessService: factory, projectService: factory,
    approvalService: factory, issueApprovalService: factory, logActivity: vi.fn(),
  };
});
vi.mock("../services/internal-agent/service-container.js", () => ({ createServiceContainer: () => ({}) }));
vi.mock("../services/internal-agent/tool-registry.js", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  executeTool: vi.fn().mockResolvedValue({ success: true, data: null, summary: "fixture" }),
}));
vi.mock("../services/heartbeat-mcp.js", () => ({
  ORG_HEARTBEAT_TOOL_ALLOWLIST: [], ORG_HEARTBEAT_ENABLED_CAPABILITIES: [], resolveHeartbeatEffectiveAutonomy: () => 0,
}));

import { actorMiddleware } from "../middleware/auth.js";
import { mcpServerRoutes } from "../mcp/server.js";
import { executeTool } from "../services/internal-agent/tool-registry.js";

function fixture(options: { localImplicit?: boolean; staticKey?: boolean } = {}) {
  const agent = { id: "agent-1", companyId: "co-1", kind: "aoa", status: "idle", runtimeConfig: { aoa: { toolAllowlist: [] as string[] } } };
  const run = { id: "run-signed", companyId: "co-1", agentId: "agent-1", status: "running" };
  const memorySvc = {
    create: vi.fn().mockResolvedValue({ id: "memory-1", title: "fixture", source: "agent", status: "pending", agentId: "agent-1" }),
    approve: vi.fn().mockResolvedValue({ status: "approved" }),
  };
  const queried = vi.fn();
  const db = { select: () => {
    let rows: unknown[] = [];
    const chain: any = {
      from: (table: unknown) => {
        queried(table);
        rows = table === agents ? [agent] : table === internalAgentRuns ? [run]
          : table === internalAgentConfig ? [{ crewAutonomyLevel: 1 }]
          : table === agentApiKeys && options.staticKey ? [{ id: "key-1", companyId: "co-1", agentId: "agent-1" }] : [];
        return chain;
      },
      where: () => chain,
      limit: () => Promise.resolve(rows),
      then: (resolve: (result: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return chain;
  }, update: () => ({ set: () => ({ where: async () => {} }) }) };
  const app = express();
  app.use(express.json());
  app.use(actorMiddleware(db as never, { deploymentMode: options.localImplicit ? "local_trusted" : "authenticated", devLocalIdentity: options.localImplicit }));
  app.get("/actor", (req, response) => response.json(req.actor));
  app.use("/api", mcpServerRoutes(db as never, {
    companiesSvc: { getById: async () => ({ id: "co-1", mcpEnabled: true }) } as never,
    mcpSvc: { touchClient: async () => {} } as never,
    memorySvc: memorySvc as never,
    resolveScope: async () => ({ kind: "founder", userId: "fixture" }),
    resolveRole: async () => "founder",
    resolveScopedAgentIds: async () => null,
    resolveDistributedRunCurrency: async () => "admit",
    resolveDistributedToolSurfaceAtUse: async () => "admit",
  }));
  const rpc = () => request(app).post("/api/companies/co-1/mcp").set("Authorization", "Bearer fixture-no-real-token").send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const retain = () => request(app).post("/api/companies/co-1/mcp")
    .set("Authorization", "Bearer fixture-no-real-token")
    .send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "memory.retain", arguments: {
      title: "fixture", content: "fixture", category: "fixture", layer: "working", sourceContext: "fixture", scopeToSelf: true,
    } } });
  return { app, rpc, retain, agent, run, queried, memorySvc };
}

describe("crew JWT authentication at the actual HTTP MCP boundary", () => {
  beforeEach(() => { auth.valid = true; vi.clearAllMocks(); });

  it("admits a live company and agent bound crew run", async () => {
    expect((await fixture().rpc()).status).toBe(200);
  });

  it.each(["paused", "terminated", "pending_approval"])("denies an agent currently %s", async (status) => {
    const state = fixture();
    state.agent.status = status;
    expect((await state.rpc()).status).toBe(401);
  });

  it.each(["completed", "failed", "cancelled"])("denies a JWT for a %s crew run", async (status) => {
    const state = fixture();
    state.run.status = status;
    expect((await state.rpc()).status).toBe(401);
  });

  it.each([
    { companyId: "other-company" }, { agentId: "other-agent" }, { id: "another-run" },
  ])("denies mismatched run identity %j", async (binding) => {
    const state = fixture();
    Object.assign(state.run, binding);
    expect((await state.rpc()).status).toBe(401);
  });

  it("binds crew tool and audit context to the signed run despite a different header", async () => {
    const { app } = fixture();
    const response = await request(app).get("/actor").set("Authorization", "Bearer fixture-no-real-token").set("x-aoa-run-id", "run-header");
    expect(response.body).toMatchObject({ type: "agent", signedRunId: "run-signed", runId: "run-signed" });
  });

  it("does not turn a rejected or expired bearer into implicit local board authority", async () => {
    auth.valid = false;
    expect((await fixture({ localImplicit: true }).rpc()).status).toBe(401);
  });

  it("retains the implicit local board session when no bearer was presented", async () => {
    const { app } = fixture({ localImplicit: true });
    const response = await request(app).get("/actor");
    expect(response.body).toMatchObject({ type: "board", source: "local_implicit" });
  });

  it("preserves organization JWT header behavior without imposing crew run checks", async () => {
    const state = fixture();
    state.agent.kind = "org";
    state.run.status = "cancelled";
    const response = await request(state.app).get("/actor").set("Authorization", "Bearer fixture-no-real-token").set("x-aoa-run-id", "org-header");
    expect(response.body).toMatchObject({ type: "agent", runId: "org-header", signedRunId: "run-signed" });
    expect(state.queried).not.toHaveBeenCalledWith(internalAgentRuns);
  });

  it("preserves static agent key authentication without imposing crew run checks", async () => {
    const state = fixture({ staticKey: true });
    state.run.status = "cancelled";
    const response = await request(state.app).get("/actor").set("Authorization", "Bearer fixture-no-real-token").set("x-aoa-run-id", "static-header");
    expect(response.body).toMatchObject({ type: "agent", source: "agent_key", keyId: "key-1", runId: "static-header" });
    expect(state.queried).not.toHaveBeenCalledWith(internalAgentRuns);
  });

  it("refreshes current broker permissions for successive HTTP tool calls", async () => {
    const state = fixture();
    const name = "hub.updateCurationSummary";
    state.agent.runtimeConfig.aoa.toolAllowlist = [name];
    const call = () => request(state.app).post("/api/companies/co-1/mcp")
      .set("Authorization", "Bearer fixture-no-real-token")
      .send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: {} } });
    expect((await call()).body.result?.isError).toBe(false);
    state.agent.runtimeConfig.aoa.toolAllowlist = [];
    expect((await call()).body.result?.isError).toBe(true);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it("refuses successive HTTP tool calls after the signed run is cancelled", async () => {
    const state = fixture();
    expect((await state.rpc()).status).toBe(200);
    state.run.status = "cancelled";
    const response = await request(state.app).post("/api/companies/co-1/mcp")
      .set("Authorization", "Bearer fixture-no-real-token")
      .send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "hub.updateCurationSummary", arguments: {} } });
    expect(response.status).toBe(401);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("denies outbound memory writes outside a crew JWT's current exact allowlist", async () => {
    const state = fixture();
    state.agent.runtimeConfig.aoa.toolAllowlist = ["hub.readCurationContext"];
    expect((await state.retain()).status).toBe(403);
    state.agent.runtimeConfig.aoa.toolAllowlist = [];
    expect((await state.retain()).status).toBe(403);
    expect(state.memorySvc.create).not.toHaveBeenCalled();
    expect(state.memorySvc.approve).not.toHaveBeenCalled();
  });

  it("revokes a previously exact-authorized outbound crew tool before the next HTTP call", async () => {
    const state = fixture();
    state.agent.runtimeConfig.aoa.toolAllowlist = ["memory.retain"];
    expect((await state.retain()).status).toBe(200);
    state.agent.runtimeConfig.aoa.toolAllowlist = [];
    expect((await state.retain()).status).toBe(403);
    expect(state.memorySvc.create).toHaveBeenCalledTimes(1);
    expect(state.memorySvc.approve).toHaveBeenCalledTimes(1);
  });

  it("preserves outbound organization JWT tool semantics", async () => {
    const state = fixture();
    state.agent.kind = "org";
    state.run.status = "cancelled";
    expect((await state.retain()).status).toBe(200);
    expect(state.memorySvc.create).toHaveBeenCalledTimes(1);
    expect(state.queried).not.toHaveBeenCalledWith(internalAgentRuns);
  });

  it("preserves outbound static agent key tool semantics", async () => {
    const state = fixture({ staticKey: true });
    state.run.status = "cancelled";
    expect((await state.retain()).status).toBe(200);
    expect(state.memorySvc.create).toHaveBeenCalledTimes(1);
    expect(state.queried).not.toHaveBeenCalledWith(internalAgentRuns);
  });
});

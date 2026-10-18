import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzleOperatorStubs, makeTableProxy } from "./helpers/drizzle-mock.js";

vi.mock("drizzle-orm", () => drizzleOperatorStubs());

vi.mock("@armyofagents/db", () => ({
  agents: makeTableProxy("agents"),
  aoaAgentTriggers: makeTableProxy("aoa_agent_triggers"),
  companies: makeTableProxy("companies"),
  heartbeatRuns: makeTableProxy("heartbeat_runs"),
  internalAgentRuns: makeTableProxy("internal_agent_runs"),
}));

const mockAdapterTestEnvironment = vi.hoisted(() => vi.fn());
const mockGetAgentById = vi.hoisted(() => vi.fn());
const mockNormalizeAdapterConfigForPersistence = vi.hoisted(() =>
  vi.fn(async (_companyId: string, config: Record<string, unknown>) => config),
);
const mockResolveAdapterConfigForRuntime = vi.hoisted(() =>
  vi.fn(async (_companyId: string, _adapterType: string, config: Record<string, unknown>) => config),
);
const mockAcquireForRun = vi.hoisted(() => vi.fn());
const mockReleaseRunLease = vi.hoisted(() => vi.fn());
const mockGetProviderStatus = vi.hoisted(() => vi.fn());
const mockFindServerAdapter = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  agentService: () => ({
    getById: mockGetAgentById,
    list: vi.fn().mockResolvedValue([]),
    resolveByReference: vi.fn(),
    update: vi.fn(),
    orgForCompany: vi.fn().mockResolvedValue([]),
    listConfigRevisions: vi.fn().mockResolvedValue([]),
    getConfigRevision: vi.fn(),
    getChainOfCommand: vi.fn().mockResolvedValue([]),
    backfillParentFields: vi.fn().mockResolvedValue(0),
    listKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeKey: vi.fn(),
    getKeyById: vi.fn(),
  }),
  agentInstructionsService: () => ({
    getBundle: vi.fn(),
    readFile: vi.fn(),
    updateBundle: vi.fn(),
    writeFile: vi.fn(),
    deleteFile: vi.fn(),
    exportFiles: vi.fn(),
    ensureManagedBundle: vi.fn(),
    materializeManagedBundle: vi.fn(),
  }),
  accessService: () => ({ canUser: vi.fn(), hasPermission: vi.fn() }),
  approvalService: () => ({}),
  companySkillService: () => ({ listRuntimeSkillEntries: vi.fn() }),
  heartbeatService: () => ({}),
  issueApprovalService: () => ({}),
  issueService: () => ({}),
  logActivity: vi.fn(),
  secretService: () => ({
    normalizeAdapterConfigForPersistence: mockNormalizeAdapterConfigForPersistence,
    resolveAdapterConfigForRuntime: mockResolveAdapterConfigForRuntime,
    syncEnvBindingsForTarget: vi.fn(),
  }),
  syncInstructionsBundleConfigFromFilePath: vi.fn(
    (_agent: unknown, config: Record<string, unknown>) => config,
  ),
}));

vi.mock("../adapters/index.js", () => ({
  findActiveServerAdapter: vi.fn(),
  findServerAdapter: mockFindServerAdapter,
  listAdapterModels: vi.fn(),
}));

const mockListCodexModels = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockListCodexModelsForAgent = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock("../adapters/codex-models.js", () => ({
  listCodexModels: mockListCodexModels,
  listCodexModelsForAgent: mockListCodexModelsForAgent,
}));

vi.mock("../adapters/provider-status.js", () => ({
  getProviderStatus: mockGetProviderStatus,
}));

vi.mock("../adapters/provider-status-deps.js", () => ({
  realProviderStatusDeps: {},
}));

vi.mock("../services/environment-run-orchestrator.js", () => ({
  environmentRunOrchestrator: vi.fn(() => ({
    acquireForRun: mockAcquireForRun,
  })),
}));

vi.mock("../services/environment-runtime.js", () => ({
  environmentRuntimeService: vi.fn(() => ({
    releaseRunLease: mockReleaseRunLease,
  })),
}));

// U13.7: this suite never exercises cloud_auth, so the sandbox-readiness-probe
// branch is never taken at runtime — but agents.ts now statically imports it,
// and that module's own import of one-shot-sandbox-cli.js needs
// environment-runtime.js's resolveRuntimeProviderConfig, which the mock above
// does not provide. Mock the seam directly (never called here) rather than
// widening the environment-runtime.js mock for an unrelated code path.
vi.mock("../services/sandbox-readiness-probe.js", () => ({
  probeReadinessInSandbox: vi.fn(),
  cliToolForSandboxReadinessProbe: () => null,
}));

vi.mock("@armyofagents/adapter-claude-local/server", () => ({
  runClaudeLogin: vi.fn(),
}));

vi.mock("@armyofagents/adapter-codex-local", () => ({
  DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX: false,
  DEFAULT_CODEX_LOCAL_MODEL: "gpt-4.1",
}));

vi.mock("@armyofagents/adapter-cursor-local", () => ({
  DEFAULT_CURSOR_LOCAL_MODEL: "claude-sonnet-4-20250514",
}));

vi.mock("@armyofagents/adapter-opencode-local/server", () => ({
  ensureOpenCodeModelConfiguredAndAvailable: vi.fn(),
}));

import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";

const COMPANY_ID = "company-1";
const ENVIRONMENT_ID = "22222222-2222-4222-8222-222222222222";

function makeApp(actorOverride?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = (actorOverride ?? {
      type: "board",
      source: "local_implicit",
      userId: "board",
      companyIds: [COMPANY_ID],
      isInstanceAdmin: true,
    }) as never;
    next();
  });
  app.use("/api", agentRoutes({} as never));
  app.use(errorHandler);
  return app;
}

describe("POST /companies/:companyId/adapters/:type/test-environment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentById.mockReset();
    mockListCodexModels.mockReset().mockResolvedValue([]);
    mockListCodexModelsForAgent.mockReset().mockResolvedValue([]);
    // Default: process adapter (skips model resolution)
    mockFindServerAdapter.mockReturnValue({
      type: "process",
      testEnvironment: mockAdapterTestEnvironment,
    });
    mockAdapterTestEnvironment.mockResolvedValue({
      adapterType: "process",
      status: "pass",
      checks: [],
      testedAt: "2026-06-01T00:00:00.000Z",
    });
    mockAcquireForRun.mockResolvedValue({
      environment: {
        id: ENVIRONMENT_ID,
        companyId: COMPANY_ID,
        name: "E2B Cloud QA",
        driver: "sandbox",
        status: "active",
        config: { provider: "e2b" },
      },
      lease: {
        id: "lease-1",
        companyId: COMPANY_ID,
        environmentId: ENVIRONMENT_ID,
        provider: "e2b",
        providerLeaseId: "sandbox-1",
        metadata: {},
      },
      leaseContext: {},
      adapterType: "process",
      configPatch: {
        executionTarget: {
          type: "provider-sandbox",
          provider: "e2b",
          providerLeaseId: "sandbox-1",
          remoteCwd: "/home/user/aoa-workspace",
          shell: "bash",
          env: {},
          runner: { execute: vi.fn() },
        },
      },
    });
    mockReleaseRunLease.mockResolvedValue(undefined);
    // Default: getProviderStatus not called unless test sets it up
    mockGetProviderStatus.mockResolvedValue({
      adapterType: "codex_local",
      installed: true,
      authenticated: true,
      authMode: "chatgpt",
      defaultModelResolved: "gpt-5.5",
    });
  });

  it("passes the selected environment execution target into the adapter test and releases the lease", async () => {
    const res = await request(makeApp())
      .post(`/api/companies/${COMPANY_ID}/adapters/process/test-environment`)
      .send({
        environmentId: ENVIRONMENT_ID,
        adapterConfig: { command: "pwd" },
      });

    expect(res.status).toBe(200);
    expect(mockAcquireForRun).toHaveBeenCalledWith(expect.objectContaining({
      companyId: COMPANY_ID,
      environmentId: ENVIRONMENT_ID,
      adapterType: "process",
      issueId: null,
      persistedExecutionWorkspace: null,
    }));
    expect(mockAdapterTestEnvironment).toHaveBeenCalledWith(expect.objectContaining({
      companyId: COMPANY_ID,
      adapterType: "process",
      config: { command: "pwd" },
      environmentName: "E2B Cloud QA",
      executionTarget: expect.objectContaining({
        type: "provider-sandbox",
        provider: "e2b",
        remoteCwd: "/home/user/aoa-workspace",
      }),
    }));
    expect(mockReleaseRunLease).toHaveBeenCalledWith(expect.objectContaining({
      environment: expect.objectContaining({ id: ENVIRONMENT_ID }),
      lease: expect.objectContaining({ id: "lease-1" }),
      status: "released",
    }));
  });

  it("threads the :type param into secret resolution so the company provider key applies", async () => {
    // Task 8: the probe must resolve the credential for the adapter it is about
    // to probe. Passing the wrong type would either inject another provider's
    // company key or skip the fallback entirely, making the probe lie.
    mockFindServerAdapter.mockReturnValue({
      type: "claude_local",
      testEnvironment: mockAdapterTestEnvironment,
    });
    mockAdapterTestEnvironment.mockResolvedValue({
      adapterType: "claude_local",
      status: "pass",
      checks: [],
      testedAt: "2026-06-01T00:00:00.000Z",
    });
    // Once-only: vi.clearAllMocks() in beforeEach clears calls but KEEPS
    // implementations, so a persistent override would leak into later tests.
    mockResolveAdapterConfigForRuntime.mockImplementationOnce(
      async (_companyId: string, _adapterType: string, config: Record<string, unknown>) => ({
        ...config,
        env: { ANTHROPIC_API_KEY: "company-key" },
      }),
    );

    const res = await request(makeApp())
      .post(`/api/companies/${COMPANY_ID}/adapters/claude_local/test-environment`)
      .send({ adapterConfig: {} });

    expect(res.status).toBe(200);
    expect(mockResolveAdapterConfigForRuntime).toHaveBeenCalledWith(
      COMPANY_ID,
      "claude_local",
      expect.anything(),
      expect.objectContaining({ consumerId: "adapter-test:claude_local" }),
    );
    // …and the resolved env (company key included) is what the probe runs with.
    expect(mockAdapterTestEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        adapterType: "claude_local",
        config: expect.objectContaining({ env: { ANTHROPIC_API_KEY: "company-key" } }),
      }),
    );
  });

  it("preserves an explicit Codex model for account-scoped resolution inside the adapter probe", async () => {
    // Override adapter type to codex_local for this test
    mockFindServerAdapter.mockReturnValue({
      type: "codex_local",
      testEnvironment: mockAdapterTestEnvironment,
    });
    mockAdapterTestEnvironment.mockResolvedValue({
      adapterType: "codex_local",
      status: "pass",
      checks: [],
      testedAt: "2026-06-01T00:00:00.000Z",
    });
    mockGetProviderStatus.mockResolvedValue({
      adapterType: "codex_local",
      installed: true,
      authenticated: true,
      authMode: "chatgpt",
      defaultModelResolved: "gpt-5.5",
    });

    const res = await request(makeApp())
      .post(`/api/companies/${COMPANY_ID}/adapters/codex_local/test-environment`)
      .send({
        adapterConfig: { model: "gpt-5.3-codex" },
      });

    expect(res.status).toBe(200);
    // Codex resolves against the exact account catalog in the adapter. The
    // route must not substitute a host/shared model before invoking the probe.
    expect(mockGetProviderStatus).not.toHaveBeenCalled();
    expect(mockAdapterTestEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ model: "gpt-5.3-codex" }),
      }),
    );
  });

  it("leaves a blank Codex model unset for exact account-catalog inheritance in the probe", async () => {
    mockFindServerAdapter.mockReturnValue({
      type: "codex_local",
      testEnvironment: mockAdapterTestEnvironment,
    });
    mockAdapterTestEnvironment.mockResolvedValue({
      adapterType: "codex_local",
      status: "pass",
      checks: [],
      testedAt: "2026-06-01T00:00:00.000Z",
    });
    mockGetProviderStatus.mockResolvedValue({
      adapterType: "codex_local",
      installed: true,
      authenticated: true,
      authMode: "chatgpt",
      defaultModelResolved: "gpt-5.5",
    });

    const res = await request(makeApp())
      .post(`/api/companies/${COMPANY_ID}/adapters/codex_local/test-environment`)
      .send({ adapterConfig: {} }); // no model at all

    expect(res.status).toBe(200);
    // The adapter owns account-scoped catalog resolution, so an empty setting
    // reaches it unchanged and inherits that target's CLI default.
    expect(mockGetProviderStatus).not.toHaveBeenCalled();
    expect(mockAdapterTestEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.not.objectContaining({ model: expect.anything() }),
      }),
    );
  });

  it("redacts secrets in check message/detail/hint before returning to client", async () => {
    const secretKey = "sk-ant-abc123DEF456ghi789xyz";
    mockAdapterTestEnvironment.mockResolvedValue({
      adapterType: "codex_local",
      status: "warn",
      checks: [
        {
          code: "x",
          level: "warn",
          message: "probe failed",
          detail: `leaked ${secretKey} here`,
          hint: `try removing ${secretKey} from config`,
        },
      ],
      testedAt: "2026-06-01T00:00:00.000Z",
    });

    const res = await request(makeApp())
      .post(`/api/companies/${COMPANY_ID}/adapters/process/test-environment`)
      .send({ adapterConfig: {} });

    expect(res.status).toBe(200);
    expect(res.body.checks[0].detail).not.toContain(secretKey);
    expect(res.body.checks[0].detail).toContain("***REDACTED***");
    expect(res.body.checks[0].hint).not.toContain(secretKey);
    expect(res.body.checks[0].hint).toContain("***REDACTED***");
    // message was clean, should be unchanged
    expect(res.body.checks[0].message).toBe("probe failed");
  });

  it("returns 429 when a probe is already in-flight for the same company", async () => {
    // Strategy: use supertest's .end() callback to fire request A without
    // awaiting — so the HTTP request is actually dispatched. Then signal via
    // a Promise inside the mock when the adapter is entered (slot is held),
    // send request B, assert 429, then release the gate to clean up.
    let releaseGate!: () => void;
    let adapterStarted!: () => void;
    const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
    const adapterStartedSignal = new Promise<void>((resolve) => { adapterStarted = resolve; });
    const successResult = {
      adapterType: "process",
      status: "pass",
      checks: [],
      testedAt: "2026-06-01T00:00:00.000Z",
    };
    // First call: signal that it started, then hold the slot
    mockAdapterTestEnvironment.mockImplementationOnce(async () => {
      adapterStarted();
      await gate;
      return successResult;
    });
    // Second call (if reached): returns immediately
    mockAdapterTestEnvironment.mockResolvedValueOnce(successResult);

    const app = makeApp();

    // Fire request A using .end() — this dispatches without blocking our async function
    let resolveA!: (res: request.Response) => void;
    const reqAPromise = new Promise<request.Response>((resolve) => { resolveA = resolve; });
    request(app)
      .post(`/api/companies/${COMPANY_ID}/adapters/process/test-environment`)
      .send({ adapterConfig: {} })
      .end((_err, res) => resolveA(res));

    // Wait until request A has entered the adapter (slot is incremented)
    await adapterStartedSignal;

    // Now request B should hit the 429 cap
    const resB = await request(app)
      .post(`/api/companies/${COMPANY_ID}/adapters/process/test-environment`)
      .send({ adapterConfig: {} });

    expect(resB.status).toBe(429);
    expect(resB.body.error).toMatch(/already running/i);

    // Release A's gate and confirm it completes cleanly (slot decremented)
    releaseGate();
    const resA = await reqAPromise;
    expect(resA.status).toBe(200);
  });

  it("returns 403 when actor lacks read-configurations permission", async () => {
    // An actor that is a board member but NOT local_implicit and NOT instance admin
    // and without agents:create permission (canUser returns false).
    // canUser mock: the vi.mock factory creates a fresh vi.fn() per accessService()
    // call — no module-level handle exists to call .mockReturnValue(false) on it.
    // vi.fn() returns undefined by default (falsy), which the RBAC gate treats as
    // "no permission". This is intentionally equivalent to mockReturnValue(false);
    // extracting a hoisted handle would require refactoring the mock factory.
    const restrictedApp = makeApp({
      type: "board",
      source: "session",       // NOT local_implicit
      userId: "restricted-user",
      companyIds: [COMPANY_ID],
      isInstanceAdmin: false,  // NOT instance admin
    });

    const res = await request(restrictedApp)
      .post(`/api/companies/${COMPANY_ID}/adapters/process/test-environment`)
      .send({ adapterConfig: {} });

    expect(res.status).toBe(403);
  });
});

describe("GET /companies/:companyId/adapters/codex_local/models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentById.mockReset();
    mockResolveAdapterConfigForRuntime.mockReset().mockImplementation(
      async (_companyId: string, _type: string, config: Record<string, unknown>) => config,
    );
    mockListCodexModels.mockReset().mockResolvedValue([]);
    mockListCodexModelsForAgent.mockReset().mockResolvedValue([
      { id: "gpt-account-default", label: "Account Default" },
    ]);
  });

  it("keeps the create/no-agent picker account-default-only", async () => {
    const res = await request(makeApp())
      .get(`/api/companies/${COMPANY_ID}/adapters/codex_local/models`)
      .expect(200);

    expect(res.body).toEqual([]);
    expect(mockListCodexModels).toHaveBeenCalledWith();
    expect(mockListCodexModelsForAgent).not.toHaveBeenCalled();
    expect(mockGetAgentById).not.toHaveBeenCalled();
  });

  it("loads choices from the same-company Codex agent's resolved config", async () => {
    const agent = {
      id: "agent-one",
      companyId: COMPANY_ID,
      adapterType: "codex_local",
      adapterConfig: { command: "codex", env: { OPENAI_API_KEY: { type: "secret_ref" } } },
    };
    mockGetAgentById.mockResolvedValue(agent);
    mockResolveAdapterConfigForRuntime.mockResolvedValue({
      command: "codex",
      env: { OPENAI_API_KEY: "agent-one-resolved-key" },
    });

    const res = await request(makeApp())
      .get(`/api/companies/${COMPANY_ID}/adapters/codex_local/models`)
      .query({ agentId: agent.id, authHome: "C:/attacker-home" })
      .expect(200);

    expect(res.body).toEqual([{ id: "gpt-account-default", label: "Account Default" }]);
    expect(mockResolveAdapterConfigForRuntime).toHaveBeenCalledWith(
      COMPANY_ID,
      "codex_local",
      agent.adapterConfig,
      expect.objectContaining({
        consumerType: "agent",
        consumerId: agent.id,
        actorType: "user",
        actorId: "board",
      }),
    );
    expect(mockListCodexModelsForAgent).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      agentId: agent.id,
      adapterConfig: {
        command: "codex",
        env: { OPENAI_API_KEY: "agent-one-resolved-key" },
      },
    });
    expect(mockListCodexModelsForAgent.mock.calls[0]![0]).not.toHaveProperty("authHome");
  });

  it("does not resolve credentials for missing or cross-company agents", async () => {
    mockGetAgentById.mockResolvedValue(null);
    await request(makeApp())
      .get(`/api/companies/${COMPANY_ID}/adapters/codex_local/models`)
      .query({ agentId: "missing-agent" })
      .expect(404);

    mockGetAgentById.mockResolvedValue({
      id: "other-agent",
      companyId: "company-other",
      adapterType: "codex_local",
      adapterConfig: { env: { OPENAI_API_KEY: "other-company-key" } },
    });
    await request(makeApp())
      .get(`/api/companies/${COMPANY_ID}/adapters/codex_local/models`)
      .query({ agentId: "other-agent" })
      .expect(404);

    expect(mockResolveAdapterConfigForRuntime).not.toHaveBeenCalled();
    expect(mockListCodexModelsForAgent).not.toHaveBeenCalled();
  });

  it("does not probe agents configured for another adapter", async () => {
    mockGetAgentById.mockResolvedValue({
      id: "agent-one",
      companyId: COMPANY_ID,
      adapterType: "claude_local",
      adapterConfig: { env: { ANTHROPIC_API_KEY: "secret" } },
    });

    const res = await request(makeApp())
      .get(`/api/companies/${COMPANY_ID}/adapters/codex_local/models`)
      .query({ agentId: "agent-one" })
      .expect(200);

    expect(res.body).toEqual([]);
    expect(mockResolveAdapterConfigForRuntime).not.toHaveBeenCalled();
    expect(mockListCodexModelsForAgent).not.toHaveBeenCalled();
  });

  it("requires configuration-read permission before resolving an agent's secrets", async () => {
    mockGetAgentById.mockResolvedValue({
      id: "agent-one",
      companyId: COMPANY_ID,
      adapterType: "codex_local",
      adapterConfig: { env: { OPENAI_API_KEY: { type: "secret_ref" } } },
    });
    const actor = {
      type: "board",
      source: "session",
      userId: "reader-without-config-access",
      companyIds: [COMPANY_ID],
      isInstanceAdmin: false,
    };

    await request(makeApp(actor))
      .get(`/api/companies/${COMPANY_ID}/adapters/codex_local/models`)
      .query({ agentId: "agent-one" })
      .expect(403);

    expect(mockGetAgentById).not.toHaveBeenCalled();
    expect(mockResolveAdapterConfigForRuntime).not.toHaveBeenCalled();
    expect(mockListCodexModelsForAgent).not.toHaveBeenCalled();
  });

  it("rejects an empty agentId instead of falling back to a shared catalog", async () => {
    await request(makeApp())
      .get(`/api/companies/${COMPANY_ID}/adapters/codex_local/models`)
      .query({ agentId: " " })
      .expect(422);

    expect(mockGetAgentById).not.toHaveBeenCalled();
    expect(mockListCodexModelsForAgent).not.toHaveBeenCalled();
  });
});

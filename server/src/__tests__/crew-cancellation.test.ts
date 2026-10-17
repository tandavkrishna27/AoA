/**
 * Plan 3 Task 7 — in-flight cancellation reaches internal_agent_runs.
 *
 * Contract test: the crew cancellation helpers
 * must cancel internal_agent_runs records when invoked.
 *
 * The helpers live outside heartbeat.ts so this test does not import the full
 * heartbeat service graph.
 */
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import {
  requestTrackedProcessTermination,
  runningProcesses,
  spawnTrackedChild,
  waitForTrackedProcessExit,
} from "@armyofagents/adapter-utils/server-utils";
import type { Db } from "@armyofagents/db";

// ── Mocks (must be hoisted) ─────────────────────────────────────────────────
vi.mock("drizzle-orm", () => {
  const makeSql = () => {
    const s: any = function (..._args: any[]) { return s; };
    s.as = () => s;
    s.mapWith = () => s;
    return s;
  };
  const sql = makeSql();
  return {
    and: (...args: unknown[]) => ({ op: "and", args }),
    eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
    inArray: (col: unknown, vals: unknown) => ({ op: "inArray", col, vals }),
    asc: (col: unknown) => ({ op: "asc", col }),
    desc: (col: unknown) => ({ op: "desc", col }),
    or: (...args: unknown[]) => ({ op: "or", args }),
    gt: (a: unknown, b: unknown) => ({ op: "gt", a, b }),
    lte: (a: unknown, b: unknown) => ({ op: "lte", a, b }),
    ne: (a: unknown, b: unknown) => ({ op: "ne", a, b }),
    sql,
    not: (x: unknown) => ({ op: "not", x }),
    count: () => sql,
    isNull: (a: unknown) => ({ op: "isNull", a }),
    notInArray: (col: unknown, vals: unknown) => ({ op: "notInArray", col, vals }),
    lt: (a: unknown, b: unknown) => ({ op: "lt", a, b }),
    relations: () => ({}),
  };
});

vi.mock("@armyofagents/db", () => {
  const t = (n: string) =>
    new Proxy({}, { get: (_x, p) => (typeof p === "string" ? Symbol(`${n}.${p}`) : undefined) });
  return {
    agents: t("agents"),
    agentApiKeys: t("agentApiKeys"),
    agentConfigRevisions: t("agentConfigRevisions"),
    agentProjects: t("agentProjects"),
    agentRuntimeState: t("agentRuntimeState"),
    agentTaskSessions: t("agentTaskSessions"),
    agentWakeupRequests: t("agentWakeupRequests"),
    aoaAgentTriggers: t("aoaAgentTriggers"),
    approvals: t("approvals"),
    approvalComments: t("approvalComments"),
    activityLog: t("activityLog"),
    artifacts: t("artifacts"),
    artifactVersions: t("artifactVersions"),
    assets: t("assets"),
    auth: t("auth"),
    boardApiKeys: t("boardApiKeys"),
    budgetIncidents: t("budgetIncidents"),
    budgetPolicies: t("budgetPolicies"),
    cliAuthChallenges: t("cliAuthChallenges"),
    companies: t("companies"),
    companyMemberships: t("companyMemberships"),
    companySecrets: t("companySecrets"),
    companySecretVersions: t("companySecretVersions"),
    companySkills: t("companySkills"),
    costEvents: t("costEvents"),
    discussionEntries: t("discussionEntries"),
    discussions: t("discussions"),
    discussionExtractedItems: t("discussionExtractedItems"),
    documents: t("documents"),
    documentRevisions: t("documentRevisions"),
    embeddingQueue: t("embeddingQueue"),
    environments: t("environments"),
    executionWorkspaces: t("executionWorkspaces"),
    feedbackExports: t("feedbackExports"),
    feedbackVotes: t("feedbackVotes"),
    fileImportJobs: t("fileImportJobs"),
    financeEvents: t("financeEvents"),
    goals: t("goals"),
    heartbeatRunEvents: t("heartbeatRunEvents"),
    heartbeatRuns: t("heartbeatRuns"),
    heartbeatRunWatchdogDecisions: t("heartbeatRunWatchdogDecisions"),
    inboxDismissals: t("inboxDismissals"),
    instanceUserRoles: t("instanceUserRoles"),
    internalAgentConfig: t("internalAgentConfig"),
    internalAgentConversations: t("internalAgentConversations"),
    internalAgentMessages: t("internalAgentMessages"),
    internalAgentReminders: t("internalAgentReminders"),
    internalAgentRuns: t("internalAgentRuns"),
    invites: t("invites"),
    issueApprovals: t("issueApprovals"),
    issueAttachments: t("issueAttachments"),
    issueComments: t("issueComments"),
    issueDocuments: t("issueDocuments"),
    issueLabels: t("issueLabels"),
    issueReadStates: t("issueReadStates"),
    issues: t("issues"),
    joinRequests: t("joinRequests"),
    labels: t("labels"),
    marketplaceCatalogCache: t("marketplaceCatalogCache"),
    marketplaceCompanySettings: t("marketplaceCompanySettings"),
    marketplaceInstallOperations: t("marketplaceInstallOperations"),
    marketplacePendingUpdates: t("marketplacePendingUpdates"),
    mcpApiKeys: t("mcpApiKeys"),
    mcpClientConnections: t("mcpClientConnections"),
    memoryAssets: t("memoryAssets"),
    memoryExtractionBatches: t("memoryExtractionBatches"),
    memoryExtractions: t("memoryExtractions"),
    memoryFeedbackPatterns: t("memoryFeedbackPatterns"),
    memoryFolders: t("memoryFolders"),
    memoryItemVersions: t("memoryItemVersions"),
    memoryItems: t("memoryItems"),
    memoryRelations: t("memoryRelations"),
    memoryRetrievals: t("memoryRetrievals"),
    notifications: t("notifications"),
    pluginCompanySettings: t("pluginCompanySettings"),
    pluginConfig: t("pluginConfig"),
    pluginEntities: t("pluginEntities"),
    pluginJobs: t("pluginJobs"),
    pluginLogs: t("pluginLogs"),
    plugins: t("plugins"),
    pluginState: t("pluginState"),
    pluginVersionSnapshots: t("pluginVersionSnapshots"),
    pluginWebhooks: t("pluginWebhooks"),
    principalPermissionGrants: t("principalPermissionGrants"),
    projectGoals: t("projectGoals"),
    projects: t("projects"),
    projectWorkspaces: t("projectWorkspaces"),
    providerQuotaWindows: t("providerQuotaWindows"),
    routines: t("routines"),
    sidebarPreferences: t("sidebarPreferences"),
    suggestions: t("suggestions"),
    taskDependencies: t("taskDependencies"),
    teamCoordinations: t("teamCoordinations"),
    teamMembers: t("teamMembers"),
    teams: t("teams"),
    userRoles: t("userRoles"),
    workflowTemplates: t("workflowTemplates"),
    workspaceOperations: t("workspaceOperations"),
    workspaceRuntimeServices: t("workspaceRuntimeServices"),
  };
});

// Mock heavy service dependencies that heartbeat.ts imports
vi.mock("../services/secrets.js", () => ({ secretService: () => ({}) }));
vi.mock("../services/costs.js", () => ({ costService: () => ({}) }));
vi.mock("../services/output-detection.js", () => ({ outputDetectionService: () => ({}) }));
vi.mock("../services/workspace.js", () => ({
  executionWorkspaceService: () => ({}),
  workspaceOperationService: () => ({}),
}));
vi.mock("../services/instance-settings.js", () => ({ instanceSettingsService: () => ({}) }));

// ── Helpers ────────────────────────────────────────────────────────────────

type CrewRunRow = { id: string; agentId: string; companyId: string; status: string };
type Predicate = { op: "and"; args: Predicate[] } | { op: "eq"; a: symbol; b: unknown };

function matches(row: CrewRunRow, predicate: Predicate): boolean {
  if (predicate.op === "and") return predicate.args.every((part) => matches(row, part));
  const key = predicate.a.description?.split(".").at(-1) as keyof CrewRunRow;
  return row[key] === predicate.b;
}

function makeDb(rows: CrewRunRow[] = []) {
  const capturedSets: Array<Record<string, unknown>> = [];
  const db: any = {
    update: (_table: unknown) => ({
      set: (vals: Record<string, unknown>) => {
        capturedSets.push(vals);
        return {
          where: (predicate: Predicate) => {
            let updated: CrewRunRow[] | undefined;
            const execute = () => {
              if (!updated) {
                updated = rows.filter((row) => matches(row, predicate));
                for (const row of updated) Object.assign(row, vals);
              }
              return updated.map((row) => ({ id: row.id }));
            };
            return {
              then: (resolve: (result: { id: string }[]) => unknown) => Promise.resolve(execute()).then(resolve),
              returning: () => Promise.resolve(execute()),
            };
          },
        };
      },
    }),
    _capturedSets: capturedSets,
  };
  return db;
}

describe("cancelCrewRunsForAgent", () => {
  it("cancels internal_agent_runs for the given agentId", async () => {
    const { cancelCrewRunsForAgent } = await import("../services/crew-cancellation.js");
    const db = makeDb();
    await cancelCrewRunsForAgent(db, "agent-abc");
    expect(db._capturedSets.length).toBeGreaterThan(0);
    expect(db._capturedSets.some((s: any) => s.status === "cancelled")).toBe(true);
  });
});

function startSleeper(runId: string) {
  const handle = spawnTrackedChild(runId, process.execPath, ["-e", "process.stdout.write('ready\\n');setTimeout(() => {}, 60000)"], {
    cwd: tmpdir(), env: {}, graceSec: 1, shell: false,
  });
  const ready = new Promise<void>((resolve, reject) => {
    handle.child.once("error", reject);
    handle.child.stdout?.once("data", () => resolve());
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    handle.child.once("close", (code, signal) => resolve({ code, signal }));
  });
  return { handle, ready, closed };
}

async function stopSleeper(runId: string): Promise<void> {
  requestTrackedProcessTermination(runId);
  await waitForTrackedProcessExit(runId);
}

describe("crew cancellation reaches tracked local child processes", () => {
  it("agent pause terminates the running crew child while leaving other agents and terminal runs alone", async () => {
    const { cancelCrewRunsForAgent } = await import("../services/crew-cancellation.js");
    const target = { id: randomUUID(), agentId: "paused-agent", companyId: "company-a", status: "running" };
    const other = { id: randomUUID(), agentId: "other-agent", companyId: "company-a", status: "running" };
    const terminal = { id: randomUUID(), agentId: "paused-agent", companyId: "company-a", status: "completed" };
    const targetChild = startSleeper(target.id);
    const otherChild = startSleeper(other.id);
    const terminalChild = startSleeper(terminal.id);
    try {
      await Promise.all([targetChild.ready, otherChild.ready, terminalChild.ready]);
      await cancelCrewRunsForAgent(makeDb([target, other, terminal]) as Db, target.agentId);
      expect(target.status).toBe("cancelled");
      expect(await waitForTrackedProcessExit(target.id)).toBe(true);
      expect(runningProcesses.has(target.id)).toBe(false);
      expect(runningProcesses.has(other.id)).toBe(true);
      expect(runningProcesses.has(terminal.id)).toBe(true);
      expect(other.status).toBe("running");
      expect(terminal.status).toBe("completed");
      expect((await targetChild.closed).code).not.toBe(0);
    } finally {
      await Promise.all([target.id, other.id, terminal.id].map(stopSleeper));
    }
  });

  it("company budget cancellation terminates every matching crew child and leaves another company running", async () => {
    const { cancelCrewRunsForCompany } = await import("../services/crew-cancellation.js");
    const rows = [
      { id: randomUUID(), agentId: "agent-a", companyId: "company-a", status: "running" },
      { id: randomUUID(), agentId: "agent-b", companyId: "company-a", status: "running" },
      { id: randomUUID(), agentId: "agent-c", companyId: "company-b", status: "running" },
    ];
    const children = rows.map((row) => startSleeper(row.id));
    try {
      await Promise.all(children.map((child) => child.ready));
      await cancelCrewRunsForCompany(makeDb(rows) as Db, "company-a");
      expect(await Promise.all(rows.slice(0, 2).map((row) => waitForTrackedProcessExit(row.id)))).toEqual([true, true]);
      expect(rows.map((row) => row.status)).toEqual(["cancelled", "cancelled", "running"]);
      expect(runningProcesses.has(rows[2]!.id)).toBe(true);
    } finally {
      await Promise.all(rows.map((row) => stopSleeper(row.id)));
    }
  });

  it("cancellation before spawn terminates a child when it later registers", async () => {
    const { cancelCrewRunsForAgent } = await import("../services/crew-cancellation.js");
    const row = { id: randomUUID(), agentId: "paused-agent", companyId: "company-a", status: "running" };
    await cancelCrewRunsForAgent(makeDb([row]) as Db, row.agentId);
    const child = startSleeper(row.id);
    void child.ready.catch(() => undefined);
    try {
      expect(await waitForTrackedProcessExit(row.id)).toBe(true);
      const terminal = await child.closed;
      expect(terminal.code === 0 && terminal.signal === null).toBe(false);
      expect(runningProcesses.has(row.id)).toBe(false);
    } finally {
      await stopSleeper(row.id);
    }
  });

  it("zero updated rows do not terminate an unrelated tracked child", async () => {
    const { cancelCrewRunsForAgent, cancelCrewRunsForCompany } = await import("../services/crew-cancellation.js");
    const runId = randomUUID();
    const child = startSleeper(runId);
    try {
      await child.ready;
      await cancelCrewRunsForAgent(makeDb([]) as Db, "absent-agent");
      await cancelCrewRunsForCompany(makeDb([]) as Db, "absent-company");
      expect(runningProcesses.has(runId)).toBe(true);
    } finally {
      await stopSleeper(runId);
    }
  });
});

describe("cancelCrewRunsForCompany", () => {
  it("cancels internal_agent_runs for the given companyId", async () => {
    const { cancelCrewRunsForCompany } = await import("../services/crew-cancellation.js");
    const db = makeDb();
    await cancelCrewRunsForCompany(db, "co-xyz");
    expect(db._capturedSets.length).toBeGreaterThan(0);
    expect(db._capturedSets.some((s: any) => s.status === "cancelled")).toBe(true);
  });
});

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzleOperatorStubs } from "./helpers/drizzle-mock.js";

vi.mock("drizzle-orm", () => ({
  ...drizzleOperatorStubs(),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...args: unknown[]) => ({ and: args }),
  or: (...args: unknown[]) => ({ or: args }),
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
}));
vi.mock("@armyofagents/db", () =>
  Object.fromEntries(
    [
      "internalAgentConversations",
      "internalAgentConfig",
      "internalAgentMessages",
      "internalAgentRuns",
      "internalAgentReminders",
    ].map((name) => [
      name,
      new Proxy({}, { get: (_target, key) => `${name}.${String(key)}` }),
    ])
  )
);
const actorState = vi.hoisted(() => ({
  role: "team_member",
  companyAllowed: true,
}));
vi.mock("../routes/authz.js", () => ({
  assertCompanyAccess: async () => {
    if (!actorState.companyAllowed)
      throw Object.assign(new Error("Forbidden"), { status: 403 });
  },
  getActorInfo: () => ({
    actorType: "user",
    actorId: "owner",
    agentId: null,
    runId: null,
  }),
}));
vi.mock("../services/permissions.js", () => ({
  permissionService: () => ({ getEffectiveRole: async () => actorState.role }),
}));
vi.mock("../middleware/rbac.js", () => ({
  assertHumanRole: vi.fn(),
  assertRole: vi.fn(),
  assertDepartmentAccess: vi.fn(),
  assertMemoryAccess: vi.fn(),
  assertMemoryApproval: vi.fn(),
  assertEntityAccess: vi.fn(),
}));
vi.mock("../services/internal-agent/agent-loop.js", () => ({
  agentLoopService: () => ({}),
}));
vi.mock("../services/internal-agent/tool-registry.js", () => ({
  createToolRegistry: () => [],
  executeTool: vi.fn(),
}));
vi.mock("../services/internal-agent/service-container.js", () => ({
  createServiceContainer: () => ({}),
}));
vi.mock("../services/internal-agent/aoa-agents/ensure-commander.js", () => ({
  ensureCommanderAgent: async () => "commander",
  COMMANDER_TOOL_ALLOWLIST: [],
}));
vi.mock("../services/company-skills.js", () => ({
  companySkillService: () => ({}),
}));
vi.mock("../middleware/rate-limit.js", () => ({
  internalAgentChatLimiter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));
import { internalAgentRoutes } from "../routes/internal-agent.js";

const payload = {
  message: "Review saved reference",
  pageContext: "Memory",
  departmentContext: null,
  contextScope: { surface: "memory", route: "/memory" },
  attachmentAssetIds: ["11111111-1111-4111-8111-111111111111"],
};
const user = {
  id: "user-message",
  conversationId: "chat",
  role: "user",
  content: payload.message,
  turnStatus: "failed",
  clientSubmissionId: "original-key",
  runId: "failed-run",
  toolResults: { kind: "commander_submission", v: 1, payload },
  turnClaimToken: "PRIVATE-TOKEN",
  createdAt: new Date(),
};

function historyDb(rows: unknown[][]) {
  const predicates: unknown[] = [];
  let selects = 0;
  const db = {
    select: () => {
      const result = rows[selects++] ?? [];
      const chain: any = {
        from: () => chain,
        where: (predicate: unknown) => {
          predicates.push(predicate);
          return chain;
        },
        orderBy: () => chain,
        limit: () => chain,
        offset: () => chain,
        then: (
          resolve: (value: unknown[]) => unknown,
          reject: (error: unknown) => unknown
        ) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    },
  };
  return { db, predicates, count: () => selects };
}

function app(db: unknown) {
  const a = express();
  a.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      source: "session",
      userId: "owner",
      companyIds: ["company"],
    };
    next();
  });
  a.use("/api", internalAgentRoutes(db as never));
  a.use((err: any, _req: any, res: any, _next: any) =>
    res.status(err.status ?? 500).json({ error: err.message })
  );
  return a;
}

beforeEach(() => {
  actorState.role = "team_member";
  actorState.companyAllowed = true;
});

describe("Commander saved history failure recovery (HTTP)", () => {
  it.each(["/conversations/chat/messages", "/conversation"])(
    "restores the exact failed user submission through %s while stripping internal storage",
    async (path) => {
      const { db, predicates } = historyDb([
        [
          {
            id: "chat",
            companyId: "company",
            userId: "owner",
            messageCount: 1,
          },
        ],
        [user],
        [
          {
            id: "failed-run",
            companyId: "company",
            userId: "owner",
            status: "failed",
            errorMessage: "Add your company provider in Settings.",
            conversationMessageId: null,
          },
        ],
      ]);
      const response = await request(app(db)).get(
        `/api/companies/company/internal-agent${path}`
      );
      expect(response.status).toBe(200);
      expect(response.body.messages[0].failure).toEqual({
        message: "Add your company provider in Settings.",
        retry: { ...payload, clientSubmissionId: "original-key" },
        retryUnavailableReason: null,
      });
      expect(response.body.messages[0]).not.toHaveProperty("toolResults");
      expect(response.body.messages[0]).not.toHaveProperty("turnClaimToken");
      expect(JSON.stringify(predicates)).toContain(
        '"internalAgentRuns.companyId","company"'
      );
      expect(JSON.stringify(predicates)).toContain(
        '"internalAgentRuns.userId","owner"'
      );
    }
  );

  it("retains founder read access but suppresses another owner's retry payload and internal snapshot", async () => {
    actorState.role = "founder";
    const { db } = historyDb([
      [{ id: "chat", companyId: "company", userId: "other" }],
      [user],
      [],
    ]);
    const response = await request(app(db)).get(
      "/api/companies/company/internal-agent/conversations/chat/messages"
    );
    expect(response.status).toBe(200);
    expect(response.body.messages[0].failure.retry).toBeNull();
    expect(response.body.messages[0].failure.retryUnavailableReason).toMatch(
      /owner/i
    );
    expect(response.body.messages[0]).not.toHaveProperty("toolResults");
  });

  it("refuses an incomplete legacy retry without guessing references and preserves generic failure guidance", async () => {
    const { db } = historyDb([
      [{ id: "chat", companyId: "company", userId: "owner" }],
      [{ ...user, runId: null, toolResults: null }],
      [],
    ]);
    const response = await request(app(db)).get(
      "/api/companies/company/internal-agent/conversations/chat/messages"
    );
    expect(response.status).toBe(200);
    expect(response.body.messages[0].failure.retry).toBeNull();
    expect(response.body.messages[0].failure.message).toMatch(
      /Settings|Run History/
    );
    expect(response.body.messages[0].failure.retryUnavailableReason).toMatch(
      /not saved|unavailable/i
    );
  });

  it("returns 404 before reading history for a non-owner", async () => {
    const { db, count } = historyDb([[]]);
    const response = await request(app(db)).get(
      "/api/companies/company/internal-agent/conversations/chat/messages"
    );
    expect(response.status).toBe(404);
    expect(count()).toBe(1);
  });

  it("does not expose failure details from a foreign company's run", async () => {
    const { db } = historyDb([
      [{ id: "chat", companyId: "company", userId: "owner" }],
      [user],
      [{ id: "failed-run", companyId: "foreign", userId: "owner", status: "failed", errorMessage: "FOREIGN-PRIVATE-ERROR" }],
    ]);
    const response = await request(app(db)).get(
      "/api/companies/company/internal-agent/conversations/chat/messages",
    );
    expect(response.status).toBe(200);
    expect(response.body.messages[0].failure.message).toMatch(/Settings/);
    expect(JSON.stringify(response.body)).not.toContain("FOREIGN-PRIVATE-ERROR");
  });
});

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...nodes: unknown[]) => ({ and: nodes }),
  isNull: (value: unknown) => ({ isNull: value }),
  desc: (value: unknown) => value,
  gt: (a: unknown, b: unknown) => ({ gt: [a, b] }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join("?"), values }),
    { raw: (value: string) => value },
  ),
}));
vi.mock("@armyofagents/db", () =>
  Object.fromEntries(
    [
      "companies",
      "companyMemberships",
      "internalAgentConversations",
      "internalAgentMessages",
      "internalAgentRuns",
      "jobs",
      "jobAttempts",
      "jobArtifacts",
    ].map((name) => [
      name,
      new Proxy(
        { _table: name },
        { get: (target, key) => (key === "_table" ? target._table : `${name}.${String(key)}`) },
      ),
    ]),
  ),
);
vi.mock("../db/tenant-context.js", () => ({
  runInTenant: async (db: unknown, _org: string, callback: (...args: unknown[]) => unknown) =>
    callback({}, db),
}));
vi.mock("../services/commander-job-authority.js", () => ({
  loadCommanderJobAuthority: async (db: any) => db.authority(),
}));

import { conversationService } from "../services/internal-agent/conversation.js";
import {
  createCommanderExistingTurnReader,
  createCommanderSourcePreparer,
} from "../services/commander-distributed-store.js";
import { createCommanderDistributedPort } from "../services/commander-distributed-port.js";
import { buildCommanderDistributedInvocation } from "../services/commander-distributed-invocation.js";
import { stagedPathMarker } from "../services/job-input-staging.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const originalRunId = "22222222-2222-4222-8222-222222222222";
const placeholderId = "33333333-3333-4333-8333-333333333333";
const input = {
  companyId,
  turnId: placeholderId,
  userId: "owner",
  userRole: "founder",
  conversationId: "chat",
  messageId: "message",
  cliTool: "codex",
  content: "Original input",
  model: "gpt-4.1",
  apiBaseUrl: "https://aoa.example/api",
  timeoutMs: 1000,
};

/** Stateful query-boundary double, not a PostgreSQL substitute. It checks the
 * emitted CAS guard before modeling its documented binding policy. The real
 * PostgreSQL variants live in commander-turn-claim.integration.test.ts. */
function fixture(turnStatus: "failed" | "running", previous: Record<string, unknown> = {}) {
  const message: any = {
    id: "message",
    conversationId: "chat",
    role: "user",
    runId: originalRunId,
    turnStatus,
    stale: true,
    clientSubmissionId: "original-submission",
    toolResults: {
      kind: "commander_submission",
      v: 1,
      payload: {
        message: "Original input",
        pageContext: null,
        contextScope: null,
        departmentContext: null,
        attachmentAssetIds: [],
      },
    },
  };
  const original: any = {
    id: originalRunId,
    companyId,
    userId: "owner",
    triggerType: "conversation",
    status: turnStatus,
    executionOwner: "distributed",
    distributedJobId: "paid-job",
    distributedAttemptId: "paid-attempt",
    conversationMessageId: "message",
    model: "gpt-4.1",
    ...previous,
  };
  const placeholder = {
    id: placeholderId,
    companyId,
    userId: "owner",
    triggerType: "conversation",
    status: "running",
    executionOwner: null,
    distributedJobId: null,
  };
  const invocation = buildCommanderDistributedInvocation({ ...input, turnId: originalRunId })!;
  const rows: Record<string, any[]> = {
    internalAgentRuns: [original, placeholder],
    internalAgentMessages: [message],
    internalAgentConversations: [{ id: "chat", companyId, userId: "owner" }],
    companies: [{ id: companyId, organizationId: "org" }],
    jobAttempts: [
      { id: "paid-attempt", organizationId: "org", companyId, jobId: "paid-job", attemptNumber: 1 },
    ],
    jobArtifacts: invocation.stagedFiles.map((file) => ({
      organizationId: "org",
      jobId: "paid-job",
      attempt: 1,
      kind: "staged_input",
      status: "committed",
      recoveryQuarantinedAt: null,
      leaseId: null,
      fenceToken: null,
      contentType: stagedPathMarker(file.path),
      sizeBytes: file.bytes.length,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
    })),
    jobs: [{ id: "paid-job", organizationId: "org", companyId, input: invocation.workload }],
  };
  const emitted: string[] = [];
  const resolve = (value: any, context: Record<string, any>): any => {
    if (typeof value === "string" && value.includes(".")) {
      const [table, field] = value.split(".");
      if (table in rows) return context[table]?.[field];
    }
    if (value?._table) return context[value._table];
    return value;
  };
  const evaluate = (node: any, context: Record<string, any>): boolean =>
    !node ||
    (node.and
      ? node.and.every((child: any) => evaluate(child, context))
      : node.eq
      ? resolve(node.eq[0], context) === resolve(node.eq[1], context)
      : node.isNull
      ? resolve(node.isNull, context) == null
      : true);
  const db: any = {
    execute: async (query: { text: string; values: unknown[] }) => {
      emitted.push(query.text);
      if (message.turnStatus !== "failed" && !(message.turnStatus === "running" && message.stale))
        return [];
      const guarded = /CASE/.test(query.text);
      if (guarded) {
        expect(query.text).toMatch(/execution_owner/);
        expect(query.text).toMatch(/distributed_job_id/);
        expect(query.text).toMatch(/distributed_attempt_id/);
        expect(query.text).toMatch(/company_id/);
        expect(query.text).toMatch(/user_id/);
      }
      const knownLegacy =
        [null, "legacy"].includes(original.executionOwner) &&
        !original.distributedJobId &&
        !original.distributedAttemptId &&
        original.companyId === companyId &&
        original.userId === "owner" &&
        ["failed", "cancelled"].includes(original.status);
      if (guarded) expect(query.text).not.toMatch(/previous_run.status IN \('running'/);
      if (!guarded || knownLegacy) message.runId = placeholderId;
      message.turnStatus = "running";
      message.stale = false;
      message.turnClaimToken = "winner-token";
      return [{ turnClaimToken: "winner-token" }];
    },
    select: (projection?: any) => {
      let table = "";
      let predicate: any;
      const chain: any = {
        from: (value: any) => {
          table = value._table;
          return chain;
        },
        innerJoin: () => chain,
        where: (value: any) => {
          predicate = value;
          return chain;
        },
        limit: () => chain,
        for: () => chain,
        then: (yes: (value: unknown) => unknown, no: (error: unknown) => unknown) =>
          Promise.resolve()
            .then(() =>
              (rows[table] ?? []).flatMap((row) => {
                const context = Object.fromEntries(
                  Object.entries(rows).map(([key, values]) => [
                    key,
                    key === table ? row : values[0],
                  ]),
                );
                if (!evaluate(predicate, context)) return [];
                return [
                  projection
                    ? Object.fromEntries(
                        Object.entries(projection).map(([key, value]) => [
                          key,
                          resolve(value, context),
                        ]),
                      )
                    : row,
                ];
              }),
            )
            .then(yes, no),
      };
      return chain;
    },
    transaction: async (callback: (tx: unknown) => unknown) => callback(db),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => Object.assign(message, values),
      }),
    }),
    authority: () =>
      message.runId === originalRunId
        ? { userId: "owner", turnId: originalRunId, conversationId: "chat" }
        : null,
  };
  return { db, message, original, emitted };
}

describe("Commander claim retains accepted distributed identity before rejoin", () => {
  it.each(["failed", "running"] as const)(
    "rejoins the original paid %s turn and cannot prepare or dispatch a replacement",
    async (status) => {
      const { db, message } = fixture(status);
      expect(await conversationService(db).claimTurn("message", placeholderId)).toBe(
        "winner-token",
      );
      expect(message.runId).toBe(originalRunId);
      const prepare = createCommanderSourcePreparer(db);
      expect(await prepare({ ...input, provider: "openai" })).toBe(false);
      const placement = vi.fn(async () => ({
        owner: "distributed",
        jobId: "NEW",
        attemptId: "NEW",
      }));
      const read = vi.fn(async () => ({
        state: "result" as const,
        result: {
          version: 1 as const,
          operationId: originalRunId,
          stdout: "Accepted answer",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          durationMs: 1,
          captureError: null,
        },
      }));
      const port = createCommanderDistributedPort({
        existing: createCommanderExistingTurnReader(db),
        prepare,
        read,
        cancel: async () => undefined,
        toolsAuthorized: () => true,
        preflight: async () => ({ allowed: true }),
        rollout: {
          resolveRunRolloutState: async () => ({ state: "canary", organizationId: "org" }),
          resolveExecutionOwner: placement,
        },
      } as never);
      expect(await port.execute(input)).toMatchObject({ operationId: originalRunId });
      expect(read).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: originalRunId, jobId: "paid-job" }),
        expect.anything(),
      );
      expect(placement).not.toHaveBeenCalled();
      expect(await conversationService(db).claimTurn("message", placeholderId)).toBeNull();
    },
  );

  it("updates ordinary failed legacy provenance without removing the winning claim token", async () => {
    const { db, message } = fixture("failed", {
      executionOwner: null,
      distributedJobId: null,
      distributedAttemptId: null,
    });
    expect(await conversationService(db).claimTurn("message", placeholderId)).toBe("winner-token");
    expect(message.runId).toBe(placeholderId);
    expect(message.turnClaimToken).toBe("winner-token");
  });

  it("retains a stale running legacy binding that may still be transferring ownership", async () => {
    const { db, message } = fixture("running", {
      executionOwner: null,
      distributedJobId: null,
      distributedAttemptId: null,
    });
    await conversationService(db).claimTurn("message", placeholderId);
    expect(message.runId).toBe(originalRunId);
    expect(await createCommanderSourcePreparer(db)({ ...input, provider: "openai" })).toBe(false);
  });

  it.each([
    { executionOwner: "distributed", distributedJobId: null },
    { executionOwner: null, distributedJobId: "paid-job" },
    { executionOwner: "unknown", distributedJobId: null },
    {
      companyId: "foreign",
      executionOwner: null,
      distributedJobId: null,
      distributedAttemptId: null,
    },
  ])("retains malformed or foreign prior authority conservatively: %j", async (previous) => {
    const { db, message } = fixture("failed", previous);
    await conversationService(db).claimTurn("message", placeholderId);
    expect(message.runId).toBe(originalRunId);
    expect(await createCommanderSourcePreparer(db)({ ...input, provider: "openai" })).toBe(false);
  });
});

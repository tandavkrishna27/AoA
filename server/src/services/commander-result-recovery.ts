import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { companies, internalAgentConversations, internalAgentMessages, internalAgentRuns, type Db } from "@armyofagents/db";
import type { CapturedOneShotResult, OneShotResultObservation, OneShotResultScope } from "./one-shot-distributed-result.js";
export type CommanderRecoveryCandidate = OneShotResultScope & {
  userId: string; conversationId: string; messageId: string; model: string; cliTool: string;
};
export function createCommanderRecoveryCandidateReader(ownerDb: Db) {
  return async (afterRunId: string | null): Promise<CommanderRecoveryCandidate[]> => {
    const rows = await ownerDb.select({ run: internalAgentRuns, organizationId: companies.organizationId,
      conversationId: internalAgentConversations.id, messageId: internalAgentMessages.id }).from(internalAgentRuns)
      .innerJoin(companies, eq(companies.id, internalAgentRuns.companyId))
      .innerJoin(internalAgentMessages, and(eq(internalAgentMessages.id, internalAgentRuns.conversationMessageId),
        eq(internalAgentMessages.runId, internalAgentRuns.id), eq(internalAgentMessages.role, "user")))
      .innerJoin(internalAgentConversations, and(eq(internalAgentConversations.id, internalAgentMessages.conversationId),
        eq(internalAgentConversations.companyId, internalAgentRuns.companyId), eq(internalAgentConversations.userId, internalAgentRuns.userId)))
      .where(and(eq(internalAgentRuns.executionOwner, "distributed"), eq(internalAgentRuns.triggerType, "conversation"),
        inArray(internalAgentRuns.status, ["running", "failed", "cancelled"]), afterRunId ? gt(internalAgentRuns.id, afterRunId) : undefined))
      .orderBy(asc(internalAgentRuns.id)).limit(32);
    return rows.flatMap(({ run, organizationId, conversationId, messageId }) =>
      organizationId && run.userId && run.model && run.distributedJobId && run.distributedAttemptId &&
      ["openai", "anthropic"].includes(run.provider ?? "") ? [{ organizationId, companyId: run.companyId,
        operationId: run.id, jobId: run.distributedJobId, attemptId: run.distributedAttemptId, userId: run.userId,
        conversationId, messageId, model: run.model, cliTool: run.provider === "openai" ? "codex" : "claude_cli" }] : []);
  };
}
/** Runs on the existing convergence timer; no new timer, spend or dispatch. */
export function createCommanderResultRecovery(deps: {
  list(afterRunId: string | null): Promise<CommanderRecoveryCandidate[]>;
  read(scope: OneShotResultScope, signal?: AbortSignal): Promise<OneShotResultObservation>;
  project(candidate: CommanderRecoveryCandidate, result: CapturedOneShotResult): Promise<void>;
  fail?(candidate: CommanderRecoveryCandidate): Promise<void>;
  retire?(candidate: CommanderRecoveryCandidate): Promise<void>;
  onError(error: unknown, candidate: CommanderRecoveryCandidate): void;
}) {
  let cursor: string | null = null; let running: Promise<void> | null = null;
  async function sweep() {
    const rows = await deps.list(cursor);
    const startedAt = Date.now(); let processed = 0;
    for (const candidate of rows) {
      if (Date.now() - startedAt >= 30000) break;
      processed += 1;
      const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([(async () => {
          const observation = await deps.read(candidate, controller.signal);
          if (observation.state === "result") await deps.project(candidate, observation.result);
          if (observation.state === "failed") await deps.fail?.(candidate);
        })(), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error("Commander recovery deadline")); }, 15000);
        })]);
      } catch (error) {
        try { await deps.retire?.(candidate); } catch (retirementError) { deps.onError(retirementError, candidate); }
        deps.onError(error, candidate);
      }
      finally { if (timer) clearTimeout(timer); }
    }
    cursor = processed < rows.length || rows.length === 32 ? rows[Math.max(0, processed - 1)]?.operationId ?? cursor : null;
  }
  return { tick(): Promise<void> {
    if (running) return running;
    running = sweep().finally(() => { running = null; }); return running;
  } };
}

import type { AgentStreamChunk } from "./internal-agent/agent-loop.js";
import { StreamJsonParser } from "./internal-agent/parse-stream-json.js";
import type { HeartbeatDistributedRolloutHook } from "./heartbeat-distributed-rollout.js";
import { buildCommanderDistributedInvocation, type CommanderDistributedInvocationInput } from "./commander-distributed-invocation.js";
import { waitForOneShotResult, type CapturedOneShotResult, type OneShotResultObservation, type OneShotResultScope } from "./one-shot-distributed-result.js";
import type { SandboxStagedFile } from "./task-run-sandbox-invocation.js";
export interface CommanderDistributedInput extends CommanderDistributedInvocationInput {
  warmConversation?: boolean;
  userId: string; userRole: string; conversationId: string; messageId: string;
}
export interface CommanderDistributedPort {
  /** Null is a choice before armed dispatch. Placement/owned failures stay errors. */
  execute(input: CommanderDistributedInput, onChunk?: (chunk: AgentStreamChunk) => void): Promise<CapturedOneShotResult | null>;
}
let registered: CommanderDistributedPort | undefined;
export function setCommanderDistributedPort(port: CommanderDistributedPort | undefined): void { registered = port; }
export function getCommanderDistributedPort(): CommanderDistributedPort | undefined { return registered; }
export function createCommanderDistributedPort(deps: {
  rollout: HeartbeatDistributedRolloutHook;
  toolsAuthorized(organizationId: string): boolean;
  existing(input: CommanderDistributedInput & { stagedFiles: SandboxStagedFile[]; warmStagedFiles?: SandboxStagedFile[] }): Promise<{ organizationId: string; jobId: string; attemptId: string; operationId?: string } | null>;
  isWarmEnabled?(): boolean;
  hasWarmOwner?(input: { companyId: string; userId: string; conversationId: string }): Promise<boolean>;
  hasLegacyWarmOwner?(input: { companyId: string; userId: string; conversationId: string }): Promise<boolean>;
  prepare(input: CommanderDistributedInput & { provider: "openai" | "anthropic" }): Promise<boolean>;
  preflight(input: { companyId: string }): Promise<{ allowed: boolean }>;
  read(scope: OneShotResultScope, signal?: AbortSignal): Promise<OneShotResultObservation>;
  cancel(scope: OneShotResultScope): Promise<unknown>;
  readLive?(scope: OneShotResultScope, afterSequence: number, signal?: AbortSignal): Promise<{ sequence: number; text: string }[]>;
  persistReply?(input: CommanderDistributedInput, scope: OneShotResultScope, result: CapturedOneShotResult): Promise<void>;
  recordFallback?(input: CommanderDistributedInput, result: CapturedOneShotResult): Promise<void>;
}): CommanderDistributedPort {
  const settle = async (input: CommanderDistributedInput, scope: OneShotResultScope, onChunk?: (chunk: AgentStreamChunk) => void) => {
    let cursor = 0;
    const parser = input.cliTool === "claude_cli" && onChunk && deps.readLive ? new StreamJsonParser() : null;
    const read = async (current: OneShotResultScope, signal?: AbortSignal) => {
      if (parser && deps.readLive) {
        const rows = await deps.readLive(current, cursor, signal);
        if (signal?.aborted) throw new Error("Commander stream read aborted");
        for (const row of rows) {
          if (!Number.isSafeInteger(row.sequence) || row.sequence <= cursor) continue;
          cursor = row.sequence;
          for (const chunk of parser.push(row.text)) {
            // Completion comes only from the accepted terminal + committed artifact.
            if (chunk.type === "done") continue;
            try { onChunk?.(chunk); } catch { /* Reader failure cannot redispatch or discard the result. */ }
          }
        }
      }
      return deps.read(current, signal);
    };
    const result = await waitForOneShotResult({ scope, timeoutMs: input.timeoutMs + 30000, read, cancel: deps.cancel });
    if (!result.usageAccepted && deps.recordFallback) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // The source key makes a late commit and a retry converge to one cost row.
        await Promise.race([deps.recordFallback(input, result), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Commander fallback cost write timed out")), 5000);
        })]);
      } finally { if (timer) clearTimeout(timer); }
    }
    if (deps.persistReply) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([deps.persistReply(input, scope, result), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Commander reply persistence timed out")), 10000);
        })]);
      } finally { if (timer) clearTimeout(timer); }
      return { ...result, replyPersisted: true };
    }
    return result;
  };
  return { async execute(input, onChunk) {
    let built = buildCommanderDistributedInvocation({ ...input, distributedWarm: false });
    if (!built) {
      if (await deps.hasWarmOwner?.(input)) throw new Error("Commander retained session requires distributed execution");
      return null;
    }
    // A durable owner may outlive its rollout switch. Rejoin before new-spend gates.
    const warmBuilt = buildCommanderDistributedInvocation({ ...input, distributedWarm: true });
    const owned = await deps.existing({ ...input, stagedFiles: built.stagedFiles,
      ...(warmBuilt ? { warmStagedFiles: warmBuilt.stagedFiles } : {}) });
    if (owned) return settle({ ...input, turnId: owned.operationId ?? input.turnId },
      { ...owned, companyId: input.companyId, operationId: owned.operationId ?? input.turnId }, onChunk);
    const held = await deps.hasWarmOwner?.(input) ?? false;
    const warmEnabled = input.warmConversation === true && deps.isWarmEnabled?.() === true;
    if (held && !warmEnabled) throw new Error("Commander retained session requires distributed execution");
    if (input.warmConversation && !warmEnabled) return null;
    if (warmEnabled) {
      if (!warmBuilt) throw new Error("Commander warm invocation unavailable");
      if (await deps.hasLegacyWarmOwner?.(input)) {
        if (held) throw new Error("Commander retained session has conflicting ownership");
        return null;
      }
      built = warmBuilt;
    }
    const rollout = await deps.rollout.resolveRunRolloutState({ companyId: input.companyId, sourceKind: "commander_turn" });
    if (rollout.state !== "canary" || !rollout.organizationId || !deps.toolsAuthorized(rollout.organizationId)) {
      if (held) throw new Error("Commander retained session requires distributed execution");
      return null;
    }
    if (!(await deps.preflight({ companyId: input.companyId })).allowed) throw new Error("Commander company budget exhausted");
    if (!await deps.prepare({ ...input, provider: built.provider })) throw new Error("Commander source authority unavailable");
    const owner = await deps.rollout.resolveExecutionOwner({ source: { kind: "commander_turn", internalAgentRunId: input.turnId,
      conversationId: input.conversationId }, actor: { kind: "user", id: input.userId, role: input.userRole as "founder" | "team_lead" | "team_member",
      companyId: input.companyId }, organizationId: rollout.organizationId, rolloutState: rollout.state,
      idempotencyKey: input.turnId, input: built.workload, stagedFiles: built.stagedFiles, toolSurfaceAuthorized: true });
    if (owner.owner !== "distributed") {
      if (held) throw new Error("Commander retained session requires distributed execution");
      throw new Error("Commander distributed placement unavailable");
    }
    // Deliberately outside the owner resolver's pre-transfer catch/fallback boundary.
    return settle(input, { companyId: input.companyId, organizationId: rollout.organizationId,
      jobId: owner.jobId, attemptId: owner.attemptId, operationId: input.turnId }, onChunk);
  } };
}

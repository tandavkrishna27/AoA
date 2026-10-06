import type { HeartbeatDistributedRolloutHook } from "./heartbeat-distributed-rollout.js";
import { buildCommanderDistributedInvocation, type CommanderDistributedInvocationInput } from "./commander-distributed-invocation.js";
import { waitForOneShotResult, type CapturedOneShotResult, type OneShotResultObservation, type OneShotResultScope } from "./one-shot-distributed-result.js";
import type { SandboxStagedFile } from "./task-run-sandbox-invocation.js";
export interface CommanderDistributedInput extends CommanderDistributedInvocationInput {
  warmConversation?: boolean;
  userId: string; userRole: string; conversationId: string; messageId: string;
}
export interface CommanderDistributedPort {
  /** Null is a pre-transfer legacy choice. Any error after ownership stays an error. */
  execute(input: CommanderDistributedInput): Promise<CapturedOneShotResult | null>;
}
let registered: CommanderDistributedPort | undefined;
export function setCommanderDistributedPort(port: CommanderDistributedPort | undefined): void { registered = port; }
export function getCommanderDistributedPort(): CommanderDistributedPort | undefined { return registered; }
export function createCommanderDistributedPort(deps: {
  rollout: HeartbeatDistributedRolloutHook;
  toolsAuthorized(organizationId: string): boolean;
  existing(input: CommanderDistributedInput & { stagedFiles: SandboxStagedFile[] }): Promise<{ organizationId: string; jobId: string; attemptId: string; operationId?: string } | null>;
  prepare(input: CommanderDistributedInput & { provider: "openai" | "anthropic" }): Promise<boolean>;
  preflight(input: { companyId: string }): Promise<{ allowed: boolean }>;
  read(scope: OneShotResultScope, signal?: AbortSignal): Promise<OneShotResultObservation>;
  cancel(scope: OneShotResultScope): Promise<unknown>;
  persistReply?(input: CommanderDistributedInput, scope: OneShotResultScope, result: CapturedOneShotResult): Promise<void>;
  recordFallback?(input: CommanderDistributedInput, result: CapturedOneShotResult): Promise<void>;
}): CommanderDistributedPort {
  const settle = async (input: CommanderDistributedInput, scope: OneShotResultScope) => {
    const result = await waitForOneShotResult({ scope, timeoutMs: input.timeoutMs + 30000, read: deps.read, cancel: deps.cancel });
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
  return { async execute(input) {
    const built = buildCommanderDistributedInvocation(input);
    if (!built) return null;
    // A durable owner may outlive its rollout switch. Rejoin before new-spend gates.
    const owned = await deps.existing({ ...input, stagedFiles: built.stagedFiles });
    if (owned) return settle({ ...input, turnId: owned.operationId ?? input.turnId },
      { ...owned, companyId: input.companyId, operationId: owned.operationId ?? input.turnId });
    // Batch capture is ephemeral; existing warm resources keep their legacy owner.
    if (input.warmConversation) return null;
    const rollout = await deps.rollout.resolveRunRolloutState({ companyId: input.companyId, sourceKind: "commander_turn" });
    if (rollout.state !== "canary" || !rollout.organizationId || !deps.toolsAuthorized(rollout.organizationId)) return null;
    if (!(await deps.preflight({ companyId: input.companyId })).allowed) throw new Error("Commander company budget exhausted");
    if (!await deps.prepare({ ...input, provider: built.provider })) throw new Error("Commander source authority unavailable");
    const owner = await deps.rollout.resolveExecutionOwner({ source: { kind: "commander_turn", internalAgentRunId: input.turnId,
      conversationId: input.conversationId }, actor: { kind: "user", id: input.userId, role: input.userRole as "founder" | "team_lead" | "team_member",
      companyId: input.companyId }, organizationId: rollout.organizationId, rolloutState: rollout.state,
      idempotencyKey: input.turnId, input: built.workload, stagedFiles: built.stagedFiles, toolSurfaceAuthorized: true });
    if (owner.owner !== "distributed") return null;
    // Deliberately outside the owner resolver's pre-transfer catch/fallback boundary.
    return settle(input, { companyId: input.companyId, organizationId: rollout.organizationId,
      jobId: owner.jobId, attemptId: owner.attemptId, operationId: input.turnId });
  } };
}

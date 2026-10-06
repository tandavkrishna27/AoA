import type { HeartbeatDistributedRolloutHook } from "./heartbeat-distributed-rollout.js";
import type { RunOneShotCliInput } from "./one-shot-sandbox-cli.js";
import { buildOneShotDistributedInvocation } from "./one-shot-distributed-invocation.js";
import { waitForOneShotResult, type CapturedOneShotResult, type OneShotResultObservation, type OneShotResultScope } from "./one-shot-distributed-result.js";

type Invocation = Omit<RunOneShotCliInput, "db" | "deps"> & { operationId: string };
export interface OneShotDistributedPort {
  /** null means no transfer. A placed invocation can only return a result or throw. */
  execute(input: Invocation): Promise<CapturedOneShotResult | null>;
  /** Rejoin an existing operation without authorizing any new model spend. */
  resume?(input: Invocation): Promise<CapturedOneShotResult | null>;
  prefersDistributed?(companyId: string): Promise<boolean>;
}
let registered: OneShotDistributedPort | undefined;
export function setOneShotDistributedPort(port: OneShotDistributedPort | undefined): void { registered = port; }
export function getOneShotDistributedPort(): OneShotDistributedPort | undefined { return registered; }

export function createOneShotDistributedPort(deps: {
  rollout: HeartbeatDistributedRolloutHook;
  read(scope: OneShotResultScope, signal?: AbortSignal): Promise<OneShotResultObservation>;
  cancel(scope: OneShotResultScope): Promise<unknown>;
  existing?(input: { companyId: string; organizationId: string; operationId: string;
    operationKind: "extraction" | "compaction" | "readiness_probe"; workload: Record<string, unknown> }): Promise<{ jobId: string; attemptId: string } | null>;
}): OneShotDistributedPort {
  const resume = async (input: Invocation) => {
    if (input.sandboxHandle || !deps.existing) return null;
    const built = buildOneShotDistributedInvocation(input);
    if (!built) return null;
    const rollout = await deps.rollout.resolveRunRolloutState({ companyId: input.companyId, sourceKind: "one_shot" });
    if (rollout.state !== "canary" || !rollout.organizationId) return null;
    const existing = await deps.existing({ companyId: input.companyId, organizationId: rollout.organizationId,
      operationId: input.operationId, operationKind: input.source === "readiness" ? "readiness_probe" : input.source, workload: built.workload });
    return existing ? waitForOneShotResult({
      scope: { companyId: input.companyId, organizationId: rollout.organizationId, operationId: input.operationId, ...existing },
      timeoutMs: input.timeoutMs + 30_000, read: deps.read, cancel: deps.cancel,
    }) : null;
  };
  return {
    resume,
    async prefersDistributed(companyId) {
      const resolution = await deps.rollout.resolveRunRolloutState({ companyId, sourceKind: "one_shot" });
      return resolution.state === "canary" && resolution.organizationId !== null;
    },
    async execute(input) {
      // Reused batch leases have already acquired a legacy owner. Never place a second executor.
      if (input.sandboxHandle) return null;
      const built = buildOneShotDistributedInvocation(input);
      if (!built) return null;
      const rollout = await deps.rollout.resolveRunRolloutState({ companyId: input.companyId, sourceKind: "one_shot" });
      if (rollout.state !== "canary" || !rollout.organizationId) return null;
      const operationKind = input.source === "readiness" ? "readiness_probe" : input.source;
      const existing = await deps.existing?.({ companyId: input.companyId, organizationId: rollout.organizationId,
        operationId: input.operationId, operationKind, workload: built.workload });
      if (existing) return waitForOneShotResult({
        scope: { companyId: input.companyId, organizationId: rollout.organizationId, operationId: input.operationId, ...existing },
        timeoutMs: input.timeoutMs + 30_000, read: deps.read, cancel: deps.cancel,
      });
      const owner = await deps.rollout.resolveExecutionOwner({
        source: { kind: "one_shot", operationId: input.operationId,
          operationKind },
        actor: { kind: "system", companyId: input.companyId, id: input.companyId },
        organizationId: rollout.organizationId, rolloutState: rollout.state,
        idempotencyKey: input.operationId, input: built.workload, stagedFiles: built.stagedFiles,
        toolSurfaceAuthorized: false,
      });
      if (owner.owner !== "distributed") return null;
      const scope = { companyId: input.companyId, organizationId: rollout.organizationId,
        jobId: owner.jobId, attemptId: owner.attemptId, operationId: input.operationId };
      // Waiting is deliberately OUTSIDE the ownership resolver. Its failure must not run legacy.
      return waitForOneShotResult({ scope, timeoutMs: input.timeoutMs + 30_000, read: deps.read, cancel: deps.cancel });
    },
  };
}

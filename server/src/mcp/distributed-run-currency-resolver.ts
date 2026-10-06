// server/src/mcp/distributed-run-currency-resolver.ts
//
// DAT-007 item #1, slice 2 — the DB reader that resolves a signed run id to the
// row snapshot the PURE `classifyRunCurrency` decision (./distributed-run-currency.ts)
// consumes. Kept in its OWN module so the classifier stays drizzle-free and its
// cross-platform Tier-1 unit test never drags drizzle-orm into the vitest ESM cycle
// (the isolation pattern `lease-truth.ts` establishes; see CLAUDE.md Test Patterns).
//
// The query is the `guardActiveFence` join (job-control.ts:1920-1967) with a
// `heartbeat_runs` or `internal_agent_runs` hop on top: keyed on the SIGNED run id (a PRIMARY KEY probe), it
// LEFT-JOINs the distributed attempt, its offered/active lease, and the lease's
// execution target, computing lease freshness against the DB `clock_timestamp()` in
// SQL. Every hop is a unique-index probe, so the read is bounded and never scans.
//
// FAIL-CLOSED: any thrown DB/exec error propagates. The `/mcp` mount runs this inside
// the route's try/catch (server.ts), so a throw becomes a 500 that DENIES access — the
// reader must NEVER catch-and-return "admit".

import type { Db } from "@armyofagents/db";
import { companyMemberships, executionTargets, heartbeatRuns, internalAgentConversations, internalAgentMessages, internalAgentRuns, jobs, jobAttempts, leases } from "@armyofagents/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { submitJobSourceSchema } from "@armyofagents/shared";

import { classifyRunCurrency, type RunCurrencyVerdict } from "./distributed-run-currency.js";

export interface DistributedRunCurrencyResolver {
  /** Resolve the currency verdict for a distributed run-JWT actor. `signedRunId` is the
   *  SIGNED `run_id` claim (never the header-overridable `req.actor.runId`). */
  resolve(input: {
    signedRunId: string;
    companyId: string;
    agentId: string | null;
    commander?: { userId: string; conversationId: string };
  }): Promise<RunCurrencyVerdict>;
}

export function createDistributedRunCurrencyResolver(db: Db): DistributedRunCurrencyResolver {
  return {
    async resolve({ signedRunId, companyId, agentId, commander }): Promise<RunCurrencyVerdict> {
      async function load(run: typeof heartbeatRuns | typeof internalAgentRuns) {
        const [row] = await db
          .select({
            runCompanyId: run.companyId,
            runUserId: run === internalAgentRuns ? internalAgentRuns.userId : sql<string | null>`NULL`,
            runTriggerType: run === internalAgentRuns ? internalAgentRuns.triggerType : sql<string | null>`NULL`,
            distributedJobId: run.distributedJobId,
            runAgentId: run.agentId,
            executionOwner: run.executionOwner,
            attemptStatus: jobAttempts.status,
            leaseStatus: leases.status,
            // Freshness against a FRESH database clock, in SQL — matching renewLease's strict
            // `>` with no grace (job-control.ts:4041-4062). NULL expiry compares NULL → not fresh.
            expiresFresh: sql<boolean>`(${leases.expiresAt} > clock_timestamp())`,
            leaseTargetGeneration: leases.targetGeneration,
            targetDeviceGeneration: executionTargets.deviceGeneration,
            targetStatus: executionTargets.status,
          })
          .from(run)
          // The distributed attempt — joined ONLY for a run actually handed off to a worker.
          // A local run (execution_owner NULL) or one with no distributed attempt yields a null
          // attempt row, and the classifier admits it on `execution_owner !== "distributed"`.
          .leftJoin(
            jobAttempts,
            and(
              eq(run.executionOwner, "distributed"),
              eq(jobAttempts.id, run.distributedAttemptId),
              eq(jobAttempts.jobId, run.distributedJobId),
              eq(jobAttempts.companyId, run.companyId),
            ),
          )
          // The attempt's current offered/active lease (leases_active_per_attempt_idx → ≤1 row).
          .leftJoin(
            leases,
            and(eq(leases.attemptId, jobAttempts.id), inArray(leases.status, ["offered", "active"])),
          )
          // The lease's execution target (for the generation/disabled supersede cutoff).
          .leftJoin(
            executionTargets,
            and(
              eq(executionTargets.targetAuthorityKey, leases.targetAuthorityKey),
              eq(executionTargets.id, leases.targetId),
            ),
          )
          .where(eq(run.id, signedRunId))
          .limit(1);
        return row;
      }
      const row = commander ? await load(internalAgentRuns) : await load(heartbeatRuns) ?? await load(internalAgentRuns);

      // No run row for this signed run id → not an org distributed run this gate covers.
      if (!row) {
        if (commander) return "deny";
        return classifyRunCurrency(
          {
            runFound: false,
            runCompanyId: null,
            executionOwner: null,
            attemptStatus: null,
            leaseStatus: null,
            expiresFresh: false,
            targetSuperseded: true,
          },
          companyId,
        );
      }

      if (agentId && row.runAgentId !== agentId) return "deny";
      if (commander) {
        if (!commander.userId || !commander.conversationId || row.runUserId !== commander.userId ||
          row.runCompanyId !== companyId || row.runTriggerType !== "conversation") return "deny";
        const [conversation] = await db.select({ id: internalAgentConversations.id }).from(internalAgentConversations)
          .innerJoin(internalAgentMessages, eq(internalAgentMessages.conversationId, internalAgentConversations.id))
          .innerJoin(companyMemberships, and(eq(companyMemberships.companyId, internalAgentConversations.companyId),
            eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, commander.userId),
            eq(companyMemberships.status, "active")))
          .where(and(eq(internalAgentMessages.runId, signedRunId), eq(internalAgentConversations.id, commander.conversationId),
            eq(internalAgentConversations.companyId, companyId), eq(internalAgentConversations.userId, commander.userId))).limit(1);
        if (!conversation) return "deny";
        if (row.executionOwner === "distributed") {
          const [job] = await db.select().from(jobs)
            .where(and(eq(jobs.id, row.distributedJobId!), eq(jobs.companyId, companyId))).limit(1);
          const source = submitJobSourceSchema.safeParse(job?.sourceIntent);
          if (!job || job.sourceKind !== "commander_turn" || !source.success || source.data.kind !== "commander_turn" ||
            source.data.internalAgentRunId !== signedRunId || source.data.conversationId !== commander.conversationId ||
            job.requesterPrincipalKind !== "user" || job.requesterPrincipalId !== commander.userId ||
            job.executorPrincipalKind !== "sandbox" || job.executorPrincipalId !== signedRunId ||
            job.sourceIdentity !== signedRunId) return "deny";
        }
      }


      // The generation-only half of guardActiveFence's target_revoked cutoff, fail-CLOSED:
      // an absent target (left-join miss → null generation), a null lease generation, a
      // generation that moved past the lease's stored one, or a disabled target → superseded.
      const targetSuperseded =
        row.targetDeviceGeneration === null ||
        row.leaseTargetGeneration === null ||
        row.targetDeviceGeneration !== row.leaseTargetGeneration ||
        row.targetStatus === "disabled";

      return classifyRunCurrency(
        {
          runFound: true,
          runCompanyId: row.runCompanyId,
          executionOwner: row.executionOwner,
          attemptStatus: row.attemptStatus,
          leaseStatus: row.leaseStatus,
          expiresFresh: row.expiresFresh === true,
          targetSuperseded,
        },
        companyId,
      );
    },
  };
}

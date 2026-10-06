/**
 * P3-T1: Crew result relay.
 *
 * When a crew-thread deliverable task finishes successfully, post a visible
 * `agent` entry to the source thread so the result surfaces in the chat.
 * This is the success counterpart to crew-failure-card.ts (P2-T2), which
 * posts a `system` entry when a run fails.
 *
 * Guards (Codex #18 — relay ONLY for crew-thread tasks):
 *   - issues.originKind !== 'crew_thread' → no-op ({ posted: false })
 *   - issues.sourceDiscussionId is null   → no-op ({ posted: false })
 *
 * The entry:
 *   - inputType: 'agent'           (visible as an agent message in the chat)
 *   - authorAgentId: assigneeAgentId  (the agent that did the work)
 *   - createdBy: assigneeAgentId   (mirrors crew-failure-card sentinel pattern)
 *   - extractionStatus: 'skipped'  (not prose for the LLM extractor)
 *   - rawContent: human-readable completion summary with task title + id link
 *   - seq: bumped from discussions.entrySeq atomically (same as crew-failure-card)
 *
 * Best-effort caller contract: callers should wrap this in try/catch so a
 * posting failure never masks the underlying task completion (mirroring the
 * crew-failure-card design).
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { issues, discussions, discussionEntries } from "@armyofagents/db";
import type { ShowRef } from "@armyofagents/shared";
import { publishLiveEvent } from "./live-events.js";
import { synthesizeThreadDeliveryRefs } from "./viewer-ref-synthesis.js";
import { insertActivityLog } from "./activity-log.js";
import { logger } from "../middleware/logger.js";

const log = logger.child({ svc: "crew-result-relay" });

export interface RelayCrewResultResult {
  posted: boolean;
}

/**
 * Post the completion entry for a crew-thread deliverable task into its
 * source thread. Returns { posted: true } when an entry was inserted, or
 * { posted: false } for the two no-op guard cases.
 */
export async function relayCrewResult(
  db: Db,
  params: { issueId: string },
): Promise<RelayCrewResultResult> {
  // ── Load the issue (only the fields we need) ──────────────────────────────
  const [issue] = await db
    .select({
      id: issues.id,
      title: issues.title,
      status: issues.status,
      originKind: issues.originKind,
      sourceDiscussionId: issues.sourceDiscussionId,
      assigneeAgentId: issues.assigneeAgentId,
      companyId: issues.companyId,
    })
    .from(issues)
    .where(eq(issues.id, params.issueId));

  if (!issue) {
    log.warn({ issueId: params.issueId }, "crew-result-relay: issue not found");
    return { posted: false };
  }

  // ── Guard 1: only relay crew-thread tasks (Codex #18) ────────────────────
  if (issue.originKind !== "crew_thread") {
    return { posted: false };
  }

  // ── Guard 2: must have a source thread to post into ───────────────────────
  if (!issue.sourceDiscussionId) {
    return { posted: false };
  }

  // A successful adapter process is not the same thing as a completed task.
  // The legacy callers invoke this relay when a run exits successfully, so
  // refuse to publish completion wording unless the task itself is done.
  if (issue.status !== "done") {
    return { posted: false };
  }

  const threadId = issue.sourceDiscussionId;
  // Use the assignee agent id as both author and createdBy (mirrors the
  // crew-failure-card pattern where agentId fills the createdBy sentinel).
  // If for some reason the assignee is null (edge case: re-assigned after
  // completion), fall back to the issue id as a safe non-null sentinel.
  const agentId: string = issue.assigneeAgentId ?? issue.id;

  // ── Guard 3: multi-tenant companyId cross-check (Codex #6) ───────────────
  // Verify the source discussion belongs to the SAME company as the issue.
  // An explicit check here + a constrained UPDATE below ensure a cross-company
  // update cannot happen even if auth somehow passes.
  const [sourceThread] = await db
    .select({ companyId: discussions.companyId })
    .from(discussions)
    .where(eq(discussions.id, threadId));

  if (!sourceThread || sourceThread.companyId !== issue.companyId) {
    log.warn(
      { issueId: params.issueId, issueCompanyId: issue.companyId, threadId, threadCompanyId: sourceThread?.companyId },
      "crew-result-relay: companyId mismatch — refusing to post cross-company entry",
    );
    return { posted: false };
  }

  const rawContent = `Completed: "${issue.title}" (task ${issue.id})`;
  const now = new Date();

  // ── Atomic insert: bump entrySeq + entryCount, assign seq ─────────────────
  const { entry, companyId } = await db.transaction(async (tx) => {
    // Constrained UPDATE: include companyId in WHERE so a cross-company write
    // is impossible even if the explicit check above were somehow bypassed.
    const [{ entrySeq, companyId: cid }] = await tx
      .update(discussions)
      .set({
        entrySeq: sql`${discussions.entrySeq} + 1`,
        entryCount: sql`${discussions.entryCount} + 1`,
        updatedAt: now,
      })
      .where(and(eq(discussions.id, threadId), eq(discussions.companyId, issue.companyId)))
      .returning({ entrySeq: discussions.entrySeq, companyId: discussions.companyId });

    const [inserted] = await tx
      .insert(discussionEntries)
      .values({
        discussionId: threadId,
        inputType: "agent",
        rawContent,
        authorAgentId: issue.assigneeAgentId ?? null,
        createdBy: agentId,
        extractionStatus: "skipped",
        seq: entrySeq,
      })
      .returning();

    return { entry: inserted, companyId: cid };
  });

  // ── Publish live events (same pair as crew-failure-card) ──────────────────
  publishLiveEvent({
    companyId,
    type: "discussion.entry.created",
    payload: { discussionId: threadId, entryId: entry.id, inputType: "agent" },
  });
  publishLiveEvent({
    companyId,
    type: "thread.entry.created",
    payload: { threadId, entryId: entry.id, seq: entry.seq ?? 0 },
  });

  log.debug(
    { threadId, issueId: params.issueId },
    "posted crew-result relay entry",
  );

  return { posted: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Viewer Upgrade Phase 7B / Task 4 — on-run-finish "run result" delivery
// ────────────────────────────────────────────────────────────────────────────

export interface DeliverCrewRunResultInput {
  db: Db;
  companyId: string;
  issueId: string;
  runId: string;
  agentId: string | null;
  /** Reconcile late committed products into the same entry. */
  refreshExisting?: boolean;
}

export interface DeliverCrewRunResultDeps {
  /** Injected for tests; production uses the real synthesizer. */
  synthesize: typeof synthesizeThreadDeliveryRefs;
}

export interface DeliverCrewRunResultResult {
  delivered: boolean;
}

/**
 * Deliver the NAVIGATIONAL refs a crew run produced onto its originating
 * Discussion thread when the run FINISHES — **regardless of task status**
 * (in-review included). This is a SEPARATE side-effect from the `done`-gated
 * `relayCrewResult` ("Completed: …" entry): both can legitimately fire for one
 * task lifecycle (a run finishes while the task stays in review → run-result
 * entry now; the task later transitions to done → "Completed" entry then). They
 * never duplicate each other — the run-result entry is anchored per `runId`,
 * the "Completed" entry is the done transition.
 *
 * Keeps Decision #109 (technical run completion ≠ task completion): this posts
 * on run finish without asserting completion wording or flipping task status.
 *
 * Contract:
 *   - Thread-only: derive `threadId` from `issues.sourceDiscussionId`; no thread
 *     → no delivery (nothing to deliver to).
 *   - Idempotent per `runId` (P3-1): a prior run-result entry for this runId
 *     (marked via `sourceInfo.runResultRunId`) → no double-post.
 *   - RBAC (P2-2): the entry lands ONLY on the origin thread; every synthesized
 *     ref's `provenance.entityId` MUST equal that threadId (the synth helper
 *     sets it — we assert it defensively; a mismatch aborts the delivery).
 *   - Best-effort: wrapped in try/catch. NEVER throws into the crew run.
 *
 * Returns `{ delivered: true }` when an entry was inserted or its products refreshed.
 */
export async function deliverCrewRunResult(
  input: DeliverCrewRunResultInput,
  deps: DeliverCrewRunResultDeps = { synthesize: synthesizeThreadDeliveryRefs },
): Promise<DeliverCrewRunResultResult> {
  const { db, companyId, issueId, runId, agentId } = input;
  try {
    const result = await db.transaction(async (tx) => {
      const [issue] = await tx.select({ id: issues.id, sourceDiscussionId: issues.sourceDiscussionId,
        assigneeAgentId: issues.assigneeAgentId, companyId: issues.companyId })
        .from(issues).where(and(eq(issues.id, issueId), eq(issues.companyId, companyId))).limit(1);
      if (!issue?.sourceDiscussionId) return null;
      const threadId = issue.sourceDiscussionId;
      // Serialize every delivery and refresh on the company-scoped parent. The
      // idempotency read belongs inside this lock, before any counter increment.
      const [thread] = await tx.select({ id: discussions.id }).from(discussions)
        .where(and(eq(discussions.id, threadId), eq(discussions.companyId, companyId)))
        .limit(1).for("update");
      if (!thread) return null;
      const [prior] = await tx.select({ id: discussionEntries.id, seq: discussionEntries.seq,
        outputRefs: discussionEntries.outputRefs, rawContent: discussionEntries.rawContent })
        .from(discussionEntries).where(and(eq(discussionEntries.discussionId, threadId),
          sql`${discussionEntries.sourceInfo}->>'runResultRunId' = ${runId}`)).limit(1);
      if (prior && !input.refreshExisting) return null;
      const refs = await deps.synthesize({ db: tx as unknown as Db, companyId, issueId, threadId, runId, agentId });
      for (const ref of refs) {
        if (ref.v === 2 && ref.provenance && ref.provenance.entityId !== threadId) {
          throw new Error("Crew result ref belongs to another thread");
        }
      }
      const count = Math.max(0, refs.length - 1);
      const rawContent = count ? `Run finished — ${count} result${count === 1 ? "" : "s"}` : "Run finished";
      // A new synthesis timestamp alone is not a changed product. Preserve the
      // original refs on a no-op to avoid perpetual writes on each recovery tick.
      const comparable = (value: unknown) => JSON.stringify(value, (key, val) => {
        if (key === "emittedAt") return undefined;
        // jsonb canonicalizes object-key order; preserve array order, but sort
        // object keys so a read-back compares equal to the freshly built refs.
        if (val && typeof val === "object" && !Array.isArray(val)) {
          return Object.fromEntries(Object.entries(val).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
        }
        return val;
      });
      if (prior && prior.rawContent === rawContent && comparable(prior.outputRefs) === comparable(refs)) return null;
      const now = new Date();
      if (prior) {
        const [entry] = await tx.update(discussionEntries).set({ outputRefs: refs, rawContent })
          .where(and(eq(discussionEntries.id, prior.id), eq(discussionEntries.discussionId, threadId))).returning();
        await tx.update(discussions).set({ updatedAt: now })
          .where(and(eq(discussions.id, threadId), eq(discussions.companyId, companyId)));
        await insertActivityLog(tx as unknown as Db, { companyId, actorType: "system", actorId: "crew-result-recovery",
          action: "discussion.entry.results_refreshed", entityType: "discussion_entry", entityId: entry.id,
          agentId, details: { crewRunId: runId, issueId } });
        return { entry, threadId };
      }
      const [{ entrySeq }] = await tx.update(discussions).set({
        entrySeq: sql`${discussions.entrySeq} + 1`, entryCount: sql`${discussions.entryCount} + 1`, updatedAt: now,
      }).where(and(eq(discussions.id, threadId), eq(discussions.companyId, companyId)))
        .returning({ entrySeq: discussions.entrySeq });
      const [entry] = await tx.insert(discussionEntries).values({ discussionId: threadId, inputType: "agent",
        rawContent, authorAgentId: agentId ?? issue.assigneeAgentId ?? null,
        createdBy: agentId ?? issue.assigneeAgentId ?? issue.id, extractionStatus: "skipped", seq: entrySeq,
        outputRefs: refs, sourceInfo: { runResultRunId: runId },
      }).returning();
      await insertActivityLog(tx as unknown as Db, { companyId, actorType: "system", actorId: "crew-result-delivery",
        action: "discussion.entry.run_result_delivered", entityType: "discussion_entry", entityId: entry.id,
        agentId, details: { crewRunId: runId, issueId } });
      return { entry, threadId };
    });
    if (!result) return { delivered: false };
    // Existing refetch events retain the entry identity on an in-place refresh.
    publishLiveEvent({ companyId, type: "discussion.entry.created",
      payload: { discussionId: result.threadId, entryId: result.entry.id, inputType: "agent" } });
    publishLiveEvent({ companyId, type: "thread.entry.created",
      payload: { threadId: result.threadId, entryId: result.entry.id, seq: result.entry.seq ?? 0 } });
    return { delivered: true };
  } catch (err) {
    log.warn({ err, issueId, runId }, "deliverCrewRunResult failed (non-fatal)");
    return { delivered: false };
  }
}

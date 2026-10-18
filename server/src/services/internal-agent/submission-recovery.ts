import { and, eq, inArray, or } from "drizzle-orm";
import {
  internalAgentMessages,
  internalAgentRuns,
  type Db,
} from "@armyofagents/db";
import { z } from "zod";
import { chatMessageSchema } from "@armyofagents/shared";

const submissionPayloadSchema = chatMessageSchema
  .pick({
    message: true,
    pageContext: true,
    departmentContext: true,
    contextScope: true,
    attachmentAssetIds: true,
  })
  .required();
const snapshotSchema = z.object({
  kind: z.literal("commander_submission"),
  v: z.literal(1),
  payload: submissionPayloadSchema,
});

/** User rows have no tool results. Reuse that JSON slot for explicitly tagged,
 * versioned input metadata; never put credentials, file bytes or authority here. */
export function submissionSnapshot(input: {
  content: string;
  pageContext?: string | null;
  departmentContext?: string | null;
  contextScope?: unknown;
  attachmentAssetIds?: string[];
}) {
  return {
    kind: "commander_submission" as const,
    v: 1 as const,
    payload: {
      message: input.content,
      pageContext: input.pageContext ?? null,
      departmentContext: input.departmentContext ?? null,
      contextScope: input.contextScope ?? null,
      attachmentAssetIds: input.attachmentAssetIds ?? [],
    },
  };
}

export function readSubmissionSnapshot(value: unknown) {
  const parsed = snapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Called only after conversation access has been established. Run lookup and
 * public retry payloads remain bound to the conversation's company and owner. */
export async function recoverConversationMessages(
  db: Db,
  conversation: { id: string; companyId: string; userId: string },
  actorId: string,
  messages: (typeof internalAgentMessages.$inferSelect)[]
) {
  const failedUsers = messages.filter(
    (m) => m.role === "user" && m.turnStatus === "failed"
  );
  const runIds = failedUsers.flatMap((m) => (m.runId ? [m.runId] : []));
  const runs = failedUsers.length
    ? await db
        .select({
          id: internalAgentRuns.id,
          companyId: internalAgentRuns.companyId,
          userId: internalAgentRuns.userId,
          status: internalAgentRuns.status,
          errorMessage: internalAgentRuns.errorMessage,
          conversationMessageId: internalAgentRuns.conversationMessageId,
        })
        .from(internalAgentRuns)
        .where(
          and(
            eq(internalAgentRuns.companyId, conversation.companyId),
            eq(internalAgentRuns.userId, conversation.userId),
            or(
              inArray(internalAgentRuns.id, runIds),
              inArray(
                internalAgentRuns.conversationMessageId,
                failedUsers.map((m) => m.id)
              )
            )
          )
        )
    : [];
  return messages.map((m) => {
    // Raw user toolResults is internal metadata, including on founder reads.
    const { toolResults, turnClaimToken: _claimToken, ...publicMessage } = m;
    if (m.role !== "user") return { ...publicMessage, toolResults };
    if (m.turnStatus !== "failed") return publicMessage;
    const boundRuns = runs.filter(
      (run) =>
        run.companyId === conversation.companyId &&
        run.userId === conversation.userId &&
        (m.runId ? run.id === m.runId : run.conversationMessageId === m.id)
    );
    const run =
      boundRuns.length === 1 && boundRuns[0].status === "failed"
        ? boundRuns[0]
        : null;
    const snapshot = readSubmissionSnapshot(toolResults);
    let retryUnavailableReason: string | null = null;
    if (actorId !== conversation.userId) {
      retryUnavailableReason =
        "Only the conversation owner can retry this submission.";
    } else if (
      !snapshot ||
      snapshot.payload.message !== m.content ||
      !m.clientSubmissionId
    ) {
      retryUnavailableReason =
        "The original attachments and context were not saved. Edit and review the message and references before sending again.";
    } else if (
      messages.some(
        (reply) =>
          reply.role === "assistant" && reply.replyToUserMessageId === m.id
      )
    ) {
      retryUnavailableReason =
        "A partial reply is saved. Review Run History before editing or starting another turn.";
    }
    return {
      ...publicMessage,
      failure: {
        message:
          run?.errorMessage ||
          "Commander could not complete this turn. Check Settings and Run History before retrying.",
        retry:
          retryUnavailableReason || !snapshot
            ? null
            : { ...snapshot.payload, clientSubmissionId: m.clientSubmissionId },
        retryUnavailableReason,
      },
    };
  });
}

export type CommanderSubmissionOutcome =
  | { state: "not_found" }
  | { state: "accepted"; userMessageId: string }
  | { state: "completed"; userMessageId: string; assistantMessageId: string }
  | { state: "failed"; userMessageId: string };

export function classifyCommanderSubmissionOutcome(
  userMessage: { id: string; turnStatus?: string | null } | null,
  assistantMessage: { id: string } | null,
): CommanderSubmissionOutcome {
  if (!userMessage) return { state: "not_found" };
  if (assistantMessage) {
    return { state: "completed", userMessageId: userMessage.id, assistantMessageId: assistantMessage.id };
  }
  if (userMessage.turnStatus === "failed") {
    return { state: "failed", userMessageId: userMessage.id };
  }
  return { state: "accepted", userMessageId: userMessage.id };
}

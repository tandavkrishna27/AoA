import { describe, it, expect } from "vitest";
import { mergeServerMessagesWithTransientLocal } from "./InternalAgentPanel";
import type { AgentMessage } from "../api/internal-agent";

const serverMsg: AgentMessage = {
  id: "m1",
  role: "assistant",
  content: "done",
  toolCalls: [{ name: "create_task", success: true, summary: "Created task X" }],
  reasoning: null,
  outputRefs: null,
  pageContext: null,
  createdAt: "2026-06-16T00:00:00Z",
};

describe("tool activity survives server→local mapping", () => {
  it("retains failed partial-reply guidance after a hard reload", () => {
    const merged = mergeServerMessagesWithTransientLocal([
      { ...serverMsg, turnStatus: "failed", content: "Partial answer" },
    ], []);
    expect(merged[0]!.content).toContain("Partial answer");
    expect(merged[0]!.content).toContain("incomplete");
    expect(merged[0]!.content).toContain("Run History");
  });

  it("rehydrates a persisted legacy OPTIONS prompt without granting runtime approval", () => {
    const merged = mergeServerMessagesWithTransientLocal([
      { ...serverMsg, toolCalls: null, content: 'Ready to proceed. ⚡OPTIONS:{"confirm":true}⚡' },
    ], []);
    expect(merged[0]!.content).toBe("Ready to proceed.");
    expect(merged[0]!.optionsPrompt).toMatchObject({ question: "Proceed with this action?", options: ["Proceed", "Cancel"], dismissed: false });
    expect(merged[0]!.actionConfirm).toBeUndefined();
  });

  it("dismisses a persisted choice once a subsequent user turn exists", () => {
    const unanswered = { ...serverMsg, content: '⚡OPTIONS:{"question":"Proceed?","options":["Proceed","Cancel"]}⚡' };
    const local = mergeServerMessagesWithTransientLocal([unanswered], []);
    const merged = mergeServerMessagesWithTransientLocal([
      unanswered,
      { ...serverMsg, id: "user-next", role: "user", content: "Cancel" },
    ], local);
    expect(merged[0]!.optionsPrompt?.dismissed).toBe(true);
  });

  it("maps persisted enriched toolCalls into done ToolCallEntry", () => {
    const merged = mergeServerMessagesWithTransientLocal([serverMsg], []);
    expect(merged[0]!.toolCalls).toHaveLength(1);
    expect(merged[0]!.toolCalls![0]).toMatchObject({
      name: "create_task",
      status: "done",
      success: true,
      summary: "Created task X",
    });
  });
});

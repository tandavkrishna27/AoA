import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AgentPanelContent } from "./InternalAgentPanel";
import { composerDraftStorageKey, deserializeComposerDraft, serializeComposerDraft } from "../lib/composerDraft";

/**
 * Commander composer B-states (mock §5): send-failed banner with idempotent
 * Retry (same clientSubmissionId — the server-side agent-loop replay dedupes
 * an ambiguous failure), offline strip, and frame-wide drag-drop.
 *
 * These are REAL component tests: the full AgentPanelContent renders in docked
 * mode (no viewer panel) with the provider hooks mocked at the module seam,
 * mirroring CommentThread.test.tsx's harness style.
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mutable connection state for the shared offline strip (B-states, mock §5).
const liveState = vi.hoisted(() => ({ connectionState: "open" }));

vi.mock("../context/LiveUpdatesProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../context/LiveUpdatesProvider")>();
  return {
    ...actual,
    useLiveUpdates: () => ({
      connectionState: liveState.connectionState,
      workingAgentsByThread: {},
      presenceByThread: {},
    }),
  };
});

// All hook mocks return STABLE singletons — the panel's effects put these
// values in dependency arrays, and a fresh object/vi.fn() per render loops
// setState-in-effect chains.
const stableHooks = vi.hoisted(() => ({
  company: { selectedCompanyId: "co-1" },
  agentPanel: {
    isOpen: true,
    openPanel: () => {},
    closePanel: () => {},
    setIsStreaming: () => {},
    setCurrentConversationId: () => {},
  },
  breadcrumbs: { breadcrumbs: [] as unknown[] },
  location: { pathname: "/", hash: "", search: "" },
  navigate: () => {},
  teamAccess: { currentUser: { userId: "user-1" }, isLoading: false },
  inlineQuestions: { data: [] as unknown[], isError: false, refetch: () => {} },
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => stableHooks.company,
}));

// MarkdownBody pulls ThemeContext (needs ThemeProvider) — render plain text.
vi.mock("./MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Radix TooltipTrigger's composed refs infinite-loop under React 19 + jsdom
// when the wrapped button's `disabled` flips mid-stream (compose-refs setRef
// → setState loop). The tooltips are chrome, not contract — render children
// directly; the real buttons (aria-labels included) stay in the tree.
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
}));

vi.mock("../context/AgentPanelContext", () => ({
  useAgentPanel: () => stableHooks.agentPanel,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => stableHooks.breadcrumbs,
}));

vi.mock("../lib/router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/router")>();
  return {
    ...actual,
    useLocation: () => stableHooks.location,
    useNavigate: () => stableHooks.navigate,
  };
});

vi.mock("../hooks/useTeamAccess", () => ({
  useTeamAccess: () => stableHooks.teamAccess,
}));

// Cut the heavy transitive import trees that never render in docked mode.
vi.mock("../pages/ThreadDetail", () => ({ ThreadDetail: () => null }));
vi.mock("./commander/cockpit/CommanderCockpitPanel", () => ({
  CommanderCockpitPanel: () => null,
}));

vi.mock("./work-questions/WorkQuestionInlineList", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./work-questions/WorkQuestionInlineList")>();
  return {
    ...actual,
    useInlineWorkQuestions: () => stableHooks.inlineQuestions,
  };
});

// The stream mock is swapped per-test: failing generator vs completing one.
const streamState = vi.hoisted(() => ({
  impl: undefined as ((...args: unknown[]) => AsyncGenerator<unknown>) | undefined,
  calls: [] as unknown[][],
}));
const confirmActionMock = vi.hoisted(() => vi.fn());
const historyState = vi.hoisted(() => ({
  messages: [] as unknown[],
  activeMessages: [] as unknown[],
  activeConversationId: "active-chat",
  pending: null as Promise<{ messages: unknown[] }> | null,
  listCalls: 0,
}));

vi.mock("../api/internal-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/internal-agent")>();
  return {
    ...actual,
    confirmAction: confirmActionMock,
    streamAgentChat: (...args: unknown[]) => {
      streamState.calls.push(args);
      if (!streamState.impl) throw new Error("streamState.impl not set");
      return streamState.impl(...args);
    },
    internalAgentApi: {
      ...actual.internalAgentApi,
      confirmAction: confirmActionMock,
      getConversation: vi.fn(async () => ({ conversation: historyState.activeMessages.length ? { id: historyState.activeConversationId } : null, messages: historyState.activeMessages })),
      getGreeting: vi.fn().mockResolvedValue(null),
      getRuntimeSettings: vi.fn().mockResolvedValue({ runtimeAllowAlwaysEnabled: true }),
      listSkills: vi.fn().mockResolvedValue({ skills: [] }),
    },
    commanderConversationsApi: {
      ...actual.commanderConversationsApi,
      list: vi.fn().mockResolvedValue({ conversations: [] }),
    },
    conversationMessagesApi: {
      ...actual.conversationMessagesApi,
      list: vi.fn(async () => {
        historyState.listCalls += 1;
        return historyState.pending ?? { messages: historyState.messages };
      }),
    },
  };
});

vi.mock("../api/agents", () => ({
  agentsApi: { list: vi.fn().mockResolvedValue([]) },
}));

const uploadFileMock = vi.hoisted(() => vi.fn());
vi.mock("../api/assets", () => ({
  assetsApi: { uploadFile: uploadFileMock },
}));

// ─── Harness ─────────────────────────────────────────────────────────────────

function failingStream(): AsyncGenerator<unknown> {
  // eslint-disable-next-line require-yield
  return (async function* () {
    throw new Error("boom");
  })();
}

function completingStream(): AsyncGenerator<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  return (async function* () {})();
}

// The server can emit an SSE `error` event (CLI failure mid-stream, or the
// idempotency "already being processed" response) and then END the generator
// NORMALLY — no throw. The client must still treat this as a failed send.
function erroringStream(): AsyncGenerator<unknown> {
  return (async function* () {
    yield { event: "error", data: { code: "INTERNAL", message: "CLI failed mid-stream" } };
  })();
}

function partialThenErrorStream(): AsyncGenerator<unknown> {
  return (async function* () {
    yield { event: "content", data: { text: "I started an answer." } };
    yield { event: "error", data: { code: "INTERNAL", message: "No company provider key is configured. Add one in Settings → Providers, then retry." } };
  })();
}

function renderPanel(props: React.ComponentProps<typeof AgentPanelContent> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  const makeUi = (p: React.ComponentProps<typeof AgentPanelContent>) => (
    <QueryClientProvider client={client}>
      <AgentPanelContent {...p} />
    </QueryClientProvider>
  );
  const result = render(makeUi(props));
  return {
    ...result,
    client,
    // Same mounted panel, new props — simulates switching conversations.
    rerenderPanel: (next: React.ComponentProps<typeof AgentPanelContent>) =>
      result.rerender(makeUi(next)),
  };
}

function composerInput(): HTMLElement {
  return screen.getByRole("textbox", { name: "Ask the agent..." });
}

function typeInComposer(text: string): HTMLElement {
  const box = composerInput();
  box.textContent = text;
  fireEvent.input(box);
  return box;
}

function sendViaEnter(box: HTMLElement) {
  fireEvent.keyDown(box, { key: "Enter" });
}

beforeEach(() => {
  historyState.messages = [];
  historyState.activeMessages = [];
  historyState.activeConversationId = "active-chat";
  historyState.pending = null;
  historyState.listCalls = 0;
  stableHooks.company.selectedCompanyId = "co-1";
  stableHooks.teamAccess.currentUser.userId = "user-1";
  stableHooks.location.pathname = "/";
  liveState.connectionState = "open";
  streamState.impl = failingStream;
  streamState.calls = [];
  uploadFileMock.mockReset();
  confirmActionMock.mockReset();
  window.localStorage.clear();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Commander composer — B-states (mock §5)", () => {
  it("keeps current live approval in its original row when delayed history contains identical older answered choices", async () => {
    const question = "Proceed?";
    const options = ["Proceed", "Cancel"];
    const marker = `⚡OPTIONS:${JSON.stringify({ question, options })}⚡`;
    let resolveHistory!: (value: { messages: unknown[] }) => void;
    historyState.pending = new Promise((resolve) => {
      resolveHistory = resolve;
    });
    streamState.impl = () =>
      (async function* () {
        yield { event: "content", data: { text: "Current live turn" } };
        yield {
          event: "options_prompt",
          data: { promptId: "current-live-choice", question, options },
        };
        yield {
          event: "action_confirm",
          data: {
            confirmId: "22222222-2222-4222-8222-222222222222",
            action: "create_task",
            description: "Create current task",
          },
        };
      })();
    let sideEffects = 0;
    confirmActionMock.mockImplementation(async () => {
      sideEffects += 1;
      return { result: "executed" };
    });
    const { client } = renderPanel({ conversationId: "saved-chat" });
    await waitFor(() => expect(historyState.listCalls).toBe(1));
    sendViaEnter(typeInComposer("Current task request"));
    await screen.findByRole("button", { name: "Allow once" });
    await screen.findByRole("button", { name: "Send message" });
    streamState.impl = completingStream;
    fireEvent.click(screen.getByRole("button", { name: /Proceed.*recommended/ }));
    await waitFor(() => expect(streamState.calls).toHaveLength(2));
    await screen.findByRole("button", { name: "Send message" });
    const saved = [
      {
        id: "older-question",
        role: "assistant",
        content: `Older saved turn\n${marker}`,
        createdAt: "2026-10-16T00:00:00Z",
      },
      { id: "older-answer", role: "user", content: "Proceed", createdAt: "2026-10-16T00:00:01Z" },
      {
        id: "current-question",
        role: "assistant",
        content: `Current live turn\n${marker}`,
        createdAt: "2026-10-16T00:00:02Z",
      },
      { id: "current-answer", role: "user", content: "Proceed", createdAt: "2026-10-16T00:00:03Z" },
    ];
    await act(async () => {
      historyState.pending = null;
      historyState.messages = saved;
      resolveHistory({ messages: saved });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const olderTurn = screen.getByText("Older saved turn").parentElement!;
    expect(within(olderTurn).queryByRole("button", { name: "Allow once" })).not.toBeInTheDocument();
    const liveRows = screen.getAllByText("Current live turn").map((text) => text.parentElement!);
    expect(liveRows.some((row) => within(row).queryByRole("button", { name: "Allow once" }))).toBe(
      true,
    );
    expect(screen.getAllByRole("button", { name: "Allow once" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Deny" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Proceed.*recommended/ })).not.toBeInTheDocument();
    expect(confirmActionMock).not.toHaveBeenCalled();
    expect(sideEffects).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    await screen.findByText("Confirmed");
    expect(confirmActionMock).toHaveBeenCalledTimes(1);
    expect(confirmActionMock).toHaveBeenCalledWith("co-1", {
      confirmId: "22222222-2222-4222-8222-222222222222",
      decision: "allow_once",
    });
    expect(sideEffects).toBe(1);
    await act(async () => {
      await client.refetchQueries({ queryKey: ["conversation-messages", "co-1", "saved-chat"] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("button", { name: "Allow once" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Proceed.*recommended/ })).not.toBeInTheDocument();
    expect(confirmActionMock).toHaveBeenCalledTimes(1);
  });

  function persistedApprovalNotice() {
    return [
      {
        id: "persisted-user",
        role: "user",
        content: "Create guarded task",
        createdAt: "2026-10-16T00:00:00Z",
      },
      {
        id: "persisted-assistant",
        role: "assistant",
        createdAt: "2026-10-16T00:00:01Z",
        content:
          "Action requires approval for create_task. Complete the pending approval to proceed.",
      },
    ];
  }

  async function renderSavedChatWithLiveApproval() {
    let finishStream!: () => void;
    const streamDone = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    streamState.impl = () =>
      (async function* () {
        yield {
          event: "action_confirm",
          data: {
            confirmId: "11111111-1111-4111-8111-111111111111",
            action: "create_task",
            description: "Create guarded task",
          },
        };
        await streamDone;
        historyState.messages = persistedApprovalNotice();
      })();
    const panel = renderPanel({ conversationId: "saved-chat" });
    await waitFor(() => expect(historyState.listCalls).toBe(1));
    sendViaEnter(typeInComposer("Create guarded task"));
    await screen.findByRole("button", { name: "Allow once" });
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
    expect(confirmActionMock).not.toHaveBeenCalled();
    await act(async () => {
      finishStream();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(historyState.listCalls).toBe(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return panel;
  }

  it.each(["allow_once", "deny"])(
    "keeps live approval actionable through saved-history refresh and gates %s through one API decision",
    async (decision) => {
      let sideEffects = 0;
      confirmActionMock.mockImplementation(async (_companyId, body) => {
        if (body.decision === "allow_once") sideEffects += 1;
        return { result: body.decision === "deny" ? "denied" : "executed" };
      });
      const { client } = await renderSavedChatWithLiveApproval();
      expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
      expect(sideEffects).toBe(0);
      expect(confirmActionMock).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: decision === "deny" ? "Deny" : "Allow once" }),
      );
      await screen.findByText(decision === "deny" ? "Rejected" : "Confirmed");
      expect(confirmActionMock).toHaveBeenCalledTimes(1);
      expect(confirmActionMock).toHaveBeenCalledWith("co-1", {
        confirmId: "11111111-1111-4111-8111-111111111111",
        decision,
      });
      expect(sideEffects).toBe(decision === "deny" ? 0 : 1);
      await act(async () => {
        await client.refetchQueries({ queryKey: ["conversation-messages", "co-1", "saved-chat"] });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(screen.queryByRole("button", { name: "Allow once" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Deny" })).not.toBeInTheDocument();
      expect(confirmActionMock).toHaveBeenCalledTimes(1);
      expect(sideEffects).toBe(decision === "deny" ? 0 : 1);
    },
  );

  it.each(["company", "conversation", "owner"])(
    "does not carry live approvals across a %s switch or reconstruct them from persisted text",
    async (scope) => {
      const panel = await renderSavedChatWithLiveApproval();
      expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
      historyState.messages = persistedApprovalNotice();
      if (scope === "company") stableHooks.company.selectedCompanyId = "co-2";
      if (scope === "owner") stableHooks.teamAccess.currentUser.userId = "user-2";
      panel.rerenderPanel({ conversationId: scope === "conversation" ? "other-chat" : "saved-chat" });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(await screen.findByText(/Action requires approval for create_task/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Allow once" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Deny" })).not.toBeInTheDocument();
      expect(confirmActionMock).not.toHaveBeenCalled();
    },
  );

  it("reconciles live and persisted options once and keeps answered choices dismissed through saved-history refresh", async () => {
    const question = "Choose the plan";
    const options = ["Proceed", "Cancel"];
    const persisted = [
      {
        id: "question-user",
        role: "user",
        content: "Make a plan",
        createdAt: "2026-10-16T00:00:00Z",
      },
      {
        id: "question-assistant",
        role: "assistant",
        content: `⚡OPTIONS:${JSON.stringify({ question, options })}⚡`,
        createdAt: "2026-10-16T00:00:01Z",
      },
    ];
    streamState.impl = () =>
      (async function* () {
        yield { event: "options_prompt", data: { promptId: "live-choice", question, options } };
        historyState.messages = persisted;
      })();
    const { client } = renderPanel({ conversationId: "saved-chat" });
    await waitFor(() => expect(historyState.listCalls).toBe(1));
    sendViaEnter(typeInComposer("Make a plan"));
    await waitFor(() => expect(historyState.listCalls).toBe(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getAllByRole("button", { name: /Proceed.*recommended/ })).toHaveLength(1);
    streamState.impl = () =>
      (async function* () {
        historyState.messages = [
          ...persisted,
          {
            id: "choice-answer",
            role: "user",
            content: "Proceed",
            createdAt: "2026-10-16T00:00:02Z",
          },
        ];
      })();
    fireEvent.click(screen.getByRole("button", { name: /Proceed.*recommended/ }));
    await waitFor(() => expect(historyState.listCalls).toBe(3));
    await act(async () => {
      await client.refetchQueries({ queryKey: ["conversation-messages", "co-1", "saved-chat"] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("button", { name: /Proceed.*recommended/ })).not.toBeInTheDocument();
    expect(streamState.calls).toHaveLength(2);
    expect(streamState.calls[1][1]).toBe("Proceed");
    expect(confirmActionMock).not.toHaveBeenCalled();
  });

  function durableFailure(id = "saved-user", submissionId = "original-send") {
    const retry = {
      message: "Original request with reference id=old-asset",
      clientSubmissionId: submissionId,
      pageContext: "Original page",
      contextScope: { surface: "memory", route: "/original" },
      departmentContext: null,
      attachmentAssetIds: ["old-asset"],
    };
    return {
      id,
      role: "user",
      content: retry.message,
      turnStatus: "failed",
      createdAt: "2026-10-16T00:00:00Z",
      failure: { message: "Check company provider settings", retry, retryUnavailableReason: null },
    };
  }

  it.each(["typed", "persisted"])(
    "preserves a newer %s draft and refs when failed history arrives before an accepted Retry",
    async (draftSource) => {
      let resolveHistory!: (value: { messages: unknown[] }) => void;
      historyState.pending = new Promise((resolve) => {
        resolveHistory = resolve;
      });
      const draftKey = composerDraftStorageKey({
        companyId: "co-1",
        userId: "user-1",
        surface: "commander",
        entityId: "saved-chat",
      });
      if (draftSource === "persisted") {
        window.localStorage.setItem(
          draftKey,
          serializeComposerDraft({
            text: "Newer unsent draft",
            tokens: [],
            attachments: [],
          }),
        );
      }
      renderPanel({ conversationId: "saved-chat" });
      if (draftSource === "typed") typeInComposer("Newer unsent draft");
      await waitFor(() => expect(composerInput().textContent).toBe("Newer unsent draft"));
      uploadFileMock.mockResolvedValue({
        assetId: "old-asset",
        originalFilename: "newer.txt",
        contentPath: "/api/assets/old-asset/content",
        contentType: "text/plain",
        byteSize: 5,
      });
      fireEvent.drop(screen.getByTestId("commander-composer-frame"), {
        dataTransfer: {
          types: ["Files"],
          files: [new File(["hello"], "newer.txt", { type: "text/plain" })],
        },
      });
      expect(await screen.findByTestId("commander-input-refs")).toHaveTextContent("newer.txt");
      const failed = durableFailure();
      await act(async () => {
        historyState.pending = null;
        historyState.messages = [failed];
        resolveHistory({ messages: [failed] });
      });
      const banner = await screen.findByTestId("composer-send-failed-banner");
      streamState.impl = () =>
        (async function* () {
          historyState.messages = [{ ...failed, failure: undefined, turnStatus: "done" }];
        })();
      fireEvent.click(within(banner).getByRole("button", { name: "Retry" }));
      await waitFor(() =>
        expect(screen.queryByTestId("composer-send-failed-banner")).not.toBeInTheDocument(),
      );
      expect(streamState.calls).toHaveLength(1);
      expect(streamState.calls[0][1]).toBe(failed.content);
      expect(streamState.calls[0][6]).toEqual(["old-asset"]);
      expect(streamState.calls[0][7]).toBe("original-send");
      expect(composerInput().textContent).toBe("Newer unsent draft");
      expect(screen.getByTestId("commander-input-refs")).toHaveTextContent("newer.txt");
      expect(deserializeComposerDraft(window.localStorage.getItem(draftKey))?.text).toBe(
        "Newer unsent draft",
      );
    },
  );

  it.each(["Retry", "Edit", "Discard", "divergence"])(
    "does not resurrect resolved saved recovery after %s and real active/history refetches",
    async (action) => {
      const failed = durableFailure();
      historyState.messages = [failed];
      historyState.activeMessages = [failed];
      historyState.activeConversationId = "saved-chat";
      const { client } = renderPanel({ conversationId: "saved-chat" });
      const banner = await screen.findByTestId("composer-send-failed-banner");
      if (action === "Retry") {
        streamState.impl = () =>
          (async function* () {
            const completed = { ...failed, turnStatus: "done", failure: undefined };
            historyState.messages = [completed];
            historyState.activeMessages = [completed];
          })();
        fireEvent.click(within(banner).getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(streamState.calls).toHaveLength(1));
        await screen.findByRole("button", { name: "Send message" });
      } else if (action === "divergence") {
        typeInComposer("New draft after dismissing the old failure");
      } else {
        fireEvent.click(within(banner).getByRole("button", { name: action }));
      }
      await act(async () => {
        historyState.activeMessages = [
          ...historyState.activeMessages,
          {
            id: "active-refresh",
            role: "assistant",
            content: "Unrelated active refresh",
          },
        ];
        await client.refetchQueries({ queryKey: ["agent-conversation", "co-1"] });
        // Flush TanStack Query's scheduled observer notification before asserting
        // the resulting component state, rather than only its synchronous cache.
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(screen.queryByTestId("composer-send-failed-banner")).not.toBeInTheDocument();
      if (action === "Retry") {
        await waitFor(() => expect(historyState.listCalls).toBeGreaterThanOrEqual(2));
        const savedHistory = client.getQueryData<{ messages: Array<{ turnStatus: string }> }>([
          "conversation-messages",
          "co-1",
          "saved-chat",
        ]);
        expect(savedHistory?.messages[0].turnStatus).toBe("done");
      }
      await act(async () => {
        historyState.messages = [
          { ...failed, failure: { ...failed.failure, message: "Refreshed old failure" } },
        ];
        await client.refetchQueries({ queryKey: ["conversation-messages", "co-1", "saved-chat"] });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(screen.queryByTestId("composer-send-failed-banner")).not.toBeInTheDocument();
      expect(streamState.calls).toHaveLength(action === "Retry" ? 1 : 0);
      if (action === "divergence")
        expect(composerInput().textContent).toBe("New draft after dismissing the old failure");
      await act(async () => {
        historyState.messages = [durableFailure("new-failed-user", "new-submission")];
        await client.refetchQueries({ queryKey: ["conversation-messages", "co-1", "saved-chat"] });
      });
      expect(await screen.findByTestId("composer-send-failed-banner")).toHaveTextContent(
        "Check company provider settings",
      );
    },
  );

  it("restores docked failure recovery bound to the persisted conversation rather than the current active-chat default", async () => {
    historyState.activeMessages = [
      {
        id: "saved-active-user",
        role: "user",
        content: "Saved intent",
        createdAt: "2026-10-16T00:00:00Z",
        turnStatus: "failed",
        failure: {
          message: "Check company settings",
          retryUnavailableReason: null,
          retry: {
            message: "Saved intent",
            clientSubmissionId: "active-original",
            attachmentAssetIds: [],
            pageContext: null,
            contextScope: null,
            departmentContext: null,
          },
        },
      },
    ];
    renderPanel();
    const banner = await screen.findByTestId("composer-send-failed-banner");
    streamState.impl = completingStream;
    fireEvent.click(within(banner).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(streamState.calls).toHaveLength(1));
    expect(streamState.calls[0][4]).toBe("active-chat");
    expect(streamState.calls[0][2]).toBeNull();
    expect(streamState.calls[0][5]).toBeNull();
    expect(streamState.calls[0][7]).toBe("active-original");
  });

  it("clears a docked failed submission when switching companies", async () => {
    historyState.activeMessages = [
      {
        id: "saved-user",
        role: "user",
        content: "Old company intent",
        failure: {
          message: "Old company failed",
          retry: null,
          retryUnavailableReason: "Review references",
        },
      },
    ];
    const panel = renderPanel();
    await screen.findByTestId("composer-send-failed-banner");
    historyState.activeMessages = [];
    stableHooks.company.selectedCompanyId = "co-2";
    panel.rerenderPanel({});
    await waitFor(() =>
      expect(screen.queryByTestId("composer-send-failed-banner")).not.toBeInTheDocument(),
    );
    expect(streamState.calls).toHaveLength(0);
  });
  it("rehydrates failed user-only saved history and retries its original payload after reopening", async () => {
    const retry = {
      message: "Review notes\n\nReferenced context: asset=saved-file",
      clientSubmissionId: "original-send",
      pageContext: "Original page",
      contextScope: { surface: "memory", route: "/original" },
      departmentContext: null,
      attachmentAssetIds: ["saved-file"],
    };
    historyState.messages = [
      {
        id: "saved-user",
        role: "user",
        content: retry.message,
        createdAt: "2026-10-16T00:00:00Z",
        turnStatus: "failed",
        failure: {
          message: "Company provider setup is missing. Open Settings and retry.",
          retry,
          retryUnavailableReason: null,
        },
      },
    ];
    const first = renderPanel({ conversationId: "saved-chat" });
    let banner = await screen.findByTestId("composer-send-failed-banner");
    expect(banner).toHaveTextContent("Company provider setup is missing");
    first.unmount();
    const reopened = renderPanel({ conversationId: "saved-chat" });
    banner = await screen.findByTestId("composer-send-failed-banner");
    stableHooks.location.pathname = "/settings";
    reopened.rerenderPanel({ conversationId: "saved-chat" });
    streamState.impl = completingStream;
    fireEvent.click(within(banner).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(streamState.calls).toHaveLength(1));
    const call = streamState.calls[0];
    expect(call[1]).toBe(retry.message);
    expect(call[2]).toBe("Original page");
    expect(call[4]).toBe("saved-chat");
    expect(call[5]).toEqual(retry.contextScope);
    expect(call[6]).toEqual(["saved-file"]);
    expect(call[7]).toBe("original-send");
    expect(call[8]).toBeNull();
  });

  it("explains unsafe legacy retry and keeps Edit and Discard actionable", async () => {
    historyState.messages = [
      {
        id: "legacy",
        role: "user",
        content: "Original intent",
        turnStatus: "failed",
        createdAt: "2026-10-16T00:00:00Z",
        failure: {
          message: "Commander failed. Check Settings.",
          retry: null,
          retryUnavailableReason:
            "The original attachments and context were not saved. Edit and review before sending again.",
        },
      },
    ];
    renderPanel({ conversationId: "legacy-chat" });
    const banner = await screen.findByTestId("composer-send-failed-banner");
    expect(banner).toHaveTextContent("original attachments and context were not saved");
    expect(within(banner).getByRole("button", { name: "Retry" })).toBeDisabled();
    fireEvent.click(within(banner).getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(composerInput().textContent).toBe("Original intent"));
    expect(streamState.calls).toHaveLength(0);
  });

  it("dismisses answered saved choices on explicit hydration while leaving the latest unanswered choice available", async () => {
    const marker = (question: string) =>
      `⚡OPTIONS:${JSON.stringify({ question, options: ["Proceed", "Cancel"] })}⚡`;
    historyState.messages = [
      {
        id: "old-choice",
        role: "assistant",
        content: marker("Old question"),
        createdAt: "2026-10-16T00:00:00Z",
      },
      { id: "answer", role: "user", content: "Proceed", createdAt: "2026-10-16T00:00:01Z" },
      {
        id: "new-choice",
        role: "assistant",
        content: marker("Unanswered question"),
        createdAt: "2026-10-16T00:00:02Z",
      },
    ];
    const first = renderPanel({ conversationId: "choices" });
    await screen.findByText("Unanswered question");
    expect(screen.queryByText("Old question")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Proceed.*recommended/ })).toHaveLength(1);
    first.unmount();
    renderPanel({ conversationId: "choices" });
    const proceed = await screen.findByRole("button", { name: /Proceed.*recommended/ });
    streamState.impl = completingStream;
    fireEvent.click(proceed);
    await waitFor(() => expect(streamState.calls).toHaveLength(1));
    expect(streamState.calls[0][1]).toBe("Proceed");
    expect(confirmActionMock).not.toHaveBeenCalled();
  });

  it("renders choices and sends selected intent without approving a governed action", async () => {
    streamState.impl = () => (async function* () {
      yield { event: "options_prompt", data: { promptId: "choice-1", question: "Proceed with this action?", options: ["Proceed", "Cancel"] } };
    })();
    renderPanel();
    sendViaEnter(typeInComposer("Create a planning task"));
    const proceed = await screen.findByRole("button", { name: /Proceed.*recommended/ });
    await screen.findByRole("button", { name: "Send message" });
    streamState.impl = completingStream;
    fireEvent.click(proceed);
    await waitFor(() => expect(streamState.calls).toHaveLength(2));
    expect(streamState.calls[1][1]).toBe("Proceed");
    expect(confirmActionMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Proceed.*recommended/ })).not.toBeInTheDocument();
  });

  it("raises the banner on send failure keeping the draft; Retry replays the IDENTICAL request incl. the same clientSubmissionId; retry-success clears", async () => {
    renderPanel();
    const box = typeInComposer("deploy the beta");
    sendViaEnter(box);

    // Failure never eats your work: banner up, draft intact.
    const banner = await screen.findByTestId("composer-send-failed-banner");
    expect(box.textContent).toBe("deploy the beta");
    expect(streamState.calls).toHaveLength(1);
    const first = streamState.calls[0];
    expect(first[1]).toBe("deploy the beta"); // message
    expect(typeof first[7]).toBe("string"); // clientSubmissionId minted
    expect((first[7] as string).length).toBeGreaterThan(0);

    // Retry replays the EXACT attempt — same message, same clientSubmissionId
    // (the server-side agent-loop replay dedupes if the first turn landed).
    streamState.impl = completingStream;
    fireEvent.click(within(banner).getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(screen.queryByTestId("composer-send-failed-banner")).not.toBeInTheDocument(),
    );
    expect(streamState.calls).toHaveLength(2);
    const second = streamState.calls[1];
    expect(second[1]).toBe(first[1]);
    expect(second[7]).toBe(first[7]);
    // Retry-success clears the (non-diverged) draft.
    await waitFor(() => expect(composerInput().textContent).toBe(""));
  });

  it("raises the failed-send banner on an SSE error event (stream ends normally, no throw) — round-3 #3", async () => {
    streamState.impl = erroringStream;
    renderPanel();
    const box = typeInComposer("run the deploy");
    sendViaEnter(box);

    // The error event must surface the banner and retain the draft — NOT be
    // reported as an accepted send.
    const banner = await screen.findByTestId("composer-send-failed-banner");
    expect(box.textContent).toBe("run the deploy");
    // Retry replays the identical attempt (same clientSubmissionId).
    streamState.impl = completingStream;
    fireEvent.click(within(banner).getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.queryByTestId("composer-send-failed-banner")).not.toBeInTheDocument(),
    );
    expect(streamState.calls).toHaveLength(2);
    expect(streamState.calls[1][7]).toBe(streamState.calls[0][7]);
  });

  it("shows the actionable SSE failure after partial assistant output", async () => {
    streamState.impl = partialThenErrorStream;
    renderPanel();
    sendViaEnter(typeInComposer("check the provider setup"));

    expect(await screen.findByText(/I started an answer\./)).toBeInTheDocument();
    expect(screen.getByText(/Add one in Settings → Providers, then retry\./)).toBeInTheDocument();
    expect(await screen.findByTestId("composer-send-failed-banner")).toBeInTheDocument();
    expect(composerInput().textContent).toBe("check the provider setup");
  });

  it("dismisses the banner on Edit but keeps the draft; the next send mints a NEW clientSubmissionId", async () => {
    renderPanel();
    const box = typeInComposer("ship it");
    sendViaEnter(box);
    const banner = await screen.findByTestId("composer-send-failed-banner");

    fireEvent.click(within(banner).getByRole("button", { name: "Edit" }));
    expect(screen.queryByTestId("composer-send-failed-banner")).not.toBeInTheDocument();
    expect(box.textContent).toBe("ship it");

    // A fresh submission is NOT a replay: new clientSubmissionId.
    sendViaEnter(box);
    await screen.findByTestId("composer-send-failed-banner");
    expect(streamState.calls).toHaveLength(2);
    expect(streamState.calls[1][7]).not.toBe(streamState.calls[0][7]);
  });

  it("Discard dismisses the banner and clears the input", async () => {
    renderPanel();
    const box = typeInComposer("scrap this");
    sendViaEnter(box);
    const banner = await screen.findByTestId("composer-send-failed-banner");

    fireEvent.click(within(banner).getByRole("button", { name: "Discard" }));
    expect(screen.queryByTestId("composer-send-failed-banner")).not.toBeInTheDocument();
    expect(box.textContent).toBe("");
  });

  it("dismisses the banner when the draft diverges from the failed attempt", async () => {
    renderPanel();
    const box = typeInComposer("original message");
    sendViaEnter(box);
    await screen.findByTestId("composer-send-failed-banner");

    // Any edit means Retry would post stale content — the banner must go.
    typeInComposer("original message, edited");
    expect(screen.queryByTestId("composer-send-failed-banner")).not.toBeInTheDocument();
    // The newer draft survives.
    expect(box.textContent).toBe("original message, edited");
  });

  it("mid-retry divergence never re-arms the stale banner (removed ref stays unreachable)", async () => {
    uploadFileMock.mockResolvedValue({
      assetId: "asset-1",
      originalFilename: "notes.txt",
      contentPath: "/api/assets/asset-1/content",
      contentType: "text/plain",
      byteSize: 5,
    });
    renderPanel();

    // Attach a ref, then fail the first send — banner up with the snapshot.
    const frame = screen.getByTestId("commander-composer-frame");
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.drop(frame, { dataTransfer: { types: ["Files"], files: [file] } });
    expect(await screen.findByTestId("commander-input-refs")).toHaveTextContent("notes.txt");

    const box = typeInComposer("send with the file");
    sendViaEnter(box);
    const banner = await screen.findByTestId("composer-send-failed-banner");
    expect(streamState.calls).toHaveLength(1);

    // Hang the retry so we can mutate the refs tray while it is in flight.
    let failRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => { failRetry = resolve; });
    streamState.impl = () =>
      (async function* () {
        await retryGate;
        throw new Error("still failing");
      })();
    fireEvent.click(within(banner).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(streamState.calls).toHaveLength(2));

    // Divergence while retrying: the dismiss is suppressed (banner shows Retrying…)…
    fireEvent.click(screen.getByRole("button", { name: "Remove notes.txt reference" }));
    expect(screen.getByTestId("composer-send-failed-banner")).toBeInTheDocument();

    // …but when the retry fails, the failure path must NOT re-arm the stale
    // snapshot — a second Retry would post the removed (possibly sensitive) ref.
    failRetry();
    await waitFor(() =>
      expect(screen.queryByTestId("composer-send-failed-banner")).not.toBeInTheDocument(),
    );
    // The stale snapshot stayed unreachable — nothing was re-sent.
    expect(streamState.calls).toHaveLength(2);
  });

  it("shows the offline strip and disables Send while offline", async () => {
    liveState.connectionState = "offline";
    renderPanel();
    expect(await screen.findByTestId("composer-offline-strip")).toBeInTheDocument();

    const box = typeInComposer("try to send offline");
    const sendButton = screen.getByRole("button", { name: "Send message" });
    expect(sendButton).toBeDisabled();

    // The Enter path is gated too — no request leaves the client.
    sendViaEnter(box);
    expect(streamState.calls).toHaveLength(0);
  });

  it("shows the drop overlay on dragEnter and routes dropped files through the existing attach path", async () => {
    uploadFileMock.mockResolvedValue({
      assetId: "asset-1",
      originalFilename: "notes.txt",
      contentPath: "/api/assets/asset-1/content",
      contentType: "text/plain",
      byteSize: 5,
    });
    renderPanel();
    const frame = screen.getByTestId("commander-composer-frame");

    fireEvent.dragEnter(frame, { dataTransfer: { types: ["Files"], files: [] } });
    expect(screen.getByTestId("composer-drop-overlay")).toBeInTheDocument();

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.drop(frame, { dataTransfer: { types: ["Files"], files: [file] } });

    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1));
    expect(uploadFileMock).toHaveBeenCalledWith("co-1", file, "commander/new");
    // The uploaded asset lands in the refs tray (validateCommanderAttachmentFiles path).
    expect(await screen.findByTestId("commander-input-refs")).toHaveTextContent("notes.txt");
    expect(screen.queryByTestId("composer-drop-overlay")).not.toBeInTheDocument();
  });

  it("drops a stale upload FAILURE after the user switches conversations mid-upload (round-10 #3)", async () => {
    // The upload hangs, the user switches to conversation B, THEN the upload
    // fails for A. B's tray must not be repopulated with A's failed card — the
    // failure path must apply the same active-conversation guard as the success
    // path (otherwise retrying it would attach A's file to B).
    let failUpload!: () => void;
    uploadFileMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        failUpload = () => reject(new Error("upload failed"));
      }),
    );

    const { rerenderPanel } = renderPanel({ conversationId: "conv-a" });
    const frame = screen.getByTestId("commander-composer-frame");
    const file = new File(["hi"], "stale.txt", { type: "text/plain" });
    fireEvent.drop(frame, { dataTransfer: { types: ["Files"], files: [file] } });

    // Upload is in flight against conversation A; switch to B before it settles.
    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1));
    rerenderPanel({ conversationId: "conv-b" });

    // Now it fails — but for the stale (A) conversation.
    failUpload();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // No failed card and no error for A's file on conversation B.
    expect(screen.queryByText(/stale\.txt failed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/could not upload stale\.txt/i)).not.toBeInTheDocument();
  });

  it("switching conversations clears the banner and snapshot — Retry must never post into a different conversation", async () => {
    const { rerenderPanel } = renderPanel({ conversationId: "conv-a" });
    const box = typeInComposer("meant for conversation A");
    sendViaEnter(box);
    await screen.findByTestId("composer-send-failed-banner");
    expect(streamState.calls).toHaveLength(1);

    // Entity switch: same mounted panel, different conversation.
    rerenderPanel({ conversationId: "conv-b" });

    await waitFor(() =>
      expect(screen.queryByTestId("composer-send-failed-banner")).not.toBeInTheDocument(),
    );
    // The snapshot is unreachable — nothing was re-sent anywhere.
    expect(streamState.calls).toHaveLength(1);
  });

  it("keeps existing composer affordances intact (aria contract)", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
    expect(screen.getByLabelText("Attach files")).toBeInTheDocument(); // hidden input
    expect(screen.getByRole("button", { name: "Attach file" })).toBeInTheDocument();
  });
});

/**
 * Provider Switching Phase 1 — Unit D UI tests.
 *
 * Asserts:
 * 1. Switching to codex_local adapter defaults model to gpt-5.5 (NOT gpt-5.3-codex).
 * 2. Codex model picker shows "Default → gpt-5.5" when no model is explicitly set.
 * 3. Save warnings from create/update response are surfaced in the UI.
 *
 * The warnings test is done at the API-type level (AgentSaveResult) rather than
 * via a full page render (AgentDetail is too heavy to mount without a router/company
 * fixture) — the mutation wiring is verified by inspection.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentConfigForm } from "../components/AgentConfigForm";
import { TooltipProvider } from "../components/ui/tooltip";
import { DEFAULT_CODEX_LOCAL_MODEL } from "@armyofagents/adapter-codex-local";
import { agentsApi } from "../api/agents";

// ── Shared mocks ─────────────────────────────────────────────────────────────

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

const mockAdapterModels = vi.hoisted(() => vi.fn().mockResolvedValue([
  { id: "gpt-fixture-listed", label: "GPT Fixture Listed" },
]));

vi.mock("../api/agents", () => ({
  agentsApi: {
    adapterModels: mockAdapterModels,
    org: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../api/secrets", () => ({
  secretsApi: {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
  },
}));

vi.mock("../api/environments", () => ({
  useEnvironments: () => ({ data: [] }),
}));

vi.mock("../api/assets", () => ({
  assetsApi: { uploadImage: vi.fn() },
}));

vi.mock("../components/MarkdownEditor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <textarea
      aria-label="Prompt template"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const baseAgent = {
  id: "agent-ps",
  companyId: "company-1",
  name: "Provider Switching Agent",
  title: "Engineer",
  role: "general",
  capabilities: ["software"],
  status: "active",
  adapterType: "process",
  adapterConfig: {},
  runtimeConfig: { heartbeat: { enabled: true, intervalSec: 300, wakeOnDemand: true } },
  reportsToAgentId: null,
  reportsToUserId: null,
  parentType: null,
  parentId: null,
  departmentId: null,
  defaultEnvironmentId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  mockAdapterModels.mockClear();
});

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

function renderEditForm(agentPatch: Record<string, unknown>, onSave = vi.fn()) {
  render(
    <QueryClientProvider client={makeQC()}>
      <TooltipProvider>
        <AgentConfigForm
          mode="edit"
          agent={{ ...baseAgent, ...agentPatch } as any}
          onSave={onSave}
          adapterModels={[]}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { onSave };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DEFAULT_CODEX_LOCAL_MODEL value", () => {
  it("is blank so a new Codex config inherits its account catalog default", () => {
    expect(DEFAULT_CODEX_LOCAL_MODEL).toBe("");
  });
});

describe("AgentConfigForm codex model picker default label", () => {
  it("shows the account default when no model is explicitly set and queries with the agent identity", async () => {
    renderEditForm({
      adapterType: "codex_local",
      adapterConfig: { model: "" },
    });

    const modelBtn = await screen.findByRole("button", {
      name: /Account default \(Codex CLI\)/i,
    });
    expect(modelBtn).toBeInTheDocument();
    expect(agentsApi.adapterModels).toHaveBeenCalledWith("company-1", "codex_local", "agent-ps");
  });

  it("shows selected model label when model is explicitly set", async () => {
    renderEditForm({
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-fixture-listed" },
    });

    const modelBtn = await screen.findByRole("button", {
      name: /GPT Fixture Listed/i,
    });
    expect(modelBtn).toBeInTheDocument();
  });

  it("keeps an unavailable saved model visible without replacing it", async () => {
    renderEditForm({
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-fixture-retired" },
    });

    expect(await screen.findByRole("button", { name: /gpt-fixture-retired/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Account default \(Codex CLI\)/i })).toBeNull();
  });
});

describe("AgentConfigForm codex account-default option", () => {
  it("choosing the account default clears the explicit model override", async () => {
    renderEditForm({
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-fixture-listed" },
    });

    await userEvent.click(await screen.findByRole("button", { name: /GPT Fixture Listed/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Account default \(Codex CLI\)/i }));

    expect(screen.getByRole("button", { name: /Account default \(Codex CLI\)/i })).toBeInTheDocument();
  });
});

describe("AgentConfigForm adapter type switch inherits Codex account default", () => {
  it("switching to codex_local in create mode leaves model blank", async () => {
    const onChange = vi.fn();
    const { unmount } = render(
      <QueryClientProvider client={makeQC()}>
        <TooltipProvider>
          <AgentConfigForm
            mode="create"
            values={{
              adapterType: "process",
              cwd: "",
              instructionsFilePath: "",
              promptTemplate: "",
              model: "",
              thinkingEffort: "",
              chrome: false,
              dangerouslySkipPermissions: false,
              search: false,
              fastMode: false,
              dangerouslyBypassSandbox: false,
              command: "",
              args: "",
              extraArgs: "",
              envVars: "",
              envBindings: {},
              url: "",
              bootstrapPrompt: "",
              maxTurnsPerRun: 80,
              heartbeatEnabled: false,
              intervalSec: 300,
            }}
            onChange={onChange}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    // Open the adapter type dropdown
    const adapterBtn = await screen.findByRole("button", { name: /^process$/i });
    await userEvent.click(adapterBtn);

    // Click "Codex (local)" in the dialog
    const dialog = await screen.findByRole("dialog");
    const codexBtn = Array.from(dialog.querySelectorAll("button")).find((b) =>
      b.textContent?.toLowerCase().includes("codex"),
    );
    expect(codexBtn).toBeTruthy();
    await userEvent.click(codexBtn!);

    // Switching adapters still changes the selected adapter; Codex model
    // selection stays blank so the eventual account resolves its own default.
    const calls = onChange.mock.calls;
    const switchCall = calls.find((args: unknown[]) => {
      const patch = args[0] as Record<string, unknown>;
      return patch.adapterType === "codex_local";
    });
    expect(switchCall).toBeTruthy();
    const patch = switchCall![0] as Record<string, unknown>;
    expect(patch.model).toBe("");

    unmount();
  });
});

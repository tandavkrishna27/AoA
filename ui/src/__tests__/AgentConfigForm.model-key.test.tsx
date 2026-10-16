import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { AgentConfigForm } from "../components/AgentConfigForm";
import { TooltipProvider } from "../components/ui/tooltip";
import { defaultCreateValues } from "../components/agent-config-defaults";
import { queryKeys } from "../lib/queryKeys";

const mockAdapterModels = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

vi.mock("../api/agents", () => ({
  agentsApi: {
    adapterModels: mockAdapterModels,
    org: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../api/secrets", () => ({
  secretsApi: {
    list: vi.fn().mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        companyId: "company-1",
        name: "OpenAI API key",
        key: "OPENAI_API_KEY",
        status: "active",
        managedMode: "aoa_managed",
        provider: "local_encrypted",
        providerConfigId: null,
        providerMetadata: null,
        externalRef: null,
        latestVersion: 1,
        description: null,
        lastResolvedAt: null,
        lastRotatedAt: null,
        deletedAt: null,
        createdByAgentId: null,
        createdByUserId: "local-board",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]),
    create: vi.fn(),
  },
}));

vi.mock("../api/environments", () => ({
  useEnvironments: () => ({ data: [] }),
}));

vi.mock("../api/assets", () => ({
  assetsApi: {
    uploadImage: vi.fn(),
  },
}));

vi.mock("../components/MarkdownEditor", () => ({
  MarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Prompt template" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const baseAgent = {
  id: "agent-1",
  companyId: "company-1",
  name: "Software Agent",
  title: "Engineer",
  role: "general",
  capabilities: ["software"],
  status: "active",
  runtimeConfig: {
    heartbeat: {
      enabled: true,
      intervalSec: 300,
      wakeOnDemand: true,
    },
  },
  reportsToAgentId: null,
  reportsToUserId: null,
  parentType: null,
  parentId: null,
  departmentId: null,
  defaultEnvironmentId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function renderForm(agentPatch: Record<string, unknown>, onSave = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
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

function renderCreateForm(onChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AgentConfigForm
          mode="create"
          values={{ ...defaultCreateValues, adapterType: "codex_local", model: "" }}
          onChange={onChange}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );

  return { onChange };
}

describe("AgentConfigForm model API key binding", () => {
  it("requests picker choices using the edited Codex agent identity", async () => {
    mockAdapterModels.mockReset().mockResolvedValue([
      { id: "gpt-account-default", label: "Account Default" },
      { id: "gpt-custom", label: "Custom GPT" },
    ]);
    renderForm({
      id: "agent-1",
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-custom" },
    });

    await waitFor(() => {
      expect(mockAdapterModels).toHaveBeenCalledWith("company-1", "codex_local", "agent-1");
    });
    expect(
      queryKeys.agents.adapterModels("company-1", "codex_local", "agent-1"),
    ).not.toEqual(queryKeys.agents.adapterModels("company-1", "codex_local", "agent-2"));
    expect(await screen.findByRole("button", { name: "Custom GPT" })).toBeInTheDocument();
  });

  it("keeps create mode on inherited default and allows an explicit model choice without an agent catalog", async () => {
    mockAdapterModels.mockReset().mockResolvedValue([
      { id: "gpt-custom", label: "Custom GPT" },
    ]);
    const onChange = vi.fn();
    renderCreateForm(onChange);

    await waitFor(() => {
      expect(mockAdapterModels).toHaveBeenCalledWith("company-1", "codex_local", undefined);
    });
    expect(await screen.findByRole("button", { name: "Account default (Codex CLI)" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Account default (Codex CLI)" }));
    await userEvent.click(await screen.findByRole("button", { name: "Custom GPT" }));
    expect(onChange).toHaveBeenCalledWith({ model: "gpt-custom" });

    await userEvent.click(screen.getByRole("button", { name: "Account default (Codex CLI)" }));
    const defaultOptions = await screen.findAllByRole("button", { name: "Account default (Codex CLI)" });
    await userEvent.click(defaultOptions[1]!);
    expect(onChange).toHaveBeenLastCalledWith({ model: "" });
  });

  it("binds an OpenAI secret into codex_local env without manual env-row editing", async () => {
    const { onSave } = renderForm({
      adapterType: "codex_local",
      adapterConfig: {},
    });

    await userEvent.click(await screen.findByRole("button", { name: /bind secret/i }));
    const labels = await screen.findAllByText("OPENAI_API_KEY");
    const secretLabel = labels.find((label) => label.closest("button"));
    expect(secretLabel).toBeTruthy();
    await userEvent.click(secretLabel!.closest("button") as HTMLButtonElement);
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          adapterConfig: expect.objectContaining({
            env: expect.objectContaining({
              OPENAI_API_KEY: {
                type: "secret_ref",
                secretId: "11111111-1111-4111-8111-111111111111",
                version: "latest",
              },
            }),
          }),
        }),
      );
    });
  });

  it("shows Claude's required ANTHROPIC_API_KEY binding separately from generic env vars", async () => {
    renderForm({
      adapterType: "claude_local",
      adapterConfig: {},
    });

    const field = await screen.findByText("Model API key");
    const container = field.closest("div")?.parentElement;
    expect(container).toBeTruthy();
    expect(within(container as HTMLElement).getByText("ANTHROPIC_API_KEY")).toBeInTheDocument();
  });
});

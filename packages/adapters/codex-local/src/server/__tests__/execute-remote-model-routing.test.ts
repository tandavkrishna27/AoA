import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute, type CodexExecuteDeps } from "../execute.js";
import type { AdapterExecutionContext, AdapterProviderSandboxRunInput } from "@armyofagents/adapter-utils";

const previousCodexHome = process.env.CODEX_HOME;

async function withWorkspace<T>(fn: (root: string, workspace: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aoa-codex-remote-model-routing-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace, { recursive: true });
  process.env.CODEX_HOME = path.join(root, "shared-codex-home");
  await fs.mkdir(process.env.CODEX_HOME, { recursive: true });
  try {
    return await fn(root, workspace);
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await fs.rm(root, { recursive: true, force: true });
  }
}

function baseContext(
  workspace: string,
  runner: (input: AdapterProviderSandboxRunInput) => Promise<{
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
  }>,
  model: string,
): AdapterExecutionContext {
  return {
    runId: "run-remote-model-routing",
    agent: {
      id: "agent-remote",
      companyId: "company-remote",
      name: "Remote Codex",
      adapterType: "codex_local",
      adapterConfig: {},
    },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: {
      command: "codex",
      cwd: workspace,
      model,
      timeoutSec: 10,
      graceSec: 1,
    },
    context: {},
    executionTarget: {
      type: "provider-sandbox",
      provider: "test-provider",
      providerLeaseId: "lease-remote-model-routing",
      remoteCwd: "/workspace",
      runner: { execute: runner },
    },
    runtimeCommandSpec: { command: "codex", installCommand: "do-not-run" },
    authToken: "test-run-token",
    runtimeDecisionRoutingEnabled: true,
    onLog: async () => {},
  };
}

function successfulCodexOutput(): string {
  return [
    JSON.stringify({ type: "thread.started", thread_id: "remote-session" }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 2 } }),
    "",
  ].join("\n");
}

function makeRunner() {
  return vi.fn(async (_input: AdapterProviderSandboxRunInput) => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: successfulCodexOutput(),
    stderr: "",
  }));
}

afterEach(() => {
  if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousCodexHome;
});

describe("execute — remote Codex model routing", () => {
  it("preserves the explicit model on the target and never queries the host catalog", async () => {
    await withWorkspace(async (_root, workspace) => {
      const runner = makeRunner();
      const getModelCatalog = vi.fn(async () => {
        throw new Error("host catalog must not be consulted for a remote target");
      });
      const deps: CodexExecuteDeps = {
        runAppServerTurn: vi.fn(async () => { throw new Error("supervised turn should not run"); }),
        getModelCatalog,
      };

      await execute(baseContext(workspace, runner, "gpt-remote-selected"), deps);

      expect(getModelCatalog).not.toHaveBeenCalled();
      expect(runner).toHaveBeenCalledOnce();
      const args = runner.mock.calls[0]![0].args;
      const modelIndex = args.indexOf("--model");
      expect(modelIndex).toBeGreaterThanOrEqual(0);
      expect(args[modelIndex + 1]).toBe("gpt-remote-selected");
    });
  });

  it("leaves a blank model inherited by the target account even when the host has a shared default", async () => {
    await withWorkspace(async (_root, workspace) => {
      await fs.writeFile(path.join(process.env.CODEX_HOME!, "config.toml"), 'model = "gpt-host-default"\n');
      const runner = makeRunner();
      const getModelCatalog = vi.fn();
      await execute(baseContext(workspace, runner, ""), {
        runAppServerTurn: vi.fn(async () => { throw new Error("supervised turn should not run"); }),
        getModelCatalog: getModelCatalog as CodexExecuteDeps["getModelCatalog"],
      });

      expect(getModelCatalog).not.toHaveBeenCalled();
      const args = runner.mock.calls[0]![0].args;
      expect(args).not.toContain("--model");
      expect(args).not.toContain("gpt-host-default");
    });
  });
});

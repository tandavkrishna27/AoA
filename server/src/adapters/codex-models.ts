import fs from "node:fs/promises";
import path from "node:path";
import type { AdapterModel } from "./types.js";
import {
  adapterExecutionTargetIsRemote,
  readAdapterExecutionTarget,
  type AdapterExecutionTarget,
} from "@armyofagents/adapter-utils";
import { buildScrubbedCliEnv } from "../services/cli-spawn-safety.js";
import { tenantIsolationEnforced } from "../config/deployment-mode.js";
import {
  getCodexModelCatalog,
  isCodexCompatibleModel,
  isSafeCodexModelIdentifier,
  resolveManagedCodexHomeDir,
  type CodexModelCatalog,
} from "@armyofagents/adapter-codex-local/server";

export interface CodexModelListAgentContext {
  companyId: string;
  agentId: string;
  /** Resolved from this agent's persisted config by the server route. */
  adapterConfig: Record<string, unknown>;
}

export interface CodexModelListDeps {
  getCatalog?: typeof getCodexModelCatalog;
  stat?: typeof fs.stat;
  env?: NodeJS.ProcessEnv;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isCodexCommand(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const command = value.trim();
  if (!command || /[&|<>^`$;%'"\r\n()]/.test(command)) return false;
  const basename = command.replace(/\\/g, "/").split("/").at(-1);
  return typeof basename === "string" && /^codex(?:\.(?:cmd|exe))?$/i.test(basename);
}

async function hasRegularAuthFile(
  authHome: string,
  stat: typeof fs.stat,
): Promise<boolean> {
  try {
    return (await stat(path.join(authHome, "auth.json"))).isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Read model choices from one existing agent's managed CODEX_HOME. The public
 * adapter registry has no agent context, so its unscoped catalog stays empty.
 * This function never copies the operator's shared ~/.codex/auth.json into an
 * agent home and never uses the host-global model config as a catalog.
 */
export async function listCodexModelsForAgent(
  context: CodexModelListAgentContext,
  deps: CodexModelListDeps = {},
): Promise<AdapterModel[]> {
  // Cloud and distributed targets do not own a local Codex process/account.
  // Their model selection remains inherited or is validated on the target.
  if (tenantIsolationEnforced()) return [];

  const config = context.adapterConfig;
  const command = typeof config.command === "string" && config.command.trim()
    ? config.command.trim()
    : "codex";
  if (!isCodexCommand(command)) return [];
  let configuredTarget: AdapterExecutionTarget;
  try {
    const rawTarget = config.executionTarget;
    configuredTarget = readAdapterExecutionTarget({
      executionTarget: rawTarget && typeof rawTarget === "object"
        ? rawTarget as AdapterExecutionTarget
        : undefined,
      legacyRemoteExecution: config.remoteExecution,
    });
  } catch {
    // A malformed/unsupported target must never cause host-account discovery.
    return [];
  }
  if (adapterExecutionTargetIsRemote(configuredTarget)) return [];

  const env = deps.env ?? process.env;
  const authHome = resolveManagedCodexHomeDir(env, context.companyId, context.agentId);
  const configEnv = asRecord(config.env);
  const catalogEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(buildScrubbedCliEnv())) {
    if (typeof value === "string") catalogEnv[key] = value;
  }
  // Execution uses only the agent's resolved provider key. In particular, an
  // ambient server OPENAI_API_KEY is not part of this catalog identity.
  for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY"] as const) {
    const value = configEnv[key];
    if (typeof value === "string" && value.trim()) catalogEnv[key] = value.trim();
  }
  catalogEnv.CODEX_HOME = authHome;

  const hasExplicitApiKey = Boolean(
    catalogEnv.OPENAI_API_KEY?.trim() || catalogEnv.CODEX_API_KEY?.trim(),
  );
  if (!hasExplicitApiKey && !(await hasRegularAuthFile(authHome, deps.stat ?? fs.stat))) {
    // A first-run agent has not yet received its execution-scoped auth copy.
    // Keep the inherited account-default choice available without reading or
    // copying the host's shared credential from a model-list request.
    return [];
  }

  const catalog: CodexModelCatalog = await (deps.getCatalog ?? getCodexModelCatalog)({
    companyId: context.companyId,
    authHome,
    authMode: "auto",
    command,
    cwd: process.cwd(),
    env: catalogEnv,
  });
  return catalog.models
    .filter((model) => {
      if (model.hidden || model.retired || !isSafeCodexModelIdentifier(model.id)) return false;
      return catalog.identity.authMode === "apikey"
        ? true
        : isCodexCompatibleModel(model.id);
    })
    .map((model) => ({ id: model.id, label: model.displayName?.trim() || model.id }));
}

/** The generic registry cannot safely infer an account without an agent id. */
export async function listCodexModels(): Promise<AdapterModel[]> {
  return [];
}

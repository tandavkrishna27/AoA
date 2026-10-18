import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import {
  CodexModelAvailabilityError,
  CodexModelCatalogCache,
  type CodexCatalogModel,
  type CodexModelAuthMode,
  type CodexModelCatalog,
  type CodexModelCatalogIdentity,
} from "./model-availability.js";
import { ensurePathInEnv, mergeChildEnv } from "@armyofagents/adapter-utils/server-utils";
import { parseCodexAuthStatus } from "./auth-status.js";
import { spawnAppServerClient } from "./app-server/jsonrpc-client.js";

const execFileAsync = promisify(execFile);
const CODEX_MODEL_CATALOG_CACHE = new CodexModelCatalogCache({
  freshTtlMs: 30_000,
  staleTtlMs: 120_000,
});
const CODEX_PROBE_TIMEOUT_MS = 8_000;
const CODEX_MODEL_LIST_LIMIT = 100;
const CODEX_MODEL_LIST_MAX_PAGES = 8;
const CODEX_MODEL_RPC_TIMEOUT_MS = 15_000;

export interface CodexModelCatalogRequest {
  companyId: string;
  authHome: string;
  authMode: CodexModelAuthMode | "auto";
  command: string;
  cwd: string;
  env: Record<string, string>;
  graceSec?: number;
}

export interface CodexModelCatalogDeps {
  runCommand?: (
    command: string,
    args: string[],
    options: { cwd: string; env: Record<string, string>; timeout: number; shell: boolean },
  ) => Promise<{ stdout: string; stderr: string }>;
  spawnAppServer?: typeof spawnAppServerClient;
}

const runCommand = async (
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; timeout: number; shell: boolean },
): Promise<{ stdout: string; stderr: string }> => {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: ensurePathInEnv(
      mergeChildEnv(process.env, options.env, ["OPENAI_API_KEY", "CODEX_API_KEY"]),
    ),
    timeout: options.timeout,
    windowsHide: true,
    shell: options.shell,
    encoding: "utf8",
    maxBuffer: 256 * 1024,
  });
  return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
};

function parseCliVersion(output: string): string {
  const match = /\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/.exec(output);
  if (!match) {
    throw new CodexModelAvailabilityError(
      "catalog_unavailable",
      "Could not identify the Codex CLI version. Reinstall the supported Codex CLI and retry.",
    );
  }
  return match[1]!;
}

function hasExplicitApiKey(env: Record<string, string>): boolean {
  return [env.OPENAI_API_KEY, env.CODEX_API_KEY].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

function parseCliAuthMode(output: string, env: Record<string, string>): CodexModelAuthMode | null {
  if (hasExplicitApiKey(env)) return "apikey";
  const status = parseCodexAuthStatus(output);
  if (!status.loggedIn) return null;
  if (/api\s*key/i.test(status.account ?? "")) return "apikey";
  if (/chatgpt/i.test(status.account ?? "")) return "subscription";
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseModelPage(value: unknown): { models: CodexCatalogModel[]; nextCursor: string | null } {
  const root = asRecord(value);
  if (!root || !Array.isArray(root.data)) {
    throw new Error("Codex model/list returned a malformed response");
  }
  const models: CodexCatalogModel[] = [];
  for (const rowValue of root.data) {
    const row = asRecord(rowValue);
    if (!row) continue;
    const id = typeof row.model === "string" ? row.model : row.id;
    if (typeof id !== "string" || id.trim().length === 0) continue;
    const upgradeInfo = asRecord(row.upgradeInfo);
    const retirementAt = upgradeInfo?.retirementAt;
    models.push({
      id: id.trim(),
      displayName: typeof row.displayName === "string" ? row.displayName.trim() : undefined,
      isDefault: row.isDefault === true,
      hidden: row.hidden === true,
      retired: typeof retirementAt === "number" && retirementAt * 1_000 <= Date.now(),
    });
  }
  const nextCursor = typeof root.nextCursor === "string" && root.nextCursor.length > 0
    ? root.nextCursor
    : null;
  return { models, nextCursor };
}

async function authGeneration(authHome: string, env: Record<string, string>): Promise<string> {
  const stat = await fs.stat(`${authHome}/auth.json`).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  const fileGeneration = stat?.isFile()
    ? `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
    : "missing-auth";
  const apiCredentialFingerprint = createHash("sha256")
    .update([env.OPENAI_API_KEY ?? "", env.CODEX_API_KEY ?? ""].join("\0"))
    .digest("hex");
  return `${fileGeneration}:${apiCredentialFingerprint}`;
}

function envForCatalog(request: CodexModelCatalogRequest): Record<string, string> {
  const env: Record<string, string> = { ...request.env, CODEX_HOME: request.authHome };
  // Subscription discovery must use only the exact managed login. Explicit API
  // key mode keeps the same key the eventual execution receives.
  if (request.authMode === "subscription" || request.authMode === "chatgpt") {
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
  }
  return env;
}

async function readCodexCatalog(
  request: CodexModelCatalogRequest,
  identity: CodexModelCatalogIdentity,
  deps: CodexModelCatalogDeps,
): Promise<CodexModelCatalog> {
  const env = envForCatalog(request);
  const spawned = (deps.spawnAppServer ?? spawnAppServerClient)({
    runId: `codex-model-catalog-${request.companyId}-${Date.now()}`,
    command: request.command,
    cwd: request.cwd,
    env,
    graceSec: request.graceSec ?? 5,
    unsetEnvKeys: ["OPENAI_API_KEY", "CODEX_API_KEY"].filter(
      (key) => !(typeof env[key] === "string" && env[key].trim().length > 0),
    ),
    shell: process.platform === "win32",
  });
  const deadline = Date.now() + CODEX_MODEL_RPC_TIMEOUT_MS;
  const rpcRequest = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Codex model catalog RPC timed out");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        spawned.client.request(method, params),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Codex model catalog RPC timed out")), remaining);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  try {
    await rpcRequest("initialize", {
      clientInfo: {
        name: "aoa-codex-model-catalog",
        title: "AoA Codex model catalog",
        version: "1.0.0",
      },
    });
    spawned.client.notify("initialized");

    const models: CodexCatalogModel[] = [];
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    for (let page = 0; page < CODEX_MODEL_LIST_MAX_PAGES; page += 1) {
      const response = await rpcRequest("model/list", {
        cursor,
        limit: CODEX_MODEL_LIST_LIMIT,
        includeHidden: true,
      });
      const parsed = parseModelPage(response);
      models.push(...parsed.models);
      if (!parsed.nextCursor) break;
      if (seenCursors.has(parsed.nextCursor)) {
        throw new Error("Codex model/list repeated a pagination cursor");
      }
      seenCursors.add(parsed.nextCursor);
      cursor = parsed.nextCursor;
      if (page === CODEX_MODEL_LIST_MAX_PAGES - 1) {
        throw new Error("Codex model/list exceeded the supported pagination limit");
      }
    }
    return { identity, models };
  } finally {
    spawned.client.close();
    spawned.terminate();
  }
}

/**
 * Read model/list from the requested managed auth home. The executable's own
 * version and login mode are verified first and included in the cache key.
 */
export async function getCodexModelCatalog(
  request: CodexModelCatalogRequest,
  deps: CodexModelCatalogDeps = {},
): Promise<CodexModelCatalog> {
  const env = envForCatalog(request);
  const commandRunner = deps.runCommand ?? runCommand;
  const execOptions = {
    cwd: request.cwd,
    env,
    timeout: CODEX_PROBE_TIMEOUT_MS,
    shell: process.platform === "win32",
  };

  try {
    const versionResult = await commandRunner(request.command, ["--version"], execOptions);
    const version = parseCliVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
    // The CLI's `login status` reads persisted Codex auth storage. It does not
    // recognize an API key supplied only through the execution environment, so
    // require that probe only for subscription/file-login discovery. An
    // explicitly supplied key is the auth context used by both model/list and
    // the eventual run, and its fingerprint is included in authGeneration.
    let activeAuthMode: CodexModelAuthMode | null;
    if (hasExplicitApiKey(env)) {
      activeAuthMode = "apikey";
    } else {
      const authResult = await commandRunner(request.command, ["login", "status"], execOptions);
      activeAuthMode = parseCliAuthMode(`${authResult.stdout}\n${authResult.stderr}`, env);
    }
    const compatibleAuthModes = request.authMode === "auto"
      ? ["apikey", "subscription"]
      : request.authMode === "chatgpt"
      ? ["chatgpt", "subscription"]
      : [request.authMode];
    if (!activeAuthMode || !compatibleAuthModes.includes(activeAuthMode)) {
      throw new CodexModelAvailabilityError(
        "catalog_identity_mismatch",
        "The Codex login mode changed or does not match this run. Reauthenticate the intended account and retry.",
      );
    }
    const generation = await authGeneration(request.authHome, env);
    const identity: CodexModelCatalogIdentity = {
      companyId: request.companyId,
      authHome: request.authHome,
      authGeneration: generation,
      authMode: activeAuthMode,
      cliVersion: version,
    };
    return await CODEX_MODEL_CATALOG_CACHE.get(
      identity,
      () => readCodexCatalog(request, identity, deps),
    );
  } catch (err) {
    if (err instanceof CodexModelAvailabilityError) throw err;
    throw new CodexModelAvailabilityError(
      "catalog_unavailable",
      "Could not read the model catalog from the installed Codex CLI. Check that the pinned CLI is installed and signed in, then retry. No API-key fallback was attempted.",
      { cause: err },
    );
  }
}

export function resetCodexModelCatalogCacheForTests(): void {
  CODEX_MODEL_CATALOG_CACHE.clear();
}

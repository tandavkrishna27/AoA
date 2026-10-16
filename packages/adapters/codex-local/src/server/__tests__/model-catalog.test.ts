import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCodexModelCatalog,
  resetCodexModelCatalogCacheForTests,
  type CodexModelCatalogDeps,
} from "../model-catalog.js";
import type {
  SpawnAppServerClientOptions,
  SpawnedAppServerClient,
} from "../app-server/jsonrpc-client.js";

const API_KEY = "sk-unit-test-not-a-real-credential";

function makeDeps(options: {
  authStatus?: string;
  loginStatusError?: Error;
  modelPage?: unknown;
} = {}) {
  const commandEnvs: Record<string, string>[] = [];
  const serverOptions: SpawnAppServerClientOptions[] = [];
  const closed = vi.fn();
  const terminated = vi.fn();
  const runCommand: NonNullable<CodexModelCatalogDeps["runCommand"]> = vi.fn(
    async (
      _command: string,
      args: string[],
      commandOptions: { cwd: string; env: Record<string, string>; timeout: number; shell: boolean },
    ) => {
      commandEnvs.push(commandOptions.env);
      if (args[0] === "--version") return { stdout: "codex-cli 0.145.0", stderr: "" };
      if (options.loginStatusError) throw options.loginStatusError;
      return { stdout: options.authStatus ?? "Logged in using ChatGPT", stderr: "" };
    },
  );
  const spawnAppServer: NonNullable<CodexModelCatalogDeps["spawnAppServer"]> = vi.fn(
    (spawnOptions: SpawnAppServerClientOptions) => {
      serverOptions.push(spawnOptions);
      return {
        client: {
          request: vi.fn(async (method: string) => {
            if (method === "initialize") return {};
            return options.modelPage ?? {
              data: [{ model: "gpt-account-default", displayName: "Account default", isDefault: true }],
              nextCursor: null,
            };
          }),
          notify: vi.fn(),
          respond: vi.fn(),
          respondError: vi.fn(),
          onClose: vi.fn(),
          close: closed,
        },
        child: {} as SpawnedAppServerClient["child"],
        terminate: terminated,
      };
    },
  ) as unknown as NonNullable<CodexModelCatalogDeps["spawnAppServer"]>;

  return {
    deps: { runCommand, spawnAppServer } as CodexModelCatalogDeps,
    commandEnvs,
    serverOptions,
    closed,
    terminated,
  };
}

function request(
  env: Record<string, string> = {},
  authMode: "auto" | "subscription" | "chatgpt" | "apikey" = "auto",
) {
  return {
    companyId: "company-test",
    authHome: "C:/aoa-test/missing-codex-home",
    authMode,
    command: "codex",
    cwd: "C:/aoa-test",
    env,
  };
}

describe("getCodexModelCatalog", () => {
  beforeEach(() => resetCodexModelCatalogCacheForTests());

  it("keeps explicit API-key auth in version and model/list discovery without persisted login", async () => {
    const h = makeDeps({ authStatus: "Logged in using ChatGPT" });
    const catalog = await getCodexModelCatalog(
      request({ CODEX_HOME: "C:/ambient", OPENAI_API_KEY: API_KEY }, "apikey"),
      h.deps,
    );

    expect(catalog.identity.authMode).toBe("apikey");
    expect(h.commandEnvs).toHaveLength(1);
    expect(h.commandEnvs.every((env) => env.OPENAI_API_KEY === API_KEY)).toBe(true);
    expect(h.commandEnvs.every((env) => env.CODEX_HOME === request().authHome)).toBe(true);
    expect(h.serverOptions[0]!.env.OPENAI_API_KEY).toBe(API_KEY);
    expect(h.serverOptions[0]!.unsetEnvKeys).not.toContain("OPENAI_API_KEY");
    expect(h.closed).toHaveBeenCalledOnce();
    expect(h.terminated).toHaveBeenCalledOnce();
  });

  it("discovers key-only models when the empty home makes login status fail", async () => {
    const h = makeDeps({ loginStatusError: new Error("Codex login status exited 1: Not logged in") });
    const catalog = await getCodexModelCatalog(
      request({ OPENAI_API_KEY: API_KEY }),
      h.deps,
    );

    expect(catalog.identity.authMode).toBe("apikey");
    expect(catalog.identity.authGeneration).not.toContain(API_KEY);
    expect(h.deps.runCommand).toHaveBeenCalledOnce();
    expect(h.deps.runCommand).toHaveBeenCalledWith(
      "codex",
      ["--version"],
      expect.objectContaining({ env: expect.objectContaining({ OPENAI_API_KEY: API_KEY }) }),
    );
    expect(h.serverOptions).toHaveLength(1);
    expect(h.serverOptions[0]!.env.OPENAI_API_KEY).toBe(API_KEY);
    expect(h.serverOptions[0]!.unsetEnvKeys).not.toContain("OPENAI_API_KEY");
    expect(h.closed).toHaveBeenCalledOnce();
    expect(h.terminated).toHaveBeenCalledOnce();
  });

  it("strips ambient API keys from subscription catalog discovery", async () => {
    const h = makeDeps();
    const catalog = await getCodexModelCatalog(
      request({ OPENAI_API_KEY: API_KEY, CODEX_API_KEY: "codex-key" }, "subscription"),
      h.deps,
    );

    expect(catalog.identity.authMode).toBe("subscription");
    expect(h.commandEnvs.every((env) => env.OPENAI_API_KEY === undefined)).toBe(true);
    expect(h.commandEnvs.every((env) => env.CODEX_API_KEY === undefined)).toBe(true);
    expect(h.serverOptions[0]!.env.OPENAI_API_KEY).toBeUndefined();
    expect(h.serverOptions[0]!.unsetEnvKeys).toEqual(["OPENAI_API_KEY", "CODEX_API_KEY"]);
  });

  it("rejects malformed model/list payloads without echoing credentials", async () => {
    const h = makeDeps({ modelPage: { data: "not-an-array" } });
    let thrown: unknown;
    try {
      await getCodexModelCatalog(request({ OPENAI_API_KEY: API_KEY }, "apikey"), h.deps);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/Could not read the model catalog/);
    expect((thrown as Error).message).not.toContain(API_KEY);
    expect(h.closed).toHaveBeenCalledOnce();
    expect(h.terminated).toHaveBeenCalledOnce();
  });

  it("fails closed when CLI auth does not match the requested subscription mode", async () => {
    const h = makeDeps({ authStatus: "Not logged in" });
    await expect(
      getCodexModelCatalog(request({}, "subscription"), h.deps),
    ).rejects.toThrow(/login mode changed|does not match/i);
    expect(h.serverOptions).toHaveLength(0);
  });
});

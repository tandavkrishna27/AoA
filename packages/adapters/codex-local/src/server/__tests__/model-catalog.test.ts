import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

  it("uses the effective parent PATH for real CLI probes, honors an explicit PATH, and strips ambient keys", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-catalog-env-"));
    const binDir = path.join(tempRoot, "bin");
    await fs.mkdir(binDir);
    const capturePath = path.join(tempRoot, "captured-env.json");
    const helperPath = path.join(binDir, "probe.cjs");
    await fs.writeFile(
      helperPath,
      [
        "const fs = require('node:fs');",
        "fs.appendFileSync(process.env.AOA_TEST_CAPTURE, JSON.stringify({ args: process.argv.slice(2), path: process.env.PATH, openai: process.env.OPENAI_API_KEY, codex: process.env.CODEX_API_KEY }) + '\\n');",
        "if (process.argv[2] === '--version') {",
        "  process.stdout.write('codex-cli 0.145.0\\n');",
        "} else if (process.argv[2] === 'login' && process.argv[3] === 'status') {",
        "  process.stdout.write('Logged in using ChatGPT\\n');",
        "}",
      ].join("\n"),
      "utf8",
    );

    const command = process.platform === "win32" ? "codex.cmd" : "codex";
    const nodeCommand = `"${process.execPath}"`;
    if (process.platform === "win32") {
      await fs.writeFile(
        path.join(binDir, command),
        `@echo off\r\n${nodeCommand} "%~dp0probe.cjs" %*\r\n`,
        "utf8",
      );
    } else {
      const shimPath = path.join(binDir, command);
      await fs.writeFile(shimPath, `#!/bin/sh\nexec ${nodeCommand} "\${0%/*}/probe.cjs" "$@"\n`, "utf8");
      await fs.chmod(shimPath, 0o755);
    }

    const originalPath = process.env.PATH;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalCodexKey = process.env.CODEX_API_KEY;
    const originalCapture = process.env.AOA_TEST_CAPTURE;
    const explicitKey = "sk-explicit-codex-catalog-test";
    const ambientCodexKey = "sk-ambient-codex-catalog-test";
    try {
      process.env.PATH = [binDir, originalPath].filter(Boolean).join(path.delimiter);
      process.env.OPENAI_API_KEY = "sk-ambient-openai-catalog-test";
      process.env.CODEX_API_KEY = ambientCodexKey;
      process.env.AOA_TEST_CAPTURE = capturePath;

      const h = makeDeps();
      const catalog = await getCodexModelCatalog(
        {
          ...request({ OPENAI_API_KEY: explicitKey, AOA_TEST_CAPTURE: capturePath }, "apikey"),
          cwd: tempRoot,
          command,
        },
        { spawnAppServer: h.deps.spawnAppServer },
      );

      expect(catalog.models[0]?.id).toBe("gpt-account-default");
      const captured = JSON.parse((await fs.readFile(capturePath, "utf8")).trim().split("\n")[0]!) as {
        path?: string;
        args?: string[];
        openai?: string;
        codex?: string;
      };
      expect(captured.args).toEqual(["--version"]);
      expect(captured.path).toBe(process.env.PATH);
      expect(captured.openai).toBe(explicitKey);
      expect(captured.codex).toBeUndefined();
      expect(h.serverOptions[0]?.env.PATH).toBeUndefined();
      expect(h.serverOptions[0]?.env.OPENAI_API_KEY).toBe(explicitKey);

      const explicitPath = [binDir, path.join(tempRoot, "explicit-path-marker")].join(path.delimiter);
      await fs.rm(capturePath, { force: true });
      resetCodexModelCatalogCacheForTests();
      const explicitPathHarness = makeDeps();
      await getCodexModelCatalog(
        {
          ...request({
            PATH: explicitPath,
            OPENAI_API_KEY: explicitKey,
            AOA_TEST_CAPTURE: capturePath,
          }, "apikey"),
          companyId: "company-explicit-path-test",
          cwd: tempRoot,
          command,
        },
        { spawnAppServer: explicitPathHarness.deps.spawnAppServer },
      );
      const explicitPathCapture = JSON.parse((await fs.readFile(capturePath, "utf8")).trim().split("\n")[0]!) as {
        path?: string;
      };
      expect(explicitPathCapture.path).toBe(explicitPath);
      expect(explicitPathHarness.serverOptions[0]?.env.PATH).toBe(explicitPath);

      await fs.rm(capturePath, { force: true });
      resetCodexModelCatalogCacheForTests();
      const subscriptionHarness = makeDeps();
      await getCodexModelCatalog(
        {
          ...request({ AOA_TEST_CAPTURE: capturePath }, "subscription"),
          companyId: "company-subscription-env-test",
          cwd: tempRoot,
          command,
        },
        { spawnAppServer: subscriptionHarness.deps.spawnAppServer },
      );
      const subscriptionCaptures = (await fs.readFile(capturePath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { args?: string[]; openai?: string; codex?: string });
      expect(subscriptionCaptures.map((entry) => entry.args)).toEqual([
        ["--version"],
        ["login", "status"],
      ]);
      expect(subscriptionCaptures.every((entry) => entry.openai === undefined)).toBe(true);
      expect(subscriptionCaptures.every((entry) => entry.codex === undefined)).toBe(true);
      expect(subscriptionHarness.serverOptions[0]?.env.OPENAI_API_KEY).toBeUndefined();
      expect(subscriptionHarness.serverOptions[0]?.env.CODEX_API_KEY).toBeUndefined();
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAiKey;
      if (originalCodexKey === undefined) delete process.env.CODEX_API_KEY;
      else process.env.CODEX_API_KEY = originalCodexKey;
      if (originalCapture === undefined) delete process.env.AOA_TEST_CAPTURE;
      else process.env.AOA_TEST_CAPTURE = originalCapture;
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
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

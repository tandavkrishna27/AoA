import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { beforeAll, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let bundle: Uint8Array;

beforeAll(async () => {
  const { default: config } = await import(new URL("../../esbuild.config.mjs", import.meta.url).href);
  const result = await build({ ...config, absWorkingDir: cliDir, write: false, sourcemap: false });
  bundle = result.outputFiles![0]!.contents;
});

async function put(file: string, contents: string | Uint8Array) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents);
}

async function linkDependencies(destination: string, serverPackage: string, withTsx: boolean) {
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(join(cliDir, "node_modules"))) {
    if (name.startsWith(".")) continue;
    if (name === "tsx" && !withTsx) continue;
    if (name === "@armyofagents") {
      await mkdir(join(destination, name));
      for (const packageName of await readdir(join(cliDir, "node_modules", name))) {
        await symlink(
          packageName === "server" ? serverPackage : join(cliDir, "node_modules", name, packageName),
          join(destination, name, packageName),
          "junction",
        );
      }
    } else {
      await symlink(join(cliDir, "node_modules", name), join(destination, name), "junction");
    }
  }
}

// Keep config writing, onboarding, doctor and entry selection real. Only replace
// the server entry boundary: importing the application would start DB/UI services.
const marker = (entry: string) => `console.log(JSON.stringify({ entry: ${JSON.stringify(entry)}, uiDev: process.env.AOA_UI_DEV_MIDDLEWARE ?? null }));`;

async function fixture(options: { source?: boolean; installed?: boolean; withoutTsx?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "aoa-cli-entry-"));
  const packageDir = options.installed
    ? join(directory, "node_modules", "@armyofagents", "cli")
    : join(directory, "cli");
  await put(join(directory, "pnpm-workspace.yaml"), "packages:\n  - cli\n  - server\n");
  await put(join(directory, "server", "package.json"), JSON.stringify({ name: "@armyofagents/server", type: "module", exports: "./src/index.ts" }));
  await put(join(directory, "server", "src", "index.ts"), 'throw new Error("SOURCE_ENTRY_WAS_SELECTED");');
  const installedServer = join(directory, "controlled-installed-server");
  await put(join(installedServer, "package.json"), JSON.stringify({ name: "@armyofagents/server", type: "module", exports: "./dist/index.js" }));
  await put(join(installedServer, "dist", "index.js"), marker("installed"));
  await put(join(packageDir, "package.json"), JSON.stringify({ name: "@armyofagents/cli", type: "module" }));
  await linkDependencies(join(packageDir, "node_modules"), installedServer, !options.installed && !options.withoutTsx);
  const entry = options.source ? join(packageDir, "src", "index.ts") : join(packageDir, "dist", "index.js");
  if (options.source) {
    await cp(join(cliDir, "src"), join(packageDir, "src"), { recursive: true });
  } else {
    await put(entry, bundle);
  }

  async function run(extraEnv: NodeJS.ProcessEnv = {}) {
    // Whitelist OS runtime variables so inherited AOA/PAPERCLIP/DATABASE/provider
    // settings and NODE_OPTIONS cannot escape this fixture or supply a loader.
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "COMSPEC", "PATHEXT", "TEMP", "TMP", "HOME", "USERPROFILE"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    const args = options.source ? [join(cliDir, "node_modules", "tsx", "dist", "cli.mjs"), entry] : [entry];
    try {
      const result = await execFileAsync(process.execPath, [...args, "onboard", "--yes", "--data-dir", join(directory, "state")], {
        cwd: directory, env: { ...env, ...extraEnv }, timeout: 15_000,
      });
      return { code: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const result = error as Error & { code: number; stdout: string; stderr: string };
      return { code: result.code, stdout: result.stdout, stderr: result.stderr };
    }
  }
  return { directory, run, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

it.each([undefined, "false"])("plain built onboarding imports the workspace build without source or installed fallback (UI override %s)", async (uiDev) => {
  const test = await fixture();
  try {
    await put(join(test.directory, "server", "dist", "index.js"), marker("built"));
    const result = await test.run(uiDev === undefined ? {} : { AOA_UI_DEV_MIDDLEWARE: uiDev });
    expect(result, result.stderr).toMatchObject({ code: 0 });
    expect(result.stdout).toContain(JSON.stringify({ entry: "built", uiDev: uiDev ?? null }));
    expect(result.stdout).not.toContain('"entry":"installed"');
  } finally { await test.cleanup(); }
});

it("missing workspace build fails with build guidance instead of selecting source or an installed server", async () => {
  const test = await fixture();
  try {
    const result = await test.run();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("server");
    expect(result.stderr).toContain("dist");
    expect(result.stderr).toContain("pnpm build");
    expect(result.stderr).not.toContain("SOURCE_ENTRY_WAS_SELECTED");
    expect(result.stdout).not.toContain('"entry":"installed"');
  } finally { await test.cleanup(); }
});

it("built onboarding resolves source-exported workspace dependencies with relative JavaScript specifiers", async () => {
  const test = await fixture();
  try {
    const sharedPackage = join(test.directory, "packages", "shared");
    await put(join(sharedPackage, "package.json"), JSON.stringify({ name: "@armyofagents/shared", type: "module", exports: "./src/index.ts" }));
    await put(join(sharedPackage, "src", "index.ts"), 'export { value } from "./constants.js";');
    await put(join(sharedPackage, "src", "constants.ts"), 'export const value: string = "WORKSPACE_DEPENDENCY_LOADED";');
    const serverDependencies = join(test.directory, "server", "node_modules", "@armyofagents");
    await mkdir(serverDependencies, { recursive: true });
    await symlink(sharedPackage, join(serverDependencies, "shared"), "junction");
    await put(join(test.directory, "server", "dist", "index.js"), 'import { value } from "@armyofagents/shared"; console.log(value);' + marker("built"));
    const result = await test.run();
    expect(result, result.stderr).toMatchObject({ code: 0 });
    expect(result.stdout).toContain("WORKSPACE_DEPENDENCY_LOADED");
    expect(result.stdout).toContain('{"entry":"built","uiDev":null}');
  } finally { await test.cleanup(); }
});

it("built onboarding loads the real PDF parser and its native canvas dependency", async () => {
  const test = await fixture();
  try {
    const serverDependencies = join(test.directory, "server", "node_modules");
    await mkdir(serverDependencies, { recursive: true });
    await symlink(resolve(cliDir, "../server/node_modules/pdf-parse"), join(serverDependencies, "pdf-parse"), "junction");
    await put(join(test.directory, "server", "dist", "index.js"),
      'import { PDFParse } from "pdf-parse"; if (typeof PDFParse !== "function") throw new Error("PDF parser export missing");' + marker("built"));
    const result = await test.run();
    expect(result, result.stderr).toMatchObject({ code: 0 });
    expect(result.stdout).toContain('{"entry":"built","uiDev":null}');
    expect(result.stderr).not.toContain("Cannot load");
    expect(result.stderr).not.toContain("Cannot polyfill");
  } finally { await test.cleanup(); }
});

it("missing workspace development dependencies report install/build guidance with the original cause", async () => {
  const test = await fixture({ withoutTsx: true });
  try {
    await put(join(test.directory, "server", "dist", "index.js"), marker("built"));
    const result = await test.run();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("pnpm install --frozen-lockfile");
    expect(result.stderr).toContain("pnpm build");
    expect(result.stderr).toContain("Cannot find package 'tsx'");
    expect(result.stdout).not.toContain('"entry":');
  } finally { await test.cleanup(); }
});

it.each([
  ['throw new Error("CONTROLLED_BUILT_STARTUP_FAILURE");', "CONTROLLED_BUILT_STARTUP_FAILURE"],
  ['await import("controlled-missing-runtime-dependency");', "controlled-missing-runtime-dependency"],
])("workspace build startup errors propagate without falling back to the installed server (%s)", async (contents, error) => {
  const test = await fixture();
  try {
    await put(join(test.directory, "server", "dist", "index.js"), contents);
    const result = await test.run();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(error);
    expect(result.stderr).not.toContain("Could not locate");
    expect(result.stdout).not.toContain('"entry":"installed"');
  } finally { await test.cleanup(); }
});

it("installed CLI resolves its server package even when run from a source workspace", async () => {
  const test = await fixture({ installed: true });
  try {
    await put(join(test.directory, "server", "dist", "index.js"), 'throw new Error("WORKSPACE_BUILD_WAS_SELECTED");');
    const result = await test.run();
    expect(result, result.stderr).toMatchObject({ code: 0 });
    expect(result.stdout).toContain('{"entry":"installed","uiDev":null}');
  } finally { await test.cleanup(); }
});

it.each([undefined, "false"])("source CLI keeps the tsx server path and respects UI development middleware override %s", async (uiDev) => {
  const test = await fixture({ source: true });
  try {
    await put(join(test.directory, "server", "src", "index.ts"), marker("source"));
    await put(join(test.directory, "server", "dist", "index.js"), 'throw new Error("BUILD_ENTRY_WAS_SELECTED");');
    const result = await test.run(uiDev === undefined ? {} : { AOA_UI_DEV_MIDDLEWARE: uiDev });
    expect(result, result.stderr).toMatchObject({ code: 0 });
    expect(result.stdout).toContain(JSON.stringify({ entry: "source", uiDev: uiDev ?? "true" }));
  } finally { await test.cleanup(); }
});

it("installed server dependency failures preserve the cause rather than reporting a missing entrypoint", async () => {
  const test = await fixture({ installed: true });
  try {
    await put(join(test.directory, "controlled-installed-server", "dist", "index.js"), 'await import("controlled-missing-installed-dependency");');
    const result = await test.run();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("AoA server failed to start");
    expect(result.stderr).toContain("controlled-missing-installed-dependency");
    expect(result.stderr).not.toContain("Could not locate");
  } finally { await test.cleanup(); }
});

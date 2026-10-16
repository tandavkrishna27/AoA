import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

it("runs the built CLI with only its strict package dependency links", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aoa-cli-bundle-"));
  try {
    // A separate package location prevents an ancestor workspace node_modules from
    // hiding a missing runtime dependency in the CLI's own pnpm links.
    await symlink(join(cliDir, "node_modules"), join(directory, "node_modules"), "junction");
    const { default: config } = await import(new URL("../../esbuild.config.mjs", import.meta.url).href);
    const result = await build({ ...config, absWorkingDir: cliDir, write: false, sourcemap: false });
    const entry = join(directory, "index.mjs");
    await writeFile(entry, result.outputFiles![0]!.contents);
    for (const args of [["--help"], ["onboard", "--help"]]) {
      const { stdout } = await execFileAsync(process.execPath, [entry, ...args], { timeout: 15_000 });
      expect(stdout).toContain("Usage: aoa");
      expect(stdout).toContain(args.length === 1 ? "onboard" : "--data-dir");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

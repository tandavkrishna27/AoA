import { build } from "esbuild";
import { createRequire } from "node:module";
import { BROWSER_CONFIG_PATH, BROWSER_RUNNER_PATH, BROWSER_RUNTIME_ROOT } from "./browser-runtime-preparation.js";
import type { StagedInputFile } from "./job-input-staging.js";

let runnerBundle: Promise<Uint8Array> | undefined;
/** Bundle the installed, built guest package. Playwright resolves in the isolated
 * provider image; compiling this program never imports or launches Chromium. */
export async function browserRuntimeInputFiles(config: Record<string, unknown>): Promise<StagedInputFile[]> {
  runnerBundle ??= (async () => {
    const entry = createRequire(import.meta.url).resolve("@armyofagents/browser-runtime/runner");
    const result = await build({ entryPoints: [entry], bundle: true, platform: "node", target: "node22", format: "cjs",
      external: ["playwright"], write: false, logLevel: "silent" });
    if (result.outputFiles.length !== 1 || result.outputFiles[0].contents.length > 1024 * 1024) throw new Error("invalid browser runtime bundle");
    return result.outputFiles[0].contents;
  })();
  const bytes = await runnerBundle;
  return [
    { path: BROWSER_RUNNER_PATH, bytes, contentType: "application/javascript" },
    { path: BROWSER_CONFIG_PATH, bytes: Buffer.from(JSON.stringify(config)), contentType: "application/json" },
    { path: `${BROWSER_RUNTIME_ROOT}/package.json`, bytes: Buffer.from('{"type":"commonjs"}'), contentType: "application/json" },
  ];
}

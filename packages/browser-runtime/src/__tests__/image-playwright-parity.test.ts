// -----------------------------------------------------------------------------
// BRW-003b — the SANDBOX IMAGE's Playwright pin must match what this repo resolves.
//
// The lifecycle facts this package depends on are version-specific:
//   * `tracing.flush()` is abort()+sync with NO ZIP, so an unstopped trace is discarded
//   * `Artifact.saveAs` drains only via `reportFinished()`, which for video runs DURING close
//
// Those were verified against playwright-core 1.59.1, which the lockfile pins and CI installs
// with --frozen-lockfile. The E2B image pins its own copy SEPARATELY, because the runner is
// staged rather than installed and resolves Playwright from the image's global modules.
//
// TWO PINS, ONE INVARIANT. If they drift, the code is built against one set of lifecycle
// semantics and RUN against another — and the failure mode is not a crash, it is a silently
// discarded trace or a hung session. Nothing else in this repo compares them.
// -----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const dockerfile = readFileSync(
  fileURLToPath(new URL("../../../../e2b/e2b.Dockerfile", import.meta.url)),
  "utf8",
);

/** The version the image installs globally, read from the Dockerfile itself. */
function imagePin(): string | null {
  const m = /playwright@(\d+\.\d+\.\d+)/.exec(dockerfile);
  return m === null ? null : m[1];
}

function expectImagePinToMatchRuntime(pin: string | null, runtimeVersion: string): void {
  expect(pin).toBe(runtimeVersion);
}

describe("BRW-003b — image Playwright pin vs resolved Playwright", () => {
  it("the Dockerfile pins an exact Playwright version", () => {
    // A range here would reintroduce the drift this test exists to prevent.
    expect(imagePin()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("that pin equals the version this repo actually resolves", () => {
    const workspaceRequire = createRequire(import.meta.url);
    // Resolve Playwright from this package's declared dependency, then resolve its
    // playwright-core from that package's real require context. This remains correct
    // under pnpm's isolated linker and cannot accidentally read a root hoist.
    const playwrightRequire = createRequire(workspaceRequire.resolve("playwright"));
    const resolved = (playwrightRequire("playwright-core/package.json") as { version: string }).version;
    expectImagePinToMatchRuntime(imagePin(), resolved);
  });

  it("rejects a deliberate image/runtime version mismatch", () => {
    expect(() => expectImagePinToMatchRuntime("1.59.0", "1.59.1")).toThrow();
  });

  it("the image installs a browser, not just the module", () => {
    // `npm install -g playwright` alone gives you the module and NO browser. The image must
    // also run `playwright install ... chromium`, or every session fails at launch with a
    // missing executable — which is exactly the state this ticket found the image in.
    expect(dockerfile).toMatch(/playwright@[\d.]+ install .*chromium/);
  });

  it("the image ASSERTS chromium at build time, the way it already does for the CLIs", () => {
    // The gap went unnoticed because the build guard covered `claude`/`codex` and nothing
    // else. A build that cannot find a browser must fail loudly here, not at first use.
    expect(dockerfile).toMatch(/executablePath\(\)/);
    expect(dockerfile).toMatch(/accessSync/);
  });
});

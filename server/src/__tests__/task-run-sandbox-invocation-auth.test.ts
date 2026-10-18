import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import { buildSandboxInvocation } from "../services/task-run-sandbox-invocation.js";

const SH = process.platform === "win32" ? "C:/Program Files/Git/usr/bin/sh.exe" : "sh";
const TEST_KEY = "governed-test-openai-key";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function shellPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function fixture(instructions: string | null, options?: { key?: string | null; loginExit?: number; execExit?: number }) {
  const root = mkdtempSync(join(tmpdir(), "aoa-codex-auth-"));
  roots.push(root);
  const home = join(root, "home");
  const output = join(root, "aoa-output");
  mkdirSync(home);
  mkdirSync(output);
  writeFileSync(join(output, "keep.txt"), "keep");
  const trace = shellPath(join(root, "trace"));
  const binary = shellPath(join(root, "fake-codex.sh"));
  writeFileSync(binary, `#!/bin/sh
printf '%s\n' "$1" >> "$FAKE_TRACE.calls"
case "$1" in
  login)
    [ "$2" = "--with-api-key" ] || exit 91
    IFS= read -r key || exit 92
    [ "$key" = "${TEST_KEY}" ] || exit 93
    [ -d "$CODEX_HOME" ] || exit 94
    printf '%s' "$CODEX_HOME" > "$FAKE_TRACE.home"
    if [ "${"${FAKE_LOGIN_EXIT:-0}"}" -ne 0 ]; then
      printf '%s\n' "$key" >&2
      printf '%s\n' "$key"
      exit "$FAKE_LOGIN_EXIT"
    fi
    printf 'authorized' > "$CODEX_HOME/auth.json"
    ;;
  exec)
    [ -f "$CODEX_HOME/auth.json" ] || exit 95
    [ -z "${"${OPENAI_API_KEY:-}"}" ] || exit 96
    cat > "$FAKE_TRACE.input"
    exit "${"${FAKE_EXEC_EXIT:-0}"}"
    ;;
  *) exit 97 ;;
esac
`);
  chmodSync(binary, 0o755);

  const inv = buildSandboxInvocation({
    adapterType: "codex_local",
    binary,
    prompt: "perform the governed task",
    instructions,
  })!;
  const staged = inv.stagedFiles.map((file, index) => {
    const path = shellPath(join(root, `staged-${index}.md`));
    writeFileSync(path, file.bytes);
    return path;
  });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: shellPath(home),
    FAKE_TRACE: trace,
    FAKE_LOGIN_EXIT: String(options?.loginExit ?? 0),
    FAKE_EXEC_EXIT: String(options?.execExit ?? 0),
  };
  if (options?.key === null) delete env.OPENAI_API_KEY;
  else env.OPENAI_API_KEY = options?.key ?? TEST_KEY;
  const result = spawnSync(SH, ["-c", inv.args[1], binary, ...staged], {
    env,
    encoding: "utf8",
    timeout: 5_000,
  });
  return {
    inv,
    result,
    root,
    home,
    output,
    calls: () => (existsSync(`${trace}.calls`) ? readFileSync(`${trace}.calls`, "utf8").trim().split("\n") : []),
    authHome: () => readFileSync(`${trace}.home`, "utf8"),
    authHomeOnHost: () => join(home, basename(readFileSync(`${trace}.home`, "utf8"))),
    input: () => readFileSync(`${trace}.input`, "utf8"),
  };
}

describe("distributed Codex sandbox authentication", () => {
  it.each([null, "standing instructions"])("logs in through stdin before exec with instructions=%s", (instructions) => {
    const run = fixture(instructions);
    expect(run.result.error).toBeUndefined();
    expect(run.result.status).toBe(0);
    expect(run.calls()).toEqual(["login", "exec"]);
    expect(run.input()).toBe(instructions === null
      ? "perform the governed task"
      : "standing instructions\nperform the governed task");
    expect(run.authHome()).toMatch(/\.aoa-codex-/);
    expect(run.authHome()).toContain(basename(run.root));
    expect(run.authHome()).toMatch(/\/home\/\.aoa-codex-/);
    expect(run.authHome()).not.toContain("/aoa-output/");
    expect(existsSync(run.authHomeOnHost())).toBe(false);
    expect(readFileSync(join(run.output, "keep.txt"), "utf8")).toBe("keep");
    expect(JSON.stringify(run.inv)).not.toContain(TEST_KEY);
    expect(run.result.stdout + run.result.stderr).not.toContain(TEST_KEY);
  });

  it("refuses a missing governed key before invoking Codex", () => {
    const run = fixture(null, { key: null });
    expect(run.result.status).not.toBe(0);
    expect(run.calls()).toEqual([]);
    expect(readFileSync(join(run.output, "keep.txt"), "utf8")).toBe("keep");
  });

  it("refuses failed login without leaking its output or starting exec", () => {
    const run = fixture(null, { loginExit: 41 });
    expect(run.result.status).not.toBe(0);
    expect(run.calls()).toEqual(["login"]);
    expect(run.result.stdout + run.result.stderr).not.toContain(TEST_KEY);
    expect(existsSync(run.authHomeOnHost())).toBe(false);
  });

  it("preserves Codex exec failure and removes the private home", () => {
    const run = fixture(null, { execExit: 42 });
    expect(run.result.status).toBe(42);
    expect(run.calls()).toEqual(["login", "exec"]);
    expect(existsSync(run.authHomeOnHost())).toBe(false);
  });
});

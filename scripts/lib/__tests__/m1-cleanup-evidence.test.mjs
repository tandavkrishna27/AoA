import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { observeComposeCleanup } from "../m1-cleanup-evidence.mjs";

// Run the real phase entry point, replacing only Docker at the process boundary.
function runPhase({ downStatus = 0, downThrows = false, kind = null, listStatus = 0, remaining = "", phase = "teardown", scan = null } = {}) {
  const out = mkdtempSync(path.join(os.tmpdir(), "m1-cleanup-"));
  const envFile = path.join(out, "compose.env");
  const secret = "cleanup-disposable-secret-123456";
  mkdirSync(path.join(out, "keys"));
  writeFileSync(path.join(out, "keys", "key"), secret);
  writeFileSync(envFile, secret);
  writeFileSync(path.join(out, "state.json"), JSON.stringify({
    out, envFile, candidate: "a".repeat(40), mode: "keyless", redact: [secret], secrets: { fixture: secret },
  }));
  const callsPath = path.join(out, "calls.jsonl");
  const preload = `
    import cp from 'node:child_process';
    import { appendFileSync } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    cp.spawnSync = (command, args) => {
      if (command !== 'docker') throw new Error('unexpected command');
      appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');
      if (args.includes('down')) {
        if (${downThrows}) throw new Error(${JSON.stringify(secret)});
        return { status: ${JSON.stringify(downStatus)}, stdout: ${JSON.stringify(secret)}, stderr: '' };
      }
      const selected = args[0] === ${JSON.stringify(kind)};
      return { status: selected ? ${JSON.stringify(listStatus)} : 0, stdout: selected ? ${JSON.stringify(remaining)} : '', stderr: '' };
    };
    syncBuiltinESMExports();
  `;
  try {
    const result = spawnSync(process.execPath, [
      "--import", `data:text/javascript,${encodeURIComponent(preload)}`,
      "scripts/m1-shipped-boot/journey.mjs", phase, "--out", out,
    ], { encoding: "utf8", env: { ...process.env, AOA_M1_SECRET_OWNER: "" }, timeout: 15_000 });
    const reportPath = path.join(out, "evidence", "compose-cleanup.json");
    const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : null;
    let scanResult = null;
    if (scan) {
      writeFileSync(path.join(out, "job-log.txt"), scan === "log-leak" ? secret : "clean captured teardown\n");
      if (scan === "report-leak") writeFileSync(reportPath, JSON.stringify({ ...report, late: secret }));
      scanResult = spawnSync(process.execPath, ["scripts/m1-shipped-boot/journey.mjs", "leak-scan", "--out", out], {
        encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true" }, timeout: 15_000,
      });
    }
    return {
      ...result,
      report, scanResult,
      evidenceRetained: existsSync(reportPath),
      calls: existsSync(callsPath) ? readFileSync(callsPath, "utf8").trim().split("\n").map(JSON.parse) : [],
      stateRetained: existsSync(path.join(out, "state.json")),
      envRetained: existsSync(envFile), keysRetained: existsSync(path.join(out, "keys")), secret,
    };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

test("teardown retains a candidate-bound Compose-only result and scanner state", () => {
  const result = runPhase();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report?.pass, true);
  assert.equal(result.report.candidate, "a".repeat(40));
  assert.equal(result.report.scope, "compose-project-only");
  assert.equal(result.report.project, "aoa-m1-boot");
  assert.equal(result.report.providerCleanup, "not-assessed");
  assert.equal(result.stateRetained, true);
  assert.equal(result.envRetained, true);
  assert.equal(result.keysRetained, true);
  assert.equal(JSON.stringify(result.report).includes(result.secret), false);
  assert.equal(result.stdout.includes(result.secret), false);
  assert.equal(result.stderr.includes(result.secret), false);
  for (const kind of ["container", "network", "volume"]) {
    const query = result.calls.find((args) => args[0] === kind);
    assert.ok(query, kind);
    assert.ok(query.includes("label=com.docker.compose.project=aoa-m1-boot"));
    if (kind === "container") assert.ok(query.includes("--all"));
  }
});

for (const downStatus of [1, null]) {
  test(`teardown refuses down status ${downStatus} even when the final inventory is empty`, () => {
    const result = runPhase({ downStatus });
    assert.notEqual(result.status, 0);
    assert.equal(result.report?.pass, false);
    assert.equal(result.report.down.status, downStatus);
    assert.equal(result.stateRetained, true);
    assert.doesNotMatch(result.stdout, /stack removed/);
    assert.equal(result.calls.filter((args) => args.includes("ls")).length, 3);
  });
}

test("a thrown down error still observes all resource kinds without publishing the error value", () => {
  const result = runPhase({ downThrows: true });
  assert.notEqual(result.status, 0);
  assert.equal(result.report?.pass, false);
  assert.equal(result.calls.filter((args) => args.includes("ls")).length, 3);
  assert.equal(result.stderr.includes(result.secret), false);
  assert.equal(result.stateRetained, true);
});

for (const kind of ["container", "network", "volume"]) {
  test(`teardown refuses a remaining owned ${kind}`, () => {
    const result = runPhase({ kind, remaining: "still-present\n" });
    assert.notEqual(result.status, 0);
    assert.equal(result.report?.pass, false);
    assert.deepEqual(result.report.observations[kind].remaining, ["still-present"]);
  });
  for (const listStatus of [1, null]) {
    test(`empty ${kind} output with status ${listStatus} is unknown, not proof of absence`, () => {
      const result = runPhase({ kind, listStatus });
      assert.notEqual(result.status, 0);
      assert.equal(result.report?.pass, false);
      assert.equal(result.report.observations[kind].status, listStatus);
    });
  }
}

test("purge-secrets is separate from teardown and never operates Docker", () => {
  const result = runPhase({ phase: "purge-secrets" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stateRetained, false);
  assert.equal(result.envRetained, false);
  assert.equal(result.keysRetained, false);
  assert.deepEqual(result.calls, []);
});

for (const scan of ["report-leak", "log-leak"]) {
  test(`the post-teardown scanner still rejects a late ${scan}`, () => {
    const result = runPhase({ scan });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.scanResult.status, 1);
    assert.match(result.scanResult.stderr, /contains job secret 'fixture'/);
    assert.equal(result.scanResult.stderr.includes(result.secret), false);
    assert.equal(result.evidenceRetained, false);
  });
}

test("a failed cleanup with complete safe evidence can still pass the upload leak scan", () => {
  const result = runPhase({ downStatus: 1, scan: "clean" });
  assert.equal(result.status, 1);
  assert.equal(result.report.pass, false);
  assert.equal(result.scanResult.status, 0, result.scanResult.stderr);
  assert.equal(result.evidenceRetained, true);
});

for (const bad of [
  { status: 0, stdout: null },
  { status: 0, stdout: "", error: new Error("private diagnostic") },
  { status: 0, stdout: "", signal: "SIGTERM" },
  null,
]) {
  test(`inventory must be complete, not merely empty: ${JSON.stringify(bad)}`, () => {
    const kinds = [];
    const report = observeComposeCleanup({
      candidate: "a".repeat(40), project: "aoa-m1-boot", down: () => ({ status: 0 }),
      inspect: (kind) => { kinds.push(kind); return kind === "container" ? bad : { status: 0, stdout: "" }; },
    });
    assert.equal(report.pass, false);
    assert.ok(report.violations.includes("container_inventory_unknown"));
    assert.deepEqual(kinds, ["container", "network", "volume"]);
    assert.equal(JSON.stringify(report).includes("private diagnostic"), false);
  });
}

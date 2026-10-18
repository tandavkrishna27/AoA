import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const { spawn, query } = vi.hoisted(() => ({ spawn: vi.fn(), query: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("postgres", () => ({ default: () => Object.assign(
  query, { end: async () => undefined, unsafe: () => [] },
) }));
import { runDatabaseBackup } from "../backup-lib.js";

let directory: string | undefined;
function mockNativeBackupCatalog(relations: Array<{ schema_name: string; relation_name: string }> = []): void {
  query.mockImplementation(async (strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    if (text.includes("pg_export_snapshot")) return [{ snapshot: "00000003-00000002-1" }];
    if (text.includes("acldefault('r', relation.relowner)")) return relations;
    return [{ value: 1 }];
  });
}

afterEach(async () => {
  if (directory && path.dirname(directory) === path.resolve(tmpdir())) await rm(directory, { recursive: true, force: true });
  spawn.mockReset();
  query.mockReset();
  vi.unstubAllEnvs();
});

it.each(["mjs", "cjs"])("launches a configured %s PostgreSQL wrapper through Node without a shell", async (extension) => {
  vi.stubEnv("AOA_PG_DUMP_PATH", path.join(tmpdir(), `native wrapper.${extension}`));
  mockNativeBackupCatalog();
  directory = await mkdtemp(path.join(tmpdir(), "aoa-native-backup-contract-"));
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: Readable.from(["-- native SQL fixture\n"]), stderr: new PassThrough(),
    });
    setTimeout(() => child.emit("exit", 0, null), 5);
    return child;
  });
  await runDatabaseBackup({ connectionString: "postgres://fixture.invalid/db", backupDir: directory, backupEngine: "pg_dump" });
  expect(spawn.mock.calls[0]![0]).toBe(process.execPath);
  expect(spawn.mock.calls[0]![1][0]).toBe(process.env.AOA_PG_DUMP_PATH);
  expect(spawn.mock.calls[0]![2].shell).not.toBe(true);
});

it("keeps native schema grants so recovered application roles retain access", async () => {
  mockNativeBackupCatalog();
  directory = await mkdtemp(path.join(tmpdir(), "aoa-native-backup-contract-"));
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: Readable.from(["-- native SQL fixture\n"]), stderr: new PassThrough(),
    });
    setTimeout(() => child.emit("exit", 0, null), 5);
    return child;
  });
  await runDatabaseBackup({ connectionString: "postgres://fixture.invalid/db", backupDir: directory, backupEngine: "pg_dump" });
  const args = spawn.mock.calls[0]![1] as string[];
  expect(args).toContain("--clean");
  expect(args).not.toContain("--no-privileges");
  expect(args).not.toContain("--no-acl");
});

it("exports the catalog snapshot and appends owner ACL repair to the one-file native backup", async () => {
  vi.stubEnv("AOA_PG_DUMP_PATH", "native-wrapper.mjs");
  const unusualRelationName = "owner's\\table$aoa_restore_explicit_owner_acl$";
  mockNativeBackupCatalog([{ schema_name: "public", relation_name: unusualRelationName }]);
  directory = await mkdtemp(path.join(tmpdir(), "aoa-native-backup-contract-"));
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: Readable.from(["-- native SQL fixture\n"]), stderr: new PassThrough(),
    });
    setTimeout(() => child.emit("exit", 0, null), 5);
    return child;
  });

  const result = await runDatabaseBackup({
    connectionString: "postgres://fixture.invalid/db", backupDir: directory, backupEngine: "pg_dump",
  });
  const args = spawn.mock.calls[0]![1] as string[];
  expect(args).toContain("--snapshot=00000003-00000002-1");
  const backupSql = gunzipSync(await readFile(result.backupFile)).toString("utf8");
  expect(backupSql).toContain("DO $aoa_restore_explicit_owner_acl$");
  expect(backupSql).toContain(`(convert_from(decode('${Buffer.from("public").toString("base64")}', 'base64'), 'UTF8'), ` +
    `convert_from(decode('${Buffer.from(unusualRelationName).toString("base64")}', 'base64'), 'UTF8'))`);
  expect(backupSql).not.toContain(unusualRelationName);
  expect(backupSql).toContain("GRANT ALL PRIVILEGES ON TABLE %I.%I TO %I");
  expect(backupSql).toContain("native restore is missing a source explicit-owner-ACL relation");
});

it("refuses automatic fallback when native backup fails and security objects would be omitted", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "aoa-native-backup-contract-"));
  query.mockImplementation(async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("pg_policy")) return [{ unsupported: true }];
    if (text.includes("pg_export_snapshot")) return [{ snapshot: "00000003-00000002-1" }];
    if (text.includes("acldefault('r', relation.relowner)")) return [];
    return [];
  });
  spawn.mockImplementation(() => {
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdout, stderr: new PassThrough(),
      kill: vi.fn(() => { stdout.destroy(); return true; }),
    });
    setTimeout(() => child.emit("error", Object.assign(new Error("native tool unavailable"), { code: "ENOENT" })), 5);
    return child;
  });
  await expect(runDatabaseBackup({ connectionString: "postgres://fixture.invalid/db", backupDir: directory }))
    .rejects.toThrow(/native PostgreSQL backup.*security objects/i);
  const { readdir } = await import("node:fs/promises");
  expect(spawn).toHaveBeenCalledOnce();
  expect(spawn.mock.calls[0]![1]).toContain("--snapshot=00000003-00000002-1");
  expect(await readdir(directory)).toEqual([]);
});

it("kills pg_dump and waits for its exit before releasing the exported snapshot after an output failure", async () => {
  const events: string[] = [];
  mockNativeBackupCatalog();
  directory = await mkdtemp(path.join(tmpdir(), "aoa-native-backup-contract-"));
  query.mockImplementation(async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("pg_export_snapshot")) return [{ snapshot: "00000003-00000002-1" }];
    if (text.includes("acldefault('r', relation.relowner)")) return [];
    if (text.includes("ROLLBACK")) events.push("rollback");
    return [{ value: 1 }];
  });
  let child!: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
  spawn.mockImplementation(() => {
    child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => {
        setTimeout(() => {
          events.push("exit");
          child.emit("exit", null, "SIGTERM");
        }, 5);
        return true;
      }),
    });
    setTimeout(() => child.stdout.emit("error", new Error("fixture output pipe failed")), 5);
    return child;
  });

  await expect(runDatabaseBackup({
    connectionString: "postgres://fixture.invalid/db", backupDir: directory, backupEngine: "pg_dump",
  })).rejects.toThrow(/fixture output pipe failed/);

  expect(child.kill).toHaveBeenCalledOnce();
  expect(events).toEqual(["exit", "rollback"]);
  const { readdir } = await import("node:fs/promises");
  expect(await readdir(directory)).toEqual([]);
});

it("retains automatic fallback for a plain schema without security objects", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "aoa-native-backup-contract-"));
  query.mockImplementation(async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("pg_policy")) return [{ unsupported: false }];
    if (text.includes("pg_export_snapshot")) return [{ snapshot: "00000003-00000002-1" }];
    if (text.includes("acldefault('r', relation.relowner)")) return [];
    return [];
  });
  spawn.mockImplementation(() => {
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      stdout, stderr: new PassThrough(),
      kill: vi.fn(() => { stdout.destroy(); return true; }),
    });
    setTimeout(() => child.emit("error", Object.assign(new Error("native tool unavailable"), { code: "ENOENT" })), 5);
    return child;
  });
  const result = await runDatabaseBackup({ connectionString: "postgres://fixture.invalid/db", backupDir: directory });
  expect(result.sizeBytes).toBeGreaterThan(0);
  expect(spawn).toHaveBeenCalledOnce();
  expect(spawn.mock.calls[0]![1]).toContain("--snapshot=00000003-00000002-1");
});

it("preserves explicit JavaScript portability exports without pretending they are native recovery backups", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "aoa-native-backup-contract-"));
  query.mockResolvedValue([]);
  const result = await runDatabaseBackup({ connectionString: "postgres://fixture.invalid/db", backupDir: directory, backupEngine: "javascript" });
  expect(result.sizeBytes).toBeGreaterThan(0);
  expect(spawn).not.toHaveBeenCalled();
  expect(query.mock.calls.some(([strings]) => strings.join("?").includes("pg_policy"))).toBe(false);
});

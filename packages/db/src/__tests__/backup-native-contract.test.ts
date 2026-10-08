import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const { spawn, query } = vi.hoisted(() => ({ spawn: vi.fn(), query: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("postgres", () => ({ default: () => Object.assign(
  query, { end: async () => undefined, unsafe: () => [] },
) }));
import { runDatabaseBackup } from "../backup-lib.js";

let directory: string | undefined;
afterEach(async () => {
  if (directory && path.dirname(directory) === path.resolve(tmpdir())) await rm(directory, { recursive: true, force: true });
  spawn.mockReset();
  query.mockReset();
});

it("keeps native schema grants so recovered application roles retain access", async () => {
  query.mockResolvedValue([{ value: 1 }]);
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

it("refuses automatic fallback when native backup fails and security objects would be omitted", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "aoa-native-backup-contract-"));
  query.mockImplementation(async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("pg_policy")) return [{ unsupported: true }];
    return [];
  });
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(),
    });
    setTimeout(() => child.emit("error", Object.assign(new Error("native tool unavailable"), { code: "ENOENT" })), 5);
    return child;
  });
  await expect(runDatabaseBackup({ connectionString: "postgres://fixture.invalid/db", backupDir: directory }))
    .rejects.toThrow(/native PostgreSQL backup.*security objects/i);
  const { readdir } = await import("node:fs/promises");
  expect(await readdir(directory)).toEqual([]);
});

it("retains automatic fallback for a plain schema without security objects", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "aoa-native-backup-contract-"));
  query.mockImplementation(async (strings: TemplateStringsArray) =>
    strings.join("?").includes("pg_policy") ? [{ unsupported: false }] : []);
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(),
    });
    setTimeout(() => child.emit("error", Object.assign(new Error("native tool unavailable"), { code: "ENOENT" })), 5);
    return child;
  });
  const result = await runDatabaseBackup({ connectionString: "postgres://fixture.invalid/db", backupDir: directory });
  expect(result.sizeBytes).toBeGreaterThan(0);
});

it("preserves explicit JavaScript portability exports without pretending they are native recovery backups", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "aoa-native-backup-contract-"));
  query.mockResolvedValue([]);
  const result = await runDatabaseBackup({ connectionString: "postgres://fixture.invalid/db", backupDir: directory, backupEngine: "javascript" });
  expect(result.sizeBytes).toBeGreaterThan(0);
  expect(spawn).not.toHaveBeenCalled();
  expect(query.mock.calls.some(([strings]) => strings.join("?").includes("pg_policy"))).toBe(false);
});

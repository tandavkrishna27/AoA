import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("postgres", () => ({ default: () => Object.assign(
  async () => [{ value: 1 }], { end: async () => undefined },
) }));
import { runDatabaseBackup } from "../backup-lib.js";

let directory: string | undefined;
afterEach(async () => {
  if (directory && path.dirname(directory) === path.resolve(tmpdir())) await rm(directory, { recursive: true, force: true });
  spawn.mockReset();
});

it("keeps native schema grants so recovered application roles retain access", async () => {
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

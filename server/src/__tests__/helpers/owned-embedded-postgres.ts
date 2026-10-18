import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

export type OwnedEmbeddedPostgres = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

/** Keep directory deletion with the caller. The Windows dependency force-kills
 * only the postmaster; PG18 I/O workers can still hold the cluster files open. */
export async function createOwnedEmbeddedPostgres(databaseDir: string, port: number): Promise<OwnedEmbeddedPostgres> {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const embedded = new EmbeddedPostgres({
    databaseDir, user: "test", password: "test", port, persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  if (platform() !== "win32") return embedded;

  const pidFile = join(databaseDir, "postmaster.pid");
  let startAttempted = false;
  let identity: string | undefined;
  const readIdentity = async () => {
    const lines = (await readFile(pidFile, "utf8")).split(/\r?\n/);
    const pid = Number(lines[0]);
    const started = Number(lines[2]);
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(started) || started <= 0
      || !lines[1] || resolve(lines[1]).toLowerCase() !== resolve(databaseDir).toLowerCase()
      || Number(lines[3]) !== port) {
      throw new Error(`Invalid migrated fixture ownership receipt: ${pidFile}`);
    }
    return JSON.stringify([pid, resolve(lines[1]).toLowerCase(), started, port]);
  };
  const start = embedded.start.bind(embedded);
  embedded.start = async () => {
    startAttempted = true;
    await start();
    identity = await readIdentity();
  };
  let stopping: Promise<void> | undefined;
  embedded.stop = () => stopping ??= (async () => {
    if (!startAttempted) return;
    if (!identity || await readIdentity() !== identity) {
      throw new Error(`Migrated fixture ownership changed; refusing shutdown: ${pidFile}`);
    }
    const fixtureRequire = createRequire(import.meta.url);
    const nativeRequire = createRequire(fixtureRequire.resolve("embedded-postgres"));
    const entry = nativeRequire.resolve("@embedded-postgres/windows-x64");
    const controller = resolve(dirname(entry), "..", "native", "bin", "pg_ctl.exe");
    await promisify(execFile)(controller, ["stop", "-D", databaseDir, "-m", "fast", "-w", "-t", "15"], {
      windowsHide: true, timeout: 20_000, maxBuffer: 64 * 1024,
    });
    try {
      await readFile(pidFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    throw new Error(`Migrated fixture PID file remains after shutdown: ${pidFile}`);
  })();
  return embedded;
}

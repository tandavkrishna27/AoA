import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { join, isAbsolute } from "node:path";

export interface SlotOwnership {
  release(): Promise<void>;
  readonly lost: Promise<Error>;
}

export async function acquireSlotOwnership(
  paths: readonly string[], options: { executable?: string } = {},
): Promise<SlotOwnership> {
  if (!paths.length || paths.some(path => !isAbsolute(path))) throw new Error("slot ownership requires absolute directory paths");
  if (process.platform !== "linux") throw new Error("slot ownership requires Linux local storage");
  const directories = [...new Set(await Promise.all(paths.map(path => realpath(path))))].sort();
  const holders: ChildProcessWithoutNullStreams[] = [];
  let releasing = false;
  let failure: Error | undefined;
  let reportLoss!: (error: Error) => void;
  const lost = new Promise<Error>(resolve => { reportLoss = resolve; });
  const lose = () => {
    if (releasing || failure) return;
    failure = new Error("slot ownership holder exited; refusing continued execution");
    reportLoss(failure);
    for (const holder of holders) holder.stdin.destroy();
  };
  const release = async () => {
    releasing = true;
    await Promise.all(holders.map(holder => new Promise<void>(resolve => {
      if (holder.exitCode !== null || holder.signalCode !== null) { resolve(); return; }
      const timeout = setTimeout(() => { holder.kill("SIGKILL"); }, 1000);
      holder.once("close", () => { clearTimeout(timeout); resolve(); });
      holder.stdin.end();
    })));
  };
  try {
    for (const directory of directories) {
      const directoryBefore = await stat(directory);
      if (!directoryBefore.isDirectory()) throw new Error("slot ownership path is not a directory");
      const lockPath = join(directory, ".aoa-slot.lock");
      // Never unlink lock files: a new inode could admit two live owners.
      const file = await open(lockPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
      const before = await file.stat(); await file.close();
      if (!before.isFile() || before.nlink !== 1) throw new Error("slot ownership lock must be a regular unlinked-alias-free file");
      const holder = spawn(options.executable ?? "/usr/bin/flock", [
        "--nonblock", "--conflict-exit-code", "73", "--no-fork", lockPath,
        "/bin/sh", "-c", "printf 'AOA_LOCK_READY\\n'; exec cat >/dev/null",
      ], { stdio: "pipe" });
      holders.push(holder);
      holder.stdin.on("error", () => { /* close/error handlers own failure */ });
      holder.stderr.resume();
      await new Promise<void>((resolve, reject) => {
        let ready = false;
        let output = "";
        const timeout = setTimeout(() => {
          holder.kill("SIGKILL"); reject(new Error("slot ownership holder readiness timeout"));
        }, 3000);
        holder.once("error", () => { clearTimeout(timeout); reject(new Error("slot ownership holder unavailable")); });
        holder.once("close", code => {
          clearTimeout(timeout);
          if (!ready) reject(new Error(code === 73 ? "slot directory already owned" : "slot ownership holder failed"));
          else lose();
        });
        holder.stdout.on("data", (chunk: Buffer) => {
          if (ready) return;
          output += chunk.toString("utf8");
          if (output === "AOA_LOCK_READY\n") { ready = true; clearTimeout(timeout); resolve(); }
          else if (output.length > 128) { clearTimeout(timeout); holder.kill("SIGKILL"); reject(new Error("invalid slot ownership holder response")); }
        });
      });
      const after = await lstat(lockPath);
      const directoryAfter = await stat(directory);
      if (after.isSymbolicLink() || after.ino !== before.ino || after.dev !== before.dev || after.nlink !== 1
        || directoryAfter.ino !== directoryBefore.ino || directoryAfter.dev !== directoryBefore.dev) {
        throw new Error("slot ownership storage changed during acquisition");
      }
      if (failure) throw failure;
    }
    return { release, lost };
  } catch (error) {
    await release(); throw error;
  }
}

import { isE2bFileNotFound } from "./real-transport-helpers.js";

/** Check the destination and every ancestor before importing application state.
 * Runs before any tenant command starts; SDK write has no no-follow option. */
export async function assertCheckpointDestination(path: string, getInfo: (path: string) => Promise<unknown>) {
  if (!path.startsWith("/tmp/aoa-service-state/")) return;
  const segments = path.split("/").slice(1);
  if (segments.some((part) => !part || part === "." || part === ".." || /[\\\0]/.test(part))) {
    throw new Error("checkpoint destination rejected");
  }
  for (let i = 1; i <= segments.length; i += 1) {
    const prefix = `/${segments.slice(0, i).join("/")}`;
    let info: unknown;
    try { info = await getInfo(prefix); } catch (error) {
      if (isE2bFileNotFound(error)) continue;
      throw error;
    }
    if (!info || typeof info !== "object") throw new Error("checkpoint destination unreadable");
    const entry = info as { symlinkTarget?: unknown; type?: unknown };
    if (typeof entry.symlinkTarget === "string" && entry.symlinkTarget.length > 0) {
      throw new Error("checkpoint destination symlink rejected");
    }
    if (i < segments.length && entry.type !== "dir" && entry.type !== "directory") {
      throw new Error("checkpoint ancestor is not a directory");
    }
    if (i === segments.length && entry.type !== "file") throw new Error("checkpoint destination is not a regular file");
  }
}

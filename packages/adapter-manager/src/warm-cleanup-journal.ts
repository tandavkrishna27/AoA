import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { labelsEqual, ownerOnlyViolation, type ResourceLabels } from "@armyofagents/worker-daemon";

type Status = "owned" | "planned" | "confirmed" | "acknowledged";
interface RecordValue { v: 1; resourceId: string; physicalLabels: ResourceLabels; status: Status; providerOpId?: string }
export interface PendingWarmCleanup { resourceId: string; physicalLabels: ResourceLabels;
  status: "planned" | "confirmed"; providerOpId?: string }
const fail = (): never => { throw new Error("warm cleanup journal unavailable"); };
const bounded = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512;
function validLabels(value: unknown): value is ResourceLabels {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as ResourceLabels;
  return Object.keys(v).length === 7 && [v.organizationId, v.targetId, v.workerId, v.jobId, v.leaseId].every(bounded) &&
    Number.isSafeInteger(v.attempt) && v.attempt > 0 && Number.isSafeInteger(v.deviceGeneration) && v.deviceGeneration > 0;
}
/** Immutable stage files survive restart. No credential, capability or environment
 * is stored. Cleanup remains pending until the authenticated control plane ACKs;
 * a successful physical destroy alone never clears conversation ownership. */
export class WarmCleanupJournal {
  #cursor: string | null = null;
  constructor(readonly dir: string) {}
  #path(resourceId: string, status: Status) {
    if (!bounded(resourceId)) fail();
    return join(this.dir, createHash("sha256").update(JSON.stringify([resourceId, status])).digest("hex") + ".json");
  }
  #read(path: string): RecordValue | null {
    let bytes: Buffer;
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) fail();
      bytes = readFileSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      return fail();
    }
    if (bytes.length > 8192 || ownerOnlyViolation(path) !== null) fail();
    try {
      const value = JSON.parse(bytes.toString("utf8")) as RecordValue;
      if (value.v !== 1 || !bounded(value.resourceId) || !validLabels(value.physicalLabels) ||
          !["owned", "planned", "confirmed", "acknowledged"].includes(value.status) ||
          (value.status === "confirmed" ? !bounded(value.providerOpId) : value.providerOpId !== undefined) ||
          Object.keys(value).some((key) => !["v", "resourceId", "physicalLabels", "status", "providerOpId"].includes(key)) ||
          this.#path(value.resourceId, value.status) !== path) fail();
      return value;
    } catch { return fail(); }
  }
  #require(resourceId: string, labels: ResourceLabels, status: Status) {
    if (!validLabels(labels)) fail();
    const value = this.#read(this.#path(resourceId, status));
    if (!value || !labelsEqual(value.physicalLabels, labels)) return fail();
    return value;
  }
  #write(resourceId: string, labels: ResourceLabels, status: Status, providerOpId?: string) {
    if (!validLabels(labels) || (status === "confirmed" && !bounded(providerOpId))) fail();
    const path = this.#path(resourceId, status);
    const value: RecordValue = { v: 1, resourceId, physicalLabels: { ...labels }, status,
      ...(providerOpId === undefined ? {} : { providerOpId }) };
    mkdirSync(this.dir, { recursive: true });
    const temp = path + "." + randomUUID() + ".tmp";
    let fd: number | undefined;
    try {
      fd = openSync(temp, "wx", 0o600); writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); closeSync(fd); fd = undefined;
      try { linkSync(temp, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") fail(); }
      // Windows does not support opening directories; inode data was fsynced above.
      let parent: number | undefined;
      try { parent = openSync(this.dir, "r"); fsyncSync(parent); } catch { /* platform limitation */ }
      finally { if (parent !== undefined) closeSync(parent); }
      const stored = this.#require(resourceId, labels, status);
      // A confirmed retry preserves the first successful provider receipt.
      if (stored.status !== status) fail();
    } catch { fail(); }
    finally { if (fd !== undefined) closeSync(fd); try { unlinkSync(temp); } catch { /* harmless unique temp */ } }
  }
  register(resourceId: string, labels: ResourceLabels): void { this.#write(resourceId, labels, "owned"); }
  isRegistered(resourceId: string, labels: ResourceLabels): boolean {
    const value = this.#read(this.#path(resourceId, "owned"));
    return value !== null && validLabels(labels) && labelsEqual(value.physicalLabels, labels);
  }
  plan(resourceId: string, labels: ResourceLabels): void {
    this.#require(resourceId, labels, "owned"); this.#write(resourceId, labels, "planned");
  }
  confirm(resourceId: string, labels: ResourceLabels, providerOpId: string): void {
    this.#require(resourceId, labels, "planned"); this.#write(resourceId, labels, "confirmed", providerOpId);
  }
  acknowledge(resourceId: string, labels: ResourceLabels): void {
    this.#require(resourceId, labels, "confirmed"); this.#write(resourceId, labels, "acknowledged");
  }
  pending(limit = 128): PendingWarmCleanup[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) fail();
    let files: string[];
    try { files = readdirSync(this.dir); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      return fail();
    }
    const result: PendingWarmCleanup[] = [];
    files.sort();
    const next = this.#cursor === null ? 0 : files.findIndex((file) => file > this.#cursor!);
    const start = next < 0 ? 0 : next;
    const ordered = [...files.slice(start), ...files.slice(0, start)];
    for (const file of ordered) {
      if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
      const value = this.#read(join(this.dir, file));
      if (!value || value.status !== "planned") continue;
      this.#require(value.resourceId, value.physicalLabels, "owned");
      const ack = this.#read(this.#path(value.resourceId, "acknowledged"));
      if (ack) { this.#require(value.resourceId, value.physicalLabels, "acknowledged"); continue; }
      const confirmed = this.#read(this.#path(value.resourceId, "confirmed"));
      if (confirmed) this.#require(value.resourceId, value.physicalLabels, "confirmed");
      result.push({ resourceId: value.resourceId, physicalLabels: value.physicalLabels,
        status: confirmed ? "confirmed" : "planned", ...(confirmed ? { providerOpId: confirmed.providerOpId } : {}) });
      this.#cursor = file;
      if (result.length === limit) break;
    }
    return result;
  }
}

import type { DeviceIdentityRecord, DeviceEnrollmentReceipt } from "./device-identity-store.js";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, readdir, link, rename, unlink, lstat } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
export interface SlotBinding { v: 1; slotId: string; organizationId: string; targetId: string; stateIncarnationId: string; phase: "fresh" | "initializing" | "established"; workerId?: string }
export interface PreparedSlot {
  validateIdentity(identity: DeviceIdentityRecord | null, receipt: DeviceEnrollmentReceipt | null): void;
  establish(identity: DeviceIdentityRecord, receipt: DeviceEnrollmentReceipt): Promise<void>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOT = /^[a-z][a-z0-9-]{0,63}$/;
const BINDING = "slot.json";
const MARKER = "slot-incarnation.json";

async function syncDirectory(directory: string): Promise<void> {
  // Slot boot is Linux-only. Windows unit tests exercise state transitions, not durability.
  if (process.platform === "win32") return;
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeRecord(directory: string, filename: string, value: unknown, exclusive: boolean): Promise<void> {
  const temporary = join(directory, `.slot-write-${randomUUID()}`);
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
  try {
    if (exclusive) await link(temporary, join(directory, filename));
    else await rename(temporary, join(directory, filename));
    await syncDirectory(directory);
  } finally { await unlink(temporary).catch(() => {}); }
}

async function readRecord(path: string): Promise<Record<string, unknown>> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 4096 || info.nlink !== 1) throw new Error("invalid slot record file");
    const value: unknown = JSON.parse(await handle.readFile("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid slot record");
    return value as Record<string, unknown>;
  } catch { throw new Error("slot record missing or invalid"); }
  finally { await handle.close(); }
}

function decodeBinding(value: Record<string, unknown>): SlotBinding {
  const allowed = ["v", "slotId", "organizationId", "targetId", "stateIncarnationId", "phase", "workerId"];
  if (Object.keys(value).some(key => !allowed.includes(key)) || value.v !== 1
    || typeof value.slotId !== "string" || !SLOT.test(value.slotId)
    || [value.organizationId, value.targetId, value.stateIncarnationId].some(id => typeof id !== "string" || !UUID.test(id))
    || !["fresh", "initializing", "established"].includes(String(value.phase))
    || (value.workerId !== undefined && (typeof value.workerId !== "string" || !UUID.test(value.workerId)))
    || (value.phase === "established" ? value.workerId === undefined : value.workerId !== undefined)) {
    throw new Error("invalid slot binding");
  }
  return value as unknown as SlotBinding;
}

export async function provisionSlot(input: { bindingDir: string; slotId: string; organizationId: string; targetId: string }): Promise<SlotBinding> {
  const binding = decodeBinding({ v: 1, slotId: input.slotId, organizationId: input.organizationId,
    targetId: input.targetId, stateIncarnationId: randomUUID(), phase: "fresh" });
  await writeRecord(await realpath(input.bindingDir), BINDING, binding, true);
  return binding;
}

/** Caller owns both directories for this entire transaction and runtime lifetime. */
export async function prepareSlot(input: { bindingDir: string; stateDir: string }): Promise<PreparedSlot> {
  const bindingDir = await realpath(input.bindingDir);
  const stateDir = await realpath(input.stateDir);
  const beneath = (parent: string, child: string) => { const path = relative(parent, child); return !path || (!path.startsWith("..") && !isAbsolute(path)); };
  if (beneath(bindingDir, stateDir) || beneath(stateDir, bindingDir)) throw new Error("slot binding requires independent storage");
  let binding = decodeBinding(await readRecord(join(bindingDir, BINDING)));
  const freshThisBoot = binding.phase === "fresh";
  if (freshThisBoot) {
    const entries = await readdir(stateDir);
    if (entries.some(name => name !== ".aoa-slot.lock" && name !== "tmp")) throw new Error("fresh slot requires empty state; use explicit adoption");
    if (entries.includes("tmp")) {
      const temporary = join(stateDir, "tmp");
      if (!(await lstat(temporary)).isDirectory() || (await readdir(temporary)).length) throw new Error("fresh slot requires empty runtime tmp directory");
    }
    binding = { ...binding, phase: "initializing" };
    await writeRecord(bindingDir, BINDING, binding, false);
    await writeRecord(stateDir, MARKER, { v: 1, stateIncarnationId: binding.stateIncarnationId }, true);
  } else {
    const marker = await readRecord(join(stateDir, MARKER));
    if (Object.keys(marker).sort().join(",") !== "stateIncarnationId,v" || marker.v !== 1
      || marker.stateIncarnationId !== binding.stateIncarnationId) throw new Error("slot state incarnation does not match binding");
  }
  const validateIdentity = (identity: DeviceIdentityRecord | null, receipt: DeviceEnrollmentReceipt | null): void => {
    if (!identity) {
      if (freshThisBoot && binding.phase === "initializing" && !receipt) return;
      throw new Error("slot identity missing; refusing to remint");
    }
    if (identity.targetId !== binding.targetId) throw new Error("slot target does not match identity");
    if (binding.workerId && identity.workerId !== binding.workerId) throw new Error("slot worker does not match binding");
    if (receipt && (receipt.workerId !== identity.workerId || receipt.targetId !== identity.targetId
      || receipt.deviceGeneration !== identity.deviceGeneration)) throw new Error("slot receipt does not match identity");
    if (binding.phase === "established" && !receipt) throw new Error("established slot receipt missing");
  };
  return {
    validateIdentity,
    async establish(identity, receipt) {
      validateIdentity(identity, receipt);
      if (binding.phase === "established") return;
      binding = { ...binding, phase: "established", workerId: identity.workerId };
      await writeRecord(bindingDir, BINDING, binding, false);
    },
  };
}

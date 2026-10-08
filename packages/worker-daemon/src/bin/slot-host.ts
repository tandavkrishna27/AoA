import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative } from "node:path";
import { loadWorkerConfig } from "../config/config.js";
import { acquireSlotOwnership } from "../identity/slot-ownership.js";
import { prepareSlot } from "../identity/slot-binding.js";
import { FileRecordStore } from "../identity/file-record-store.js";
import { identityRecordCodec, receiptRecordCodec } from "../identity/record-codec.js";
import { join } from "node:path";
import type { ProcessLike } from "./worker-daemon.js";
import type { DeviceIdentityRecord, DeviceEnrollmentReceipt } from "../identity/device-identity-store.js";

export const SLOT_BINDING_DIR_ENV = "AOA_WORKER_SLOT_BINDING_DIR";
interface SlotStart {
  proc: ProcessLike;
  validateIdentity(identity: DeviceIdentityRecord | null, receipt: DeviceEnrollmentReceipt | null): void;
  onEnrollmentPersisted(): Promise<void>;
}

/** Wraps the existing host; no provider or enrollment authority is introduced here. */
export async function runSlotHost(input: {
  env: Record<string, string | undefined>; proc: ProcessLike; stateDir: string;
  log(message: string): void;
  start(hooks: SlotStart): Promise<{ ok: boolean }>;
}): Promise<{ ok: boolean }> {
  let ownership: Awaited<ReturnType<typeof acquireSlotOwnership>> | undefined;
  let exiting = false;
  try {
    const bindingDir = input.env[SLOT_BINDING_DIR_ENV]?.trim();
    if (!bindingDir || !isAbsolute(bindingDir) || !isAbsolute(input.stateDir)) throw new Error("invalid slot directories");
    const config = loadWorkerConfig(input.env);
    if (config.keyStoreMode !== "file_record" || config.targetScope !== "organization") throw new Error("slot host requires organization file_record custody");
    const stateDir = await realpath(input.stateDir);
    for (const path of [config.eventOutboxPath, config.leaseCandidatePath]) {
      if (!path || !isAbsolute(path)) throw new Error("slot recovery paths are required");
      const parent = await realpath(dirname(path));
      const rel = relative(stateDir, parent);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("slot recovery path escapes state");
      try {
        if ((await lstat(path)).isSymbolicLink()) throw new Error("slot recovery path is a symlink");
      } catch (err) { if (!(err && typeof err === "object" && "code" in err && err.code === "ENOENT")) throw err; }
    }
    ownership = await acquireSlotOwnership([bindingDir, stateDir]);
    const prepared = await prepareSlot({ bindingDir, stateDir });
    const identityStore = new FileRecordStore({ path: join(stateDir, "identity.json"), codec: identityRecordCodec });
    const receiptStore = new FileRecordStore({ path: join(stateDir, "receipt.json"), codec: receiptRecordCodec });
    prepared.validateIdentity(identityStore.load(), receiptStore.load());
    const owned = ownership;
    void owned.lost.then(() => {
      if (!exiting) { exiting = true; input.log("slot host: ownership lost; terminating"); input.proc.exit(1); }
    });
    const result = await input.start({
      validateIdentity: prepared.validateIdentity,
      proc: {
        once: (event, listener) => input.proc.once(event, listener),
        exit: code => { exiting = true; void owned.release().finally(() => input.proc.exit(code)); },
      },
      onEnrollmentPersisted: async () => {
        const identity = identityStore.load(); const receipt = receiptStore.load();
        if (!identity || !receipt) throw new Error("slot enrollment did not persist identity and receipt");
        await prepared.establish(identity, receipt);
      },
    });
    if (!result.ok) { exiting = true; await owned.release(); }
    // A successful bootstrap returns while polling continues. Keep locks alive until exit.
    return result;
  } catch {
    exiting = true;
    await ownership?.release();
    input.log("slot host: storage, configuration or identity validation failed; refusing startup");
    input.proc.exit(1);
    return { ok: false };
  }
}

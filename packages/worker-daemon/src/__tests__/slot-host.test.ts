import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runContainerHost } from "../bin/container-host.js";
import { provisionSlot } from "../identity/slot-binding.js";
import { bootstrapWorkerDaemon } from "../bin/worker-daemon.js";

let root: string; let state: string; let binding: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "m4-host-")); state = join(root, "state"); binding = join(root, "binding"); await mkdir(state); await mkdir(binding); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const env = () => ({ AOA_WORKER_STATE_DIR: state, AOA_WORKER_SLOT_BINDING_DIR: binding, AOA_WORKER_KEY_STORE_MODE: "file_record",
  AOA_WORKER_TARGET_SCOPE: "organization",
  AOA_WORKER_CONTROL_PLANE_URL: "https://control.example.com", AOA_WORKER_EVENT_OUTBOX_PATH: join(state, "events.db"),
  AOA_WORKER_ENROLLMENT_CODE_ENV: "CODE", CODE: "aoa_enr_"+"A".repeat(22)+"."+"B".repeat(43) });
it("refuses slot configuration before bootstrap when ownership cannot be acquired", async () => {
  const bootstrap = vi.fn(async () => ({ ok: true })); const exit = vi.fn();
  const result = await runContainerHost({ env: env(), proc: { once: () => {}, exit }, bootstrap: bootstrap as never });
  expect(result.ok).toBe(false); expect(bootstrap).not.toHaveBeenCalled(); expect(exit).toHaveBeenCalledWith(1);
});
it("refuses recovery paths outside its durable state before bootstrap", async () => {
  await provisionSlot({ bindingDir: binding, slotId: "desktop-1", organizationId: "a3000000-0000-4000-8000-000000000004", targetId: "a3000000-0000-4000-8000-000000000003" });
  const bootstrap = vi.fn(async () => ({ ok: true }));
  await runContainerHost({ env: { ...env(), AOA_WORKER_EVENT_OUTBOX_PATH: join(root, "outside.db") }, proc: { once: () => {}, exit: () => {} }, bootstrap: bootstrap as never });
  expect(bootstrap).not.toHaveBeenCalled();
});
it("direct daemon invocation cannot ignore configured slot custody", async () => {
  const startHealth = vi.fn(async () => { throw new Error("unguarded listener reached"); }); const exit = vi.fn();
  const identityStore = { load: () => null, saveIfAbsent: () => "stored" as const, clear() {} };
  const result = await bootstrapWorkerDaemon({ env: env(), proc: { once: () => {}, exit }, startHealth, identityStore, receiptStore: identityStore });
  expect(result.ok).toBe(false); expect(startHealth).not.toHaveBeenCalled();
});

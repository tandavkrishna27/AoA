import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { provisionSlot, prepareSlot } from "../identity/slot-binding.js";
import type { DeviceIdentityRecord, DeviceEnrollmentReceipt } from "../identity/device-identity-store.js";

let root: string; let bindingDir: string; let stateDir: string;
const targetId = "a3000000-0000-4000-8000-000000000003";
const organizationId = "a3000000-0000-4000-8000-000000000004";
const identity: DeviceIdentityRecord = { v: 1, workerId: "a3000000-0000-4000-8000-000000000005", targetId, deviceGeneration: 1, privateKeyPkcs8Der: new Uint8Array([1]) };
const receipt: DeviceEnrollmentReceipt = { v: 1, workerId: identity.workerId, targetId, deviceGeneration: 1, deviceThumbprint: "thumb" };
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "m4-binding-")); bindingDir = join(root, "binding"); stateDir = join(root, "state"); await mkdir(bindingDir); await mkdir(stateDir); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const provision = () => provisionSlot({ bindingDir, slotId: "desktop-1", organizationId, targetId });

it("requires explicit provisioning; missing binding cannot become fresh", async () => {
  await expect(prepareSlot({ bindingDir, stateDir })).rejects.toThrow();
});
it("provisions once without overwriting an established deployment", async () => {
  const first = await provision(); expect(first.phase).toBe("fresh");
  await expect(provision()).rejects.toThrow();
  expect(JSON.parse(await readFile(join(bindingDir, "slot.json"), "utf8"))).toEqual(first);
});
it("fresh start transitions before identity creation; initialization crash cannot mint again", async () => {
  await provision(); const prepared = await prepareSlot({ bindingDir, stateDir });
  prepared.validateIdentity(null, null);
  expect(JSON.parse(await readFile(join(bindingDir, "slot.json"), "utf8"))).toMatchObject({ phase: "initializing" });
  const replay = await prepareSlot({ bindingDir, stateDir });
  expect(() => replay.validateIdentity(null, null)).toThrow(/missing/);
  replay.validateIdentity(identity, null);
});
it("establishes from matching persisted identity/receipt and survives restart", async () => {
  await provision(); const prepared = await prepareSlot({ bindingDir, stateDir });
  await prepared.establish(identity, receipt);
  const restarted = await prepareSlot({ bindingDir, stateDir }); restarted.validateIdentity(identity, receipt);
  expect(() => restarted.validateIdentity(null, null)).toThrow(/missing/);
  expect(() => restarted.validateIdentity({ ...identity, workerId: organizationId }, receipt)).toThrow(/match/);
});
it("rejects state incarnation loss even when both records are absent", async () => {
  await provision(); const prepared = await prepareSlot({ bindingDir, stateDir }); await prepared.establish(identity, receipt);
  await unlink(join(stateDir, "slot-incarnation.json"));
  await expect(prepareSlot({ bindingDir, stateDir })).rejects.toThrow();
});
it("rejects corrupt binding, wrong target and receipt without identity", async () => {
  await provision(); const prepared = await prepareSlot({ bindingDir, stateDir });
  expect(() => prepared.validateIdentity({ ...identity, targetId: organizationId }, null)).toThrow(/target/);
  expect(() => prepared.validateIdentity(null, receipt)).toThrow(/missing/);
  await writeFile(join(bindingDir, "slot.json"), '{"bad":true}');
  await expect(prepareSlot({ bindingDir, stateDir })).rejects.toThrow();
});
it("requires independently stored binding and refuses nonempty fresh state", async () => {
  await provision(); await expect(prepareSlot({ bindingDir, stateDir: bindingDir })).rejects.toThrow(/independent/);
  await writeFile(join(stateDir, "identity.json"), "existing");
  await expect(prepareSlot({ bindingDir, stateDir })).rejects.toThrow(/empty/);
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { acquireSlotOwnership } from "../identity/slot-ownership.js";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

it("refuses empty ownership scope", async () => {
  await expect(acquireSlotOwnership([])).rejects.toThrow(/directory/);
});

it("refuses unsupported platforms before starting a holder", async () => {
  if (process.platform === "linux") return;
  const dir = await mkdtemp(join(tmpdir(), "m4-owner-")); dirs.push(dir);
  await expect(acquireSlotOwnership([dir])).rejects.toThrow(/Linux/);
});

it("refuses missing directories rather than creating replacement state", async () => {
  await expect(acquireSlotOwnership([join(tmpdir(), "m4-missing", "state")])).rejects.toThrow();
});

import { describe, expect, it, vi } from "vitest";
import { assertCheckpointDestination } from "../checkpoint-destination.js";
const path = "/tmp/aoa-service-state/service/state.json";
const missing = () => Object.assign(new Error("missing file"), { name: "FileNotFoundError" });
describe("checkpoint destination before filesystem write", () => {
  it("allows missing application-state directories and checks every ancestor", async () => {
    const read = vi.fn(async () => { throw missing(); });
    await assertCheckpointDestination(path, read);
    expect(read).toHaveBeenCalledTimes(4);
  });
  it.each(["/tmp", "/tmp/aoa-service-state/service", path])("rejects symlink at %s", async (linked) => {
    await expect(assertCheckpointDestination(path, async (candidate) => candidate === linked
      ? { type: "file", symlinkTarget: "/secrets" } : { type: "dir" })).rejects.toThrow(/symlink/);
  });
  it("rejects traversal and an unreadable destination", async () => {
    await expect(assertCheckpointDestination("/tmp/aoa-service-state/../state.json", async () => null)).rejects.toThrow(/rejected/);
    await expect(assertCheckpointDestination(path, async () => { throw Object.assign(new Error("gone sandbox"), { name: "SandboxNotFoundError" }); })).rejects.toThrow(/gone sandbox/);
  });
});

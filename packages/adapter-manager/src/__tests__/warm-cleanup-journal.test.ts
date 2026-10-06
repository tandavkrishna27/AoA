import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WarmCleanupJournal } from "../warm-cleanup-journal.js";
const labels = { organizationId: "org", targetId: "target", workerId: "worker", jobId: "job", attempt: 1,
  leaseId: "lease", deviceGeneration: 1 };
function setup() { const dir = mkdtempSync(join(tmpdir(), "aoa-warm-cleanup-")); return { dir, journal: new WarmCleanupJournal(dir) }; }
describe("durable exact-resource cleanup journal", () => {
  it("recovers planned cleanup after restart and retains confirmed work until acknowledged", () => {
    const { dir, journal } = setup();
    journal.register("vm", labels); journal.plan("vm", labels);
    const restarted = new WarmCleanupJournal(dir);
    expect(restarted.pending()).toEqual([{ resourceId: "vm", physicalLabels: labels, status: "planned" }]);
    restarted.confirm("vm", labels, "provider-op");
    expect(new WarmCleanupJournal(dir).pending()).toEqual([{ resourceId: "vm", physicalLabels: labels,
      status: "confirmed", providerOpId: "provider-op" }]);
    restarted.acknowledge("vm", labels);
    expect(new WarmCleanupJournal(dir).pending()).toEqual([]);
  });
  it("refuses sibling, unregistered and crossed-label confirmations", () => {
    const { journal } = setup(); journal.register("vm", labels);
    expect(() => journal.plan("sibling", labels)).toThrow("warm cleanup journal unavailable");
    expect(() => journal.plan("vm", { ...labels, leaseId: "other" })).toThrow("warm cleanup journal unavailable");
    expect(() => journal.confirm("vm", labels, "op")).toThrow("warm cleanup journal unavailable");
    journal.plan("vm", labels);
    expect(() => journal.acknowledge("vm", labels)).toThrow("warm cleanup journal unavailable");
  });
  it("preserves the first confirmed result and rejects identity replacement", () => {
    const { dir, journal } = setup(); journal.register("vm", labels); journal.register("vm", labels);
    expect(() => journal.register("vm", { ...labels, organizationId: "foreign" })).toThrow();
    journal.plan("vm", labels); journal.confirm("vm", labels, "first"); journal.confirm("vm", labels, "retry");
    expect(new WarmCleanupJournal(dir).pending()[0]).toMatchObject({ providerOpId: "first" });
  });
  it("hashes untrusted resource IDs and persists identifiers only", () => {
    const { dir, journal } = setup(); journal.register("../../vm?key=private", labels);
    for (const file of readdirSync(dir)) expect(file).toMatch(/^[a-f0-9]{64}\.json$/);
    const bytes = readdirSync(dir).map((file) => readFileSync(join(dir, file), "utf8")).join("");
    expect(JSON.parse(bytes)).toEqual({ v: 1, resourceId: "../../vm?key=private", physicalLabels: labels, status: "owned" });
  });
  it("bounds each sweep and rejects malformed labels without publishing", () => {
    const { journal } = setup();
    expect(() => journal.register("vm", { ...labels, attempt: NaN })).toThrow();
    for (let i = 0; i < 3; i++) { journal.register(`vm-${i}`, labels); journal.plan(`vm-${i}`, labels); }
    expect(journal.pending(2)).toHaveLength(2);
    const seen = new Set([...journal.pending(2), ...journal.pending(2)].map((row) => row.resourceId));
    expect(seen.size).toBe(3);
  });
  it("refuses corrupt persisted state rather than treating it as an absent registration", () => {
    const { dir, journal } = setup(); journal.register("vm", labels);
    writeFileSync(join(dir, readdirSync(dir)[0]), "{broken");
    expect(() => new WarmCleanupJournal(dir).isRegistered("vm", labels)).toThrow("warm cleanup journal unavailable");
    expect(() => new WarmCleanupJournal(dir).pending()).toThrow("warm cleanup journal unavailable");
  });
});

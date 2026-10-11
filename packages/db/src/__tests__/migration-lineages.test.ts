import { describe, expect, it } from "vitest";
import { classifyMigrationHistory, type MigrationLineage } from "../migration-lineages.js";

const common = ["common-0", "common-1"];
const lineages: MigrationLineage[] = [
  {
    id: "replatform",
    entries: [...common, "replatform-0", "replatform-1", "transition-r", "future-0"].map(
      (hash, index) => ({ hash, fileName: `r-${index}.sql`, filePath: `r-${index}.sql`, createdAt: index + 1 }),
    ),
  },
  {
    id: "universe",
    entries: [...common, "universe-0", "universe-1", "universe-2", "transition-u", "future-0"].map(
      (hash, index) => ({ hash, fileName: `u-${index}.sql`, filePath: `u-${index}.sql`, createdAt: index + 1 }),
    ),
  },
];

const hashes = (lineage: MigrationLineage, count = lineage.entries.length) =>
  lineage.entries.slice(0, count).map((entry) => entry.hash);

describe("classifyMigrationHistory", () => {
  it("uses the declared fresh-install lineage when histories are still shared", () => {
    expect(classifyMigrationHistory([], lineages, "replatform")).toMatchObject({
      status: "matched",
      lineageId: "replatform",
      appliedCount: 0,
      pendingEntries: lineages[0]!.entries,
    });
    expect(classifyMigrationHistory(common, lineages, "replatform")).toMatchObject({
      status: "matched",
      lineageId: "replatform",
      appliedCount: 2,
    });
  });

  it("recognizes exact prefixes on either branch, including the convergence marker", () => {
    expect(classifyMigrationHistory(hashes(lineages[0]!, 5), lineages, "replatform")).toMatchObject({
      status: "matched",
      lineageId: "replatform",
      appliedCount: 5,
      pendingEntries: lineages[0]!.entries.slice(5),
    });
    expect(classifyMigrationHistory(hashes(lineages[1]!, 5), lineages, "replatform")).toMatchObject({
      status: "matched",
      lineageId: "universe",
      appliedCount: 5,
      pendingEntries: lineages[1]!.entries.slice(5),
    });
  });

  it.each([
    ["a cross-lineage sequence", ["common-0", "replatform-0", "universe-0"]],
    ["a reordered known sequence", ["common-1", "common-0"]],
    ["an unknown hash", ["f".repeat(64)]],
  ])("rejects %s", (_label, applied) => {
    expect(classifyMigrationHistory(applied, lineages, "replatform")).toMatchObject({
      status: "incompatible",
    });
  });

  it("rejects a ledger longer than every registered path as newer", () => {
    const tooLong = Array.from({ length: lineages[1]!.entries.length + 1 }, (_, index) => `x-${index}`);
    expect(classifyMigrationHistory(tooLong, lineages, "replatform")).toEqual({
      status: "incompatible",
      reason: "newer",
    });
  });
});

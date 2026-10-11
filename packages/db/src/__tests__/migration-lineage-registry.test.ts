import { describe, expect, it } from "vitest";
import { loadRequiredMigrationLineages } from "../migration-lineage-registry.js";

describe("pinned migration-lineage registry", () => {
  it("registers exact shared, replatform, Universe, transition, and future paths", async () => {
    const registry = await loadRequiredMigrationLineages();
    const replatform = registry.lineages.find((lineage) => lineage.id === "replatform");
    const universe = registry.lineages.find((lineage) => lineage.id === "universe");

    expect(registry.freshLineageId).toBe("replatform");
    expect(replatform).toBeDefined();
    expect(universe).toBeDefined();
    expect(replatform!.entries).toHaveLength(288);
    expect(universe!.entries).toHaveLength(292);
    expect(replatform!.entries.slice(0, 283).map((entry) => entry.hash)).toEqual(
      universe!.entries.slice(0, 283).map((entry) => entry.hash),
    );
    expect(replatform!.entries[287]!.fileName).toBe("0287_cute_mariko_yashida.sql");
    expect(universe!.entries[291]!.fileName).toBe("0291_windy_starbolt.sql");
    expect(universe!.entries.slice(283, 291).every((entry) =>
      entry.filePath.startsWith("lineages/universe/"),
    )).toBe(true);
    expect(universe!.entries.slice(292)).toEqual(replatform!.entries.slice(288));
  });
});

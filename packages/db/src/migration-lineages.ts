export interface RegisteredMigration {
  readonly fileName: string;
  /** Path relative to the migration folder, including the lineage archive when applicable. */
  readonly filePath: string;
  readonly hash: string;
  readonly createdAt: number;
}

export interface MigrationLineage {
  readonly id: string;
  readonly entries: readonly RegisteredMigration[];
}

export type MigrationHistoryClassification =
  | {
      readonly status: "matched";
      readonly lineageId: string;
      readonly appliedCount: number;
      readonly appliedEntries: readonly RegisteredMigration[];
      readonly pendingEntries: readonly RegisteredMigration[];
      readonly complete: boolean;
    }
  | {
      readonly status: "incompatible";
      readonly reason: "newer" | "unknown" | "divergent" | "ambiguous";
    };

/**
 * Match the raw ordered database ledger to an exact registered history prefix.
 * Hash membership alone is insufficient: order and a single lineage path are
 * both required. Shared prefixes use the explicitly selected fresh-install path.
 */
export function classifyMigrationHistory(
  appliedHashes: readonly string[],
  lineages: readonly MigrationLineage[],
  freshLineageId: string,
): MigrationHistoryClassification {
  const ids = new Set<string>();
  const knownHashes = new Set<string>();
  let maximumLength = 0;

  for (const lineage of lineages) {
    if (!lineage.id || ids.has(lineage.id)) {
      throw new Error("Migration lineage registry contains a missing or duplicate id");
    }
    ids.add(lineage.id);
    maximumLength = Math.max(maximumLength, lineage.entries.length);

    const lineageHashes = new Set<string>();
    for (const entry of lineage.entries) {
      if (!entry.hash || !entry.fileName || !entry.filePath || !Number.isFinite(entry.createdAt)) {
        throw new Error(`Migration lineage ${lineage.id} contains an invalid entry`);
      }
      if (lineageHashes.has(entry.hash)) {
        throw new Error(`Migration lineage ${lineage.id} contains a duplicate hash`);
      }
      lineageHashes.add(entry.hash);
      knownHashes.add(entry.hash);
    }
  }

  if (lineages.length === 0 || !ids.has(freshLineageId)) {
    throw new Error("Migration lineage registry is missing its fresh-install lineage");
  }

  if (appliedHashes.length > maximumLength) {
    return { status: "incompatible", reason: "newer" };
  }

  const matches = lineages.filter((lineage) =>
    appliedHashes.every((hash, index) => lineage.entries[index]?.hash === hash),
  );
  if (matches.length === 0) {
    const containsUnknown = appliedHashes.some((hash) => !knownHashes.has(hash));
    return { status: "incompatible", reason: containsUnknown ? "unknown" : "divergent" };
  }

  const selected = matches.find((lineage) => lineage.id === freshLineageId) ??
    (matches.length === 1 ? matches[0] : undefined);
  if (!selected) return { status: "incompatible", reason: "ambiguous" };

  const appliedEntries = selected.entries.slice(0, appliedHashes.length);
  const pendingEntries = selected.entries.slice(appliedHashes.length);
  return {
    status: "matched",
    lineageId: selected.id,
    appliedCount: appliedHashes.length,
    appliedEntries,
    pendingEntries,
    complete: pendingEntries.length === 0,
  };
}

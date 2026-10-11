/**
 * DEP-003 (E6 deployment harness): the schema-compatibility gate that backs
 * readiness. The control plane serves NO tenant/app route until the applied
 * migration identity is COMPATIBLE with the image's
 * `loadRequiredMigrationIdentity()`. This module is the pure comparison core plus a
 * thin DB loader; the readiness route + startup gate consume it.
 *
 * Three verdicts:
 *   - `compatible`   — applied == required. Ready to serve.
 *   - `pending`      — applied is a strict PREFIX of required (DB behind the image;
 *                      the migration job has not finished). Readiness 503s until the
 *                      privileged migration job applies the rest — NOT a crash.
 *   - `incompatible` — the DB was migrated PAST this image (`newer`, the rollback
 *                      case) or diverged (`divergent`). Refuse to serve.
 */
import {
  loadAppliedMigrationIdentity,
  loadRequiredMigrationLineages,
  loadRequiredMigrationIdentity,
  type Db,
  type RequiredMigrationIdentity,
} from "@armyofagents/db";
import { sql } from "drizzle-orm";

export interface SchemaCompatibilityInput {
  /** Image's required migration file hashes (journal order), from loadRequiredMigrationIdentity. */
  requiredOrderedHashes: readonly string[];
  /** sha256 of each APPLIED migration file that resolves to this image, in apply order. */
  appliedOrderedHashes: readonly string[];
  /** Raw `__drizzle_migrations` row count — reveals a DB migrated past this image. */
  rawAppliedCount: number;
  /** Alternative exact image histories accepted by this deployment. */
  requiredLineages?: readonly { id: string; orderedHashes: readonly string[] }[];
  freshLineageId?: string;
}

export type SchemaCompatibility =
  | { status: "compatible"; schemaCompatible: true }
  | { status: "pending"; schemaCompatible: false; pendingCount: number }
  | { status: "incompatible"; schemaCompatible: false; reason: "newer" | "divergent" };

/**
 * The pure, deterministic compatibility verdict. Fail-closed: anything that is not
 * an exact match or a clean prefix-behind is treated as incompatible (refuse serve).
 */
export function evaluateSchemaCompatibility(
  input: SchemaCompatibilityInput,
): SchemaCompatibility {
  const applied = input.appliedOrderedHashes;
  const histories = input.requiredLineages?.length
    ? input.requiredLineages
    : [{ id: "default", orderedHashes: input.requiredOrderedHashes }];
  const requiredLen = Math.max(...histories.map((history) => history.orderedHashes.length));

  // A DB with MORE applied migrations than the image knows (or more raw rows than
  // the image's whole ledger) has been migrated by a newer image — refuse to serve.
  if (input.rawAppliedCount > requiredLen || applied.length > requiredLen) {
    return { status: "incompatible", schemaCompatible: false, reason: "newer" };
  }

  // The applied hashes must be an exact positional PREFIX of the required hashes.
  // Any mismatch means a replaced/diverged migration -> refuse to serve.
  // Raw rows that did NOT resolve to image files within the known range (a diverged
  // or renamed migration) -> refuse to serve.
  if (input.rawAppliedCount !== applied.length) {
    return { status: "incompatible", schemaCompatible: false, reason: "divergent" };
  }

  const matches = histories.filter((history) =>
    applied.every((hash, index) => history.orderedHashes[index] === hash),
  );
  if (matches.length === 0) {
    return { status: "incompatible", schemaCompatible: false, reason: "divergent" };
  }

  const selected = matches.find((history) => history.id === input.freshLineageId) ??
    (matches.length === 1 ? matches[0] : undefined);
  if (!selected) return { status: "incompatible", schemaCompatible: false, reason: "divergent" };
  if (applied.length === selected.orderedHashes.length) {
    return { status: "compatible", schemaCompatible: true };
  }

  // Applied is a strict prefix — the migration job has not finished. 503 until it does.
  return { status: "pending", schemaCompatible: false, pendingCount: selected.orderedHashes.length - applied.length };
}

/**
 * Load the applied + required identities from the DB and the image, then compare.
 * Read-only; never mutates the database.
 */
export async function loadSchemaCompatibility(url: string): Promise<SchemaCompatibility> {
  const [required, requiredLineages, applied] = await Promise.all([
    loadRequiredMigrationIdentity(),
    loadRequiredMigrationLineages(),
    loadAppliedMigrationIdentity(url),
  ]);
  return evaluateSchemaCompatibility({
    requiredOrderedHashes: required.orderedHashes,
    appliedOrderedHashes: applied.orderedHashes,
    rawAppliedCount: applied.rawAppliedCount,
    requiredLineages: requiredLineages.lineages.map((lineage) => ({
      id: lineage.id,
      orderedHashes: lineage.entries.map((entry) => entry.hash),
    })),
    freshLineageId: requiredLineages.freshLineageId,
  });
}

/** Distributed startup already admits the canonical Drizzle ledger. Keep the
 * immutable image identity, but read its live database rows on EVERY request.
 * No cached readiness verdict, new connection, or migration-file hashing here. */
export function createLiveSchemaCompatibilityReader(
  db: Db,
  required: RequiredMigrationIdentity,
  requiredLineages?: readonly { id: string; orderedHashes: readonly string[] }[],
  freshLineageId?: string,
): () => Promise<SchemaCompatibility> {
  const requiredOrderedHashes = Object.freeze([...required.orderedHashes]);
  if (requiredOrderedHashes.length === 0) throw new Error("Missing required migration identity");
  return async () => {
    const rows = await db.execute<{ hash: string | null }>(sql`
      SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id
    `);
    return evaluateSchemaCompatibility({
      requiredOrderedHashes,
      appliedOrderedHashes: rows.map(row => row.hash ?? ""),
      rawAppliedCount: rows.length,
      requiredLineages,
      freshLineageId,
    });
  };
}

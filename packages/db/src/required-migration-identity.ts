import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const MIGRATIONS_JOURNAL_JSON = new URL("./migrations/meta/_journal.json", import.meta.url);

type MigrationJournalFile = {
  entries?: Array<{ idx?: number; tag?: string }>;
};

export interface RequiredMigrationIdentity {
  readonly orderedHashes: readonly string[];
  readonly ledgerSha256: string;
}

/**
 * Produce the owner-side migration certificate from the checked-in Drizzle
 * journal and raw migration bytes. Database serial IDs are deliberately absent:
 * they are allocation details, not migration identity.
 */
export async function loadRequiredMigrationIdentity(): Promise<RequiredMigrationIdentity> {
  const rawJournal = await readFile(MIGRATIONS_JOURNAL_JSON, "utf8");
  const journal = JSON.parse(rawJournal) as MigrationJournalFile;
  if (!Array.isArray(journal.entries)) {
    throw new Error("The checked-in migration journal has no entries");
  }

  const orderedPaths = journal.entries.map((entry) => {
    if (typeof entry?.tag !== "string" || entry.tag.length === 0) {
      throw new Error("The checked-in migration journal contains an invalid tag");
    }
    if (!Number.isInteger(entry.idx)) {
      throw new Error("The checked-in migration journal contains an invalid index");
    }
    return `${entry.tag}.sql`;
  });

  if (new Set(orderedPaths).size !== orderedPaths.length) {
    throw new Error("The checked-in migration journal contains duplicate paths");
  }

  const orderedHashes = await Promise.all(orderedPaths.map(async (migrationPath) =>
    createHash("sha256")
      .update(await readFile(new URL(`./migrations/${migrationPath}`, import.meta.url)))
      .digest("hex")));
  if (new Set(orderedHashes).size !== orderedHashes.length) {
    throw new Error("The checked-in migration journal contains duplicate migration hashes");
  }

  const frozenHashes = Object.freeze(orderedHashes);
  return Object.freeze({
    orderedHashes: frozenHashes,
    ledgerSha256: createHash("sha256").update(JSON.stringify(frozenHashes)).digest("hex"),
  });
}

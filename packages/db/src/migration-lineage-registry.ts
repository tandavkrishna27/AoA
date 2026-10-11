import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { MigrationLineage, RegisteredMigration } from "./migration-lineages.js";

type JournalFile = {
  entries?: Array<{ idx?: number; tag?: string; when?: number }>;
};

type Manifest = {
  version: number;
  freshLineageId: string;
  sharedPrefixCount: number;
  replatformTransitionTag: string;
  replatformTransitionIndex: number;
  universeHistoryStartIndex: number;
  universeTransitionTag: string;
  universeTransitionIndex: number;
};

export interface RequiredMigrationLineages {
  readonly freshLineageId: string;
  readonly lineages: readonly MigrationLineage[];
}

async function readJournal(path: string): Promise<Array<{ idx: number; tag: string; when: number }>> {
  const parsed = JSON.parse(await readFile(new URL(`./migrations/${path}`, import.meta.url), "utf8")) as JournalFile;
  if (!Array.isArray(parsed.entries)) throw new Error(`Migration journal ${path} has no entries`);
  return parsed.entries.map((entry, index) => {
    if (!Number.isInteger(entry.idx) || typeof entry.tag !== "string" || !Number.isFinite(entry.when)) {
      throw new Error(`Migration journal ${path} has an invalid entry at ${index}`);
    }
    return { idx: Number(entry.idx), tag: entry.tag, when: Number(entry.when) };
  });
}

async function registerEntries(
  entries: readonly { idx: number; tag: string; when: number }[],
  basePath: string,
): Promise<RegisteredMigration[]> {
  return Promise.all(entries.map(async (entry) => {
    const fileName = `${entry.tag}.sql`;
    const filePath = basePath ? `${basePath}/${fileName}` : fileName;
    const bytes = await readFile(new URL(`./migrations/${filePath}`, import.meta.url));
    return {
      fileName,
      filePath,
      hash: createHash("sha256").update(bytes).digest("hex"),
      createdAt: entry.when,
    };
  }));
}

/** Build and validate the exact migration histories supported by this image. */
export async function loadRequiredMigrationLineages(): Promise<RequiredMigrationLineages> {
  const manifest = JSON.parse(await readFile(new URL("./migrations/lineage-manifest.json", import.meta.url), "utf8")) as Manifest;
  if (manifest.version !== 1 || manifest.freshLineageId !== "replatform") {
    throw new Error("Unsupported migration lineage manifest");
  }

  const [rootEntries, universeEntries] = await Promise.all([
    readJournal("meta/_journal.json"),
    readJournal("lineages/universe/meta/_journal.json"),
  ]);
  const root = await registerEntries(rootEntries, "");
  const universeShared = await registerEntries(universeEntries.slice(0, manifest.sharedPrefixCount), "");
  const universeBranch = await registerEntries(universeEntries.slice(manifest.sharedPrefixCount), "lineages/universe");
  const universeArchive = [...universeShared, ...universeBranch];
  const sharedCount = manifest.sharedPrefixCount;
  const replatformTransition = rootEntries.findIndex((entry) => entry.tag === manifest.replatformTransitionTag);
  const universeTransition = universeEntries.findIndex((entry) => entry.tag === manifest.universeTransitionTag);
  if (!Number.isInteger(sharedCount) || sharedCount < 1 || replatformTransition !== manifest.replatformTransitionIndex ||
      universeTransition !== manifest.universeTransitionIndex || universeTransition < sharedCount || universeEntries[0]?.idx !== 0 ||
      universeEntries[sharedCount]?.idx !== manifest.universeHistoryStartIndex) {
    throw new Error("Migration lineage manifest does not match its journals");
  }

  const sharedRoot = root.slice(0, sharedCount);
  const sharedUniverse = universeArchive.slice(0, sharedCount);
  if (sharedRoot.length !== sharedCount || sharedUniverse.length !== sharedCount ||
      sharedRoot.some((entry, index) => entry.hash !== sharedUniverse[index]?.hash)) {
    throw new Error("Registered migration lineages do not have the declared exact shared prefix");
  }

  const universe = [
    ...sharedRoot,
    ...universeArchive.slice(sharedCount),
    ...root.slice(replatformTransition + 1),
  ];
  if (universe[universeTransition]?.fileName !== `${manifest.universeTransitionTag}.sql`) {
    throw new Error("Universe transition tag is missing from its registered lineage");
  }

  return Object.freeze({
    freshLineageId: manifest.freshLineageId,
    lineages: Object.freeze([
      Object.freeze({ id: "replatform", entries: Object.freeze(root) }),
      Object.freeze({ id: "universe", entries: Object.freeze(universe) }),
    ]),
  });
}

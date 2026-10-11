import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_INDEX_SOURCE = readFileSync(join(__dirname, "..", "index.ts"), "utf8");

describe("server migration snapshot-gate wiring", () => {
  it("centralizes migration apply behind the file/env-resolved deployment-mode gate", () => {
    const guardedCalls = SERVER_INDEX_SOURCE.match(
      /applyPendingMigrations\(connectionString,\s*\{\s*deploymentMode:\s*config\.deploymentMode/g,
    );
    expect(guardedCalls).toHaveLength(1);
    expect(SERVER_INDEX_SOURCE.match(/await ensureMigrations\(/g)).toHaveLength(2);
  });

  it("does not retain a server-only gate that manual migrations could bypass", () => {
    expect(SERVER_INDEX_SOURCE).not.toContain("checkMigrationSnapshotGate");
    expect(SERVER_INDEX_SOURCE).not.toContain("./postgres/snapshot-gate.js");
  });
});

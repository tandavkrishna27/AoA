/**
 * REL-003 (E11) Lane A — recovered-manifest reconciliation.
 *
 * PURE unit + anti-orphan harness proof for
 * `evaluateRecoveredManifestReconciliation` / `runManifestReconciliation`
 * (server/src/services/disaster-recovery/manifest-reconciliation.ts). No DB, no
 * network — runs on every platform. Fail-first order per the design §6: a positive
 * control (break `classifyObject` to `return "verified"` outright) proves these
 * cases exercise the verifier; then the real guards A-G1..A-G7 are each
 * mutation-tested by DELETION (design §7).
 */
import { describe, it, expect } from "vitest";
import {
  evaluateRecoveredManifestReconciliation,
  runManifestReconciliation,
  runStoredManifestReconciliation,
  type RecoveredManifestRow,
} from "../services/disaster-recovery/manifest-reconciliation.js";
import type { HeadObjectResult } from "../storage/types.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

describe("stored recovery bytes", () => {
  it("verifies real files and refuses actual missing/corrupt bytes without trusting checksum metadata", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "aoa-dr-object-bytes-"));
    try {
      const storage = createLocalDiskStorageProvider(directory);
      const body = Buffer.from("recovered company artifact\n");
      const manifest = row({ sha256: createHash("sha256").update(body).digest("hex"), sizeBytes: body.length });
      const put = (bytes: Buffer) => storage.putObject({ objectKey: manifest.objectKey, body: bytes, contentType: "text/plain", contentLength: bytes.length });
      await put(body);
      expect((await storage.headObject({ objectKey: manifest.objectKey })).checksumSha256).toBeUndefined();
      expect((await runStoredManifestReconciliation({ rows: [manifest], storage })).verdict).toBe("recovered");
      const corrupt = Buffer.from(body);
      corrupt[0] = corrupt[0]! ^ 1;
      await put(corrupt);
      const rejected = await runStoredManifestReconciliation({ rows: [manifest], storage });
      expect(rejected.objects[0]!.disposition).toBe("hash_mismatch");
      expect(rejected.promoted).toEqual([]);
      await storage.deleteObject({ objectKey: manifest.objectKey });
      const missing = await runStoredManifestReconciliation({ rows: [manifest], storage });
      expect(missing.objects[0]!.disposition).toBe("missing");
      expect(missing.promoted).toEqual([]);
    } finally {
      if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("aoa-dr-object-bytes-")) throw new Error("Unsafe fixture cleanup path");
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses a foreign scope before probing or reading any object", async () => {
    const forbidden = async (): Promise<never> => { throw new Error("foreign object accessed"); };
    const manifest = row({ objectKey: keyFor(OTHER_ORG, 1, "foreign.txt") });
    const result = await runStoredManifestReconciliation({ rows: [manifest], storage: { getObject: forbidden, headObject: forbidden } });
    expect(result.objects[0]!.disposition).toBe("wrong_prefix");
    expect(result.verdict).toBe("failed");
    expect(result.promoted).toEqual([]);
  });

  it("uses streamed hash and size even when supplied metadata claims a match", async () => {
    const body = Buffer.from("actual recovered bytes");
    const manifest = row({ sha256: createHash("sha256").update(body).digest("hex"), sizeBytes: body.length + 1 });
    const storage = {
      headObject: async () => ({ exists: true, contentLength: manifest.sizeBytes, checksumSha256: manifest.sha256 }),
      getObject: async () => ({ stream: Readable.from([body.subarray(0, 5), body.subarray(5)]), contentLength: manifest.sizeBytes }),
    };
    const wrongSize = await runStoredManifestReconciliation({ rows: [manifest], storage });
    expect(wrongSize.objects[0]!.disposition).toBe("size_mismatch");
    const wrongHash = await runStoredManifestReconciliation({ rows: [{ ...manifest, sha256: HASH, sizeBytes: body.length }], storage });
    expect(wrongHash.objects[0]!.disposition).toBe("hash_mismatch");
    expect(wrongHash.promoted).toEqual([]);
  });

  it("aborts on a truncated read and closes the stream instead of returning partial success", async () => {
    const stream = Readable.from((async function* () {
      yield Buffer.from("partial");
      throw new Error("object read interrupted");
    })());
    await expect(runStoredManifestReconciliation({ rows: [row()], storage: {
      headObject: async () => probe(), getObject: async () => ({ stream }),
    } })).rejects.toThrow("object read interrupted");
    expect(stream.destroyed).toBe(true);
  });

  it("refuses decoded string streams that cannot prove the original bytes", async () => {
    const stream = Readable.from(["decoded content"]);
    await expect(runStoredManifestReconciliation({ rows: [row()], storage: {
      headObject: async () => probe(), getObject: async () => ({ stream }),
    } })).rejects.toThrow("must emit bytes");
    expect(stream.destroyed).toBe(true);
  });
});

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "99999999-9999-9999-9999-999999999999";
const JOB = "22222222-2222-2222-2222-222222222222";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

function keyFor(org: string, attempt: number, suffix: string): string {
  return `organizations/${org}/jobs/${JOB}/attempts/${attempt}/${suffix}`;
}

function row(overrides: Partial<RecoveredManifestRow> = {}): RecoveredManifestRow {
  return {
    organizationId: ORG,
    jobId: JOB,
    attempt: 1,
    artifactId: "art-1",
    objectKey: keyFor(ORG, 1, "log.txt"),
    sha256: HASH,
    sizeBytes: 100,
    ...overrides,
  };
}

function probe(overrides: Partial<HeadObjectResult> = {}): HeadObjectResult {
  return { exists: true, contentLength: 100, checksumSha256: HASH, ...overrides };
}

/** Build a probes map that MATCHES each row (correct existence/hash/size) unless
 * an override is supplied — so a single failing field isolates a single guard. */
function probesFor(rows: RecoveredManifestRow[], overrides: Record<string, HeadObjectResult> = {}): Map<string, HeadObjectResult> {
  const map = new Map<string, HeadObjectResult>();
  for (const r of rows) {
    map.set(r.objectKey, overrides[r.objectKey] ?? probe({ contentLength: r.sizeBytes, checksumSha256: r.sha256 }));
  }
  return map;
}

describe("evaluateRecoveredManifestReconciliation", () => {
  it("verifies a matching object and reports the recovery as recovered (the truest green)", () => {
    const rows = [row()];
    const result = evaluateRecoveredManifestReconciliation(rows, probesFor(rows));
    expect(result.verdict).toBe("recovered");
    expect(result.objects[0]!.disposition).toBe("verified");
    expect(result.promoted).toEqual([rows[0]!.objectKey]);
    expect(result.quarantined).toEqual([]);
  });

  it("I1: a stored hash that differs from the recorded sha256 is hash_mismatch, verdict failed", () => {
    const rows = [row()];
    const probes = probesFor(rows, { [rows[0]!.objectKey]: probe({ checksumSha256: OTHER_HASH }) });
    const result = evaluateRecoveredManifestReconciliation(rows, probes);
    expect(result.objects[0]!.disposition).toBe("hash_mismatch");
    expect(result.verdict).toBe("failed");
  });

  it("I2: a byte length that differs from the recorded size_bytes is size_mismatch", () => {
    const rows = [row()];
    const probes = probesFor(rows, { [rows[0]!.objectKey]: probe({ contentLength: 101 }) });
    const result = evaluateRecoveredManifestReconciliation(rows, probes);
    expect(result.objects[0]!.disposition).toBe("size_mismatch");
    expect(result.verdict).toBe("failed");
  });

  it("I3: an object_key outside its org/job/attempt prefix (a foreign-tenant key) is wrong_prefix", () => {
    // The row is owned by ORG, but the key lives under OTHER_ORG's prefix — a
    // cross-tenant / misplaced object (DE-23). Probe MATCHES (exists/hash/size) so
    // only the scope guard can fire.
    const foreignKey = keyFor(OTHER_ORG, 1, "log.txt");
    const rows = [row({ objectKey: foreignKey })];
    const result = evaluateRecoveredManifestReconciliation(rows, probesFor(rows));
    expect(result.objects[0]!.disposition).toBe("wrong_prefix");
    expect(result.verdict).toBe("failed");
    expect(result.quarantined).toEqual([foreignKey]);
  });

  it("I3 (defense-in-depth): an UNSAFE key under the prefix (a `..` segment a compromised restore planted) is wrong_prefix", () => {
    // Starts with the correct prefix and is longer, but is not a safe relative
    // POSIX key — the frozen commit schema would have rejected it, so a recovered
    // manifest carrying it is a corrupted/compromised restore. Probe MATCHES so only
    // the safe-path arm of the scope guard can fire.
    const unsafeKey = `organizations/${ORG}/jobs/${JOB}/attempts/1/../evil.txt`;
    const rows = [row({ objectKey: unsafeKey })];
    const result = evaluateRecoveredManifestReconciliation(rows, probesFor(rows));
    expect(result.objects[0]!.disposition).toBe("wrong_prefix");
    expect(result.verdict).toBe("failed");
    expect(result.promoted).toEqual([]);
  });

  it("I4: a probe reporting the object absent is missing, verdict failed", () => {
    const rows = [row()];
    const probes = probesFor(rows, { [rows[0]!.objectKey]: probe({ exists: false }) });
    const result = evaluateRecoveredManifestReconciliation(rows, probes);
    expect(result.objects[0]!.disposition).toBe("missing");
    expect(result.verdict).toBe("failed");
    // Nothing to quarantine — a missing object has no bytes to quarantine.
    expect(result.quarantined).toEqual([]);
  });

  it("I5: an object the store cannot checksum is hash_unverifiable, never verified (fail-closed)", () => {
    const rows = [row()];
    const probes = probesFor(rows, { [rows[0]!.objectKey]: probe({ checksumSha256: undefined }) });
    const result = evaluateRecoveredManifestReconciliation(rows, probes);
    expect(result.objects[0]!.disposition).toBe("hash_unverifiable");
    expect(result.verdict).toBe("failed");
  });

  it("I5 (fail-closed): an EMPTY-string checksum is also hash_unverifiable, never verified", () => {
    const rows = [row()];
    const probes = probesFor(rows, { [rows[0]!.objectKey]: probe({ checksumSha256: "" }) });
    const result = evaluateRecoveredManifestReconciliation(rows, probes);
    expect(result.objects[0]!.disposition).toBe("hash_unverifiable");
    expect(result.verdict).toBe("failed");
  });

  it("I6: verdict is recovered iff EVERY row is verified — one missing among many still fails", () => {
    const good = row({ artifactId: "art-good", objectKey: keyFor(ORG, 1, "good.txt") });
    const bad = row({ artifactId: "art-bad", objectKey: keyFor(ORG, 2, "bad.txt"), attempt: 2 });
    const rows = [good, bad];
    const probes = probesFor(rows, { [bad.objectKey]: probe({ exists: false }) });
    const result = evaluateRecoveredManifestReconciliation(rows, probes);
    expect(result.verdict).toBe("failed");
    // The good object still verified, the bad one missing.
    expect(result.objects.find((o) => o.artifactId === "art-good")!.disposition).toBe("verified");
    expect(result.objects.find((o) => o.artifactId === "art-bad")!.disposition).toBe("missing");
  });

  it("I7: a failed disposition is never promoted; quarantine-mapped failures are quarantined", () => {
    const good = row({ artifactId: "art-good", objectKey: keyFor(ORG, 1, "good.txt") });
    const bad = row({ artifactId: "art-bad", objectKey: keyFor(ORG, 2, "bad.txt"), attempt: 2 });
    const rows = [good, bad];
    const probes = probesFor(rows, { [bad.objectKey]: probe({ checksumSha256: OTHER_HASH }) });
    const result = evaluateRecoveredManifestReconciliation(rows, probes);
    // The mismatched object must NOT be in the promoted/served set.
    expect(result.promoted).toEqual([good.objectKey]);
    expect(result.promoted).not.toContain(bad.objectKey);
    // hash_mismatch is a FROZEN quarantine reason → quarantined.
    expect(result.quarantined).toEqual([bad.objectKey]);
  });

  it("classifies an empty manifest as recovered (nothing to verify)", () => {
    const result = evaluateRecoveredManifestReconciliation([], new Map());
    expect(result.verdict).toBe("recovered");
    expect(result.promoted).toEqual([]);
  });
});

describe("runManifestReconciliation (I8 — the verifier is invoked by the harness, not orphaned)", () => {
  it("probes every row and routes the pair through the verifier, returning the same verdict", async () => {
    const good = row({ artifactId: "art-good", objectKey: keyFor(ORG, 1, "good.txt") });
    const bad = row({ artifactId: "art-bad", objectKey: keyFor(ORG, 2, "bad.txt"), attempt: 2 });
    const rows = [good, bad];
    const store = probesFor(rows, { [bad.objectKey]: probe({ checksumSha256: OTHER_HASH }) });
    const probed: string[] = [];
    const result = await runManifestReconciliation({
      rows,
      headObject: async (key) => {
        probed.push(key);
        return store.get(key)!;
      },
    });
    // The harness probed every object...
    expect(probed.sort()).toEqual([good.objectKey, bad.objectKey].sort());
    // ...and the harness verdict equals the verifier's verdict for the same input
    // (removing the verifier call cannot reproduce this).
    const direct = evaluateRecoveredManifestReconciliation(rows, store);
    expect(result).toEqual(direct);
    expect(result.verdict).toBe("failed");
    expect(result.promoted).toEqual([good.objectKey]);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_MAX_ARTIFACT_BYTES } from "../services/artifact-size-ceiling.js";
import { verifyArtifactStream } from "../storage/artifact-content-stream.js";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";

describe("distributed content streaming integrity", () => {
  const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  async function collect(stream: Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  it("returns identical bytes across chunk boundaries, including empty content", async () => {
    for (const bytes of [Buffer.alloc(0), Buffer.from("exported bytes")]) {
      const source = Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]);
      expect(await collect(verifyArtifactStream(source, { sizeBytes: bytes.length, sha256: digest(bytes) }))).toEqual(bytes);
    }
  });
  it.each(["hash", "short", "long"])("aborts a %s mismatch without releasing the final byte", async (kind) => {
    const bytes = Buffer.from("artifact");
    const source = Readable.from([bytes]);
    const verified = verifyArtifactStream(source, {
      sizeBytes: kind === "short" ? bytes.length + 1 : kind === "long" ? bytes.length - 1 : bytes.length,
      sha256: kind === "hash" ? "0".repeat(64) : digest(bytes),
    });
    const delivered: Buffer[] = [];
    verified.on("data", (chunk) => delivered.push(Buffer.from(chunk)));
    await expect(new Promise((resolve, reject) => { verified.on("end", resolve); verified.on("error", reject); }))
      .rejects.toThrow("Artifact integrity check failed");
    expect(Buffer.concat(delivered).length).toBeLessThan(bytes.length);
    expect(source.destroyed).toBe(true);
  });
  it("cancels the source when the consumer disconnects", async () => {
    const source = new Readable({ read() { this.push(Buffer.from("a")); } });
    const verified = verifyArtifactStream(source, { sizeBytes: 1024, sha256: "0".repeat(64) });
    verified.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    expect(source.destroyed).toBe(true);
  });
  it("applies backpressure without accumulating the declared five GiB", async () => {
    const chunk = Buffer.alloc(64 * 1024);
    let produced = 0;
    const source = new Readable({ read() { produced += chunk.length; this.push(chunk); } });
    const verified = verifyArtifactStream(source, { sizeBytes: DEFAULT_MAX_ARTIFACT_BYTES, sha256: "0".repeat(64) });
    await new Promise((resolve) => setImmediate(resolve));
    expect(produced).toBeGreaterThan(0);
    expect(produced).toBeLessThan(8 * chunk.length);
    verified.destroy();
    expect(source.destroyed).toBe(true);
  });
});

// BRW-003d-5 — the SERVER-SIDE half of the commit-vector claim.
//
// ★ WHY THIS FILE IS THE POINT OF THE TICKET.
// `check-artifact-commit-vectors.mjs` claims two independent implementations
// "pin to one fixture, neither can silently diverge". That was already FALSE: the
// fixture had exactly one reference in the tree — the script's own header comment.
// The word "two" counted one implementation and one comment. A false claim of
// enforcement is worse than a missing check, because it reads as coverage.
//
// This is the second consumer. It binds the fixture to the number the SERVER
// actually uses, so the reference and the server can no longer drift apart in
// silence.

// ★ Resolved from THIS FILE, never from process.cwd(). The first version used cwd
// and passed when vitest ran inside `server/` while failing under the root
// `pnpm test:run` that CI actually runs — a green local suite and a red lane, for
// a path assumption rather than a behaviour.
const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../tests/fixtures/artifact-commit/v1/vectors.json", import.meta.url),
    ),
    "utf8",
  ),
) as {
  context: { maxArtifactBytes?: number };
  rejectVectors: Array<{ name: string; reason: string; actualSizeBytes: number }>;
};

describe("BRW-003d-5 — the fixture and the server share ONE ceiling", () => {
  it("★ pins the fixture's ceiling to the server's constant", () => {
    // The divergence this closes: the server owned its ceiling privately as a
    // `?? 5 * 1024 ** 3` default and the reference modelled none at all.
    expect(FIXTURE.context.maxArtifactBytes).toBe(DEFAULT_MAX_ARTIFACT_BYTES);
  });

  it("agrees with the server's rule on every ceiling vector", () => {
    const ceilingVectors = FIXTURE.rejectVectors.filter(
      (v) => v.reason === "size_ceiling_exceeded",
    );
    // Anti-vacuity: a filter that matches nothing would make the loop below pass
    // by having nothing to check.
    expect(ceilingVectors.length).toBeGreaterThan(0);
    for (const v of ceilingVectors) {
      // The server's literal rule (artifact-commit.ts): reject when the
      // STORE-OBSERVED size exceeds the ceiling.
      expect(v.actualSizeBytes > DEFAULT_MAX_ARTIFACT_BYTES, v.name).toBe(true);
    }
  });

  it("keeps the ceiling a positive, finite number of bytes", () => {
    expect(Number.isSafeInteger(DEFAULT_MAX_ARTIFACT_BYTES)).toBe(true);
    expect(DEFAULT_MAX_ARTIFACT_BYTES).toBeGreaterThan(0);
  });
});

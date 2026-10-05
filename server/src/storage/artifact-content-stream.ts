import { createHash } from "node:crypto";
import { Transform, type Readable } from "node:stream";
import { DEFAULT_MAX_ARTIFACT_BYTES } from "../services/artifact-size-ceiling.js";

export const EMPTY_ARTIFACT_SHA256 = createHash("sha256").digest("hex");

/** Hold one byte until verification, so a corrupt response cannot fulfill Content-Length. */
export function verifyArtifactStream(source: Readable, expected: { sizeBytes: number; sha256: string }): Readable {
  const hash = createHash("sha256");
  let bytes = 0;
  let tail: Buffer | undefined;
  const invalid = () => new Error("Artifact integrity check failed");
  const verified = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > expected.sizeBytes || bytes > DEFAULT_MAX_ARTIFACT_BYTES) return callback(invalid());
      hash.update(chunk);
      if (chunk.length) {
        if (tail) this.push(tail);
        this.push(chunk.subarray(0, chunk.length - 1));
        // Copy only one byte: a slice would retain the whole provider chunk.
        tail = Buffer.from([chunk[chunk.length - 1]!]);
      }
      callback();
    },
    flush(callback) {
      if (bytes !== expected.sizeBytes || hash.digest("hex") !== expected.sha256) return callback(invalid());
      if (tail) this.push(tail);
      callback();
    },
    destroy(error, callback) {
      source.destroy();
      callback(error);
    },
  });
  source.on("error", () => verified.destroy(invalid()));
  source.on("close", () => { if (!source.readableEnded) verified.destroy(invalid()); });
  source.pipe(verified);
  return verified;
}

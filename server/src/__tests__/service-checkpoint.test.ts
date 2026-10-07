import { describe, expect, it } from "vitest";
import { serviceCheckpointManifestSchema } from "../services/service-checkpoint.js";
const file = { artifactId: "b6000000-0000-4000-8000-000000000002", path: "state.json", type: "file", encoding: "json", sha256: "a".repeat(64), sizeBytes: 100 };
const manifest = { version: 1, serviceId: "b6000000-0000-4000-8000-000000000001", generation: 1, files: [file] };
describe("portable checkpoint manifest", () => {
  it.each(["../state.json", "/state.json", "dir/../state.json", "dir\\state.json", ".env.json", "a//state.json"])("rejects unsafe path %s", (path) => {
    expect(serviceCheckpointManifestSchema.safeParse({ ...manifest, files: [{ ...file, path }] }).success).toBe(false);
  });
  it("rejects links and duplicate paths", () => {
    expect(serviceCheckpointManifestSchema.safeParse({ ...manifest, files: [{ ...file, type: "symlink" }] }).success).toBe(false);
    expect(serviceCheckpointManifestSchema.safeParse({ ...manifest, files: [file, file] }).success).toBe(false);
  });
  it("bounds file count and total size", () => {
    expect(serviceCheckpointManifestSchema.safeParse({ ...manifest, files: Array.from({ length: 17 }, (_, i) => ({ ...file, path: `state${i}.json` })) }).success).toBe(false);
    expect(serviceCheckpointManifestSchema.safeParse({ ...manifest, files: Array.from({ length: 9 }, (_, i) => ({ ...file, path: `state${i}.json`, sizeBytes: 1024 * 1024 })) }).success).toBe(false);
  });
});

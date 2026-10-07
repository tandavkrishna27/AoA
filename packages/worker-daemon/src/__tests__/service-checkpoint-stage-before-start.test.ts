import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSupervisor } from "../supervisor/supervisor.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";
import { collectingSink, makeServiceHandoff, SERVICE_FIXTURE_IDS, SUPERVISOR_IDENTITY } from "./support/supervisor-fixtures.js";
import type { StagedFileRequest } from "../supervisor/provider.js";
const checkpoint = "00000000-0000-4000-8000-0000000000c1";
const prefix = `/tmp/aoa-service-state/${SERVICE_FIXTURE_IDS.serviceId}/`;
const statePath = `${prefix}state.json`;
const markerPath = `${prefix}.aoa-checkpoint-${checkpoint}-3.json`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const objects = { state: '{"counter":42}', marker: '{"generation":3}' };
const request = (path: string, key: keyof typeof objects): StagedFileRequest => ({ path, grant: {
  protocolVersion: 1, operation: "download", artifactId: checkpoint, method: "GET", url: "https://objects.invalid/state", headers: {},
  issuedAt: "2026-10-07T00:00:00Z", expiresAt: "2126-10-07T00:00:00Z", maxBytes: objects[key].length,
  expectedSha256: sha(objects[key]), objectKey: key, redaction: "secret",
} as never });
const requests = [request(statePath, "state"), request(markerPath, "marker")];
function handoff() {
  const base = makeServiceHandoff({ checkpointArtifactId: checkpoint });
  return { ...base, offer: { ...base.offer, job: { ...base.offer.job, extensions: [{
    namespace: "com.armyofagents.job/staged-input", schemaVersion: 1, critical: false as const,
    value: { files: requests.map((file) => ({ id: checkpoint, path: file.path, key: file.grant.objectKey,
      sha256: file.grant.expectedSha256, size: file.grant.maxBytes })) },
  }] } } };
}
describe("portable service state before process start", () => {
  it("imports verified object bytes before start and emits restored before instance start", async () => {
    const fake = createFakeSandboxProvider({ fileStagingMode: "grant_download", stagedObjects: objects,
      processSupervisionMode: "handle", processState: "exited", processExitCode: 0 });
    const original = fake.startProcess.bind(fake);
    fake.startProcess = vi.fn(async (...args: Parameters<typeof fake.startProcess>) => {
      expect(fake.stagedFiles()[statePath]).toBe(objects.state);
      expect(fake.stagedFiles()[markerPath]).toBe(objects.marker);
      return original(...args);
    });
    const sink = collectingSink();
    const supervisor = createSupervisor({ provider: fake, identity: SUPERVISOR_IDENTITY, eventSink: sink,
      redactionCanaries: [], resolveStagedFiles: async () => requests });
    await supervisor.accept(handoff());
    expect(fake.startProcess).toHaveBeenCalledTimes(1);
    const types = sink.events.map((event) => event.eventType);
    expect(types.indexOf("service_checkpoint_restored")).toBeLessThan(types.indexOf("service_instance_started"));
  });
  it("refuses checkpoint input when the required staging resolver is absent", async () => {
    const fake = createFakeSandboxProvider({ processSupervisionMode: "handle", processState: "exited" });
    const start = vi.spyOn(fake, "startProcess");
    const sink = collectingSink();
    await createSupervisor({ provider: fake, identity: SUPERVISOR_IDENTITY, eventSink: sink, redactionCanaries: [] }).accept(handoff());
    expect(start).not.toHaveBeenCalled();
    expect(sink.events.find((event) => event.eventType === "terminal")?.payload).toMatchObject({ errorCode: "service_checkpoint_unavailable" });
  });
  it("refuses corrupt download bytes before process start", async () => {
    const fake = createFakeSandboxProvider({ fileStagingMode: "grant_download", stagedObjects: { ...objects, state: '{"counter":99}' },
      processSupervisionMode: "handle", processState: "exited" });
    const start = vi.spyOn(fake, "startProcess");
    const sink = collectingSink();
    await createSupervisor({ provider: fake, identity: SUPERVISOR_IDENTITY, eventSink: sink, redactionCanaries: [],
      resolveStagedFiles: async () => requests }).accept(handoff());
    expect(start).not.toHaveBeenCalled();
    expect(sink.events.some((event) => event.eventType === "service_checkpoint_restored")).toBe(false);
  });
  it("exports JSON state after witnessed service exit and before terminal/destroy", async () => {
    const fake = createFakeSandboxProvider({ processSupervisionMode: "handle", processState: "exited", processExitCode: 0 });
    const sink = collectingSink();
    const sequencer = vi.fn(async (input: Parameters<NonNullable<import("../supervisor/supervisor.js").SupervisorDeps["exportArtifacts"]>>[0]) => {
      expect(fake.callCount("destroy")).toBe(0);
      expect(sink.events.map((event) => event.eventType)).toContain("service_instance_stopped");
      expect(sink.events.map((event) => event.eventType)).not.toContain("terminal");
      expect(input.requests).toEqual([{ path: "/home/user/aoa-output/state.json", kind: "service_checkpoint", contentType: "application/json", retention: "standard" }]);
      return { exported: [], failures: [] };
    });
    await createSupervisor({ provider: fake, identity: SUPERVISOR_IDENTITY, eventSink: sink, redactionCanaries: [],
      resolveExportArtifacts: async () => [
        { path: "/home/user/aoa-output/state.json", kind: "stdout", contentType: "text/plain", retention: "standard" },
        { path: "/home/user/aoa-output/../escape.json", kind: "stdout", contentType: "text/plain", retention: "standard" },
      ], exportArtifacts: sequencer }).accept(makeServiceHandoff());
    expect(sequencer).toHaveBeenCalledTimes(1);
  });

  it("does not export an unconfirmed service stop", async () => {
    const fake = createFakeSandboxProvider();
    const producer = vi.fn(async () => []);
    const sequencer = vi.fn(async () => ({ exported: [], failures: [] }));
    await createSupervisor({ provider: fake, identity: SUPERVISOR_IDENTITY, eventSink: collectingSink(), redactionCanaries: [],
      resolveExportArtifacts: producer, exportArtifacts: sequencer }).accept(makeServiceHandoff());
    expect(producer).not.toHaveBeenCalled();
    expect(sequencer).not.toHaveBeenCalled();
  });

});

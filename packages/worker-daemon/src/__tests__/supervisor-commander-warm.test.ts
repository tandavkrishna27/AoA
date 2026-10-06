import { describe, expect, it, vi } from "vitest";
import { createFakeSandboxProvider } from "./support/fake-provider.js";
import { createSupervisor } from "../supervisor/supervisor.js";
import type { CommanderWarmControl } from "../lease/commander-warm-control.js";
import { collectingSink, handoffLabels, makeHandoff, SUPERVISOR_IDENTITY } from "./support/supervisor-fixtures.js";
const sessionId = "00000000-0000-4000-8000-0000000000d1";
const turnId = "00000000-0000-4000-8000-0000000000c1";
const warmControl = { version: 1 as const, sessionId, generation: 1, mode: "create" as const,
  resourceId: null, idleTtlMs: 1800000 as const, historicalCanaries: ["old-private-key"] };
const capability = { v: 1, audience: "adapter-manager", ownedLabels: handoffLabels(), expiresAt: Date.now() + 60000, sig: "a".repeat(86) };
function handoff() {
  const base = makeHandoff();
  return makeHandoff({ job: { ...base.offer.job, source: { kind: "commander_turn", internalAgentRunId: turnId,
    conversationId: "00000000-0000-4000-8000-0000000000c2", requestedBy: { principalType: "user", principalId: "user" },
    executionPrincipal: { principalType: "system", principalId: "commander" } }, workload: { command: "node",
      args: ["/home/user/aoa-commander-warm-v1.cjs", "codex", "/home/user/aoa-commander-input.json", "/home/user/aoa-output/aoa-one-shot-result.json"],
      stdinArtifactId: null, maxRuntimeSeconds: 240 } } });
}
function setup(options: { failed?: boolean; signal?: string; checkpointError?: boolean; control?: CommanderWarmControl | undefined; restoreRefused?: boolean; failCheckpointLog?: boolean; capability?: typeof capability } = {}) {
  const fake = createFakeSandboxProvider({ optionalOperations: ["checkpoint", "restore"], checkpointMode: "snapshot", exitCode: options.failed ? 1 : 0,
    execSignal: options.signal, restoreResumed: !options.restoreRefused, seededResources: options.control?.mode === "resume" ? [{ sandboxId: options.control.resourceId!,
      labels: options.control.warmResourceCapability!.physicalLabels, hasLiveLease: false, state: "stopped" }] : [] });
  const create = vi.spyOn(fake, "create"); const execute = vi.spyOn(fake, "execute");
  const checkpoint = vi.spyOn(fake, "checkpoint");
  if (options.checkpointError) checkpoint.mockRejectedValue(new Error("checkpoint unavailable"));
  const sink = collectingSink();
  if (options.failCheckpointLog) {
    const original = sink.emit.bind(sink);
    sink.emit = async (event) => {
      if (event.eventType === "log" && JSON.stringify(event.payload).includes("aoa-commander-checkpoint-v1:")) throw new Error("durable sink unavailable");
      return original(event);
    };
  }

  const supervisor = createSupervisor({ makeRunProvider: () => fake, identity: SUPERVISOR_IDENTITY, eventSink: sink,
    materializeRunSecrets: async () => ({ env: { OPENAI_API_KEY: "fresh-private-key" }, canaries: ["fresh-private-key", "old-private-key"], capability: options.capability ?? capability,
      ...(!Object.hasOwn(options, "control") ? { warmControl } : options.control ? { warmControl: options.control } : {}) }) });
  return { fake, create, execute, checkpoint, sink, supervisor };
}
describe("Commander retained VM lifecycle through the actual supervisor", () => {
  it("creates without credentials, executes with fresh authority and checkpoints before successful terminal", async () => {
    const run = setup(); await run.supervisor.accept(handoff());
    expect(run.create.mock.calls[0][0].env).toEqual({});
    expect(run.create.mock.calls[0][1].deadlineMs).toBeGreaterThanOrEqual(1800000);
    expect(run.execute.mock.calls[0][0].env).toMatchObject({ OPENAI_API_KEY: "fresh-private-key", AOA_COMMANDER_WARM_TURN: turnId });
    expect(run.checkpoint).toHaveBeenCalledTimes(1);
    const checkpoint = run.sink.events.findIndex((event) => event.eventType === "log" && JSON.stringify(event.payload).includes("aoa-commander-checkpoint-v1:"));
    const terminal = run.sink.events.findIndex((event) => event.eventType === "terminal");
    expect(checkpoint).toBeGreaterThanOrEqual(0); expect(terminal).toBeGreaterThan(checkpoint);
    expect(run.sink.events[terminal].payload).toMatchObject({ status: "succeeded" });
    expect(run.fake.callCount("destroy")).toBe(0);
    expect(run.supervisor.activeRunCount()).toBe(0);
  });
  it("refuses the warm runner without protected warm metadata before create or execute", async () => {
    const run = setup({ control: undefined }); await run.supervisor.accept(handoff());
    expect(run.create).not.toHaveBeenCalled(); expect(run.execute).not.toHaveBeenCalled();
    expect(run.sink.events.at(-1)?.payload).toMatchObject({ status: "failed", errorCode: "warm_control_required" });
  });
  it("destroys failed execution and does not checkpoint or retain it", async () => {
    const run = setup({ failed: true }); await run.supervisor.accept(handoff());
    expect(run.checkpoint).not.toHaveBeenCalled(); expect(run.fake.callCount("destroy")).toBe(1);
  });
  it("does not retain a signalled execution even when its exit code is zero", async () => {
    const run = setup({ signal: "SIGTERM" });
    await run.supervisor.accept(handoff());
    expect(run.checkpoint).not.toHaveBeenCalled();
    expect(run.sink.events.at(-1)?.payload).toMatchObject({ status: "failed", errorCode: "exec_signalled" });
    expect(run.fake.callCount("destroy")).toBe(1);
  });
  it("fails and destroys when checkpoint is unavailable", async () => {
    const run = setup({ checkpointError: true }); await run.supervisor.accept(handoff());
    expect(run.sink.events.at(-1)?.payload).toMatchObject({ status: "failed", errorCode: "warm_checkpoint_failed" });
    expect(run.fake.callCount("destroy")).toBe(1);
  });
});

describe("Commander retained resource transfer and ledger failure", () => {
  const physical = { ...handoffLabels(), jobId: "00000000-0000-4000-8000-0000000000e1", leaseId: "00000000-0000-4000-8000-0000000000e2" };
  const resumed: CommanderWarmControl = { ...warmControl, generation: 2, mode: "resume", resourceId: "retained-vm",
    warmResourceCapability: { v: 1, audience: "adapter-manager-warm-resource", sessionId, generation: 2, resourceId: "retained-vm",
      physicalLabels: physical, ownedLabels: handoffLabels(), previousCapabilityExpiresAt: Date.now() - 10000,
      issuedAt: Date.now() - 5000, expiresAt: capability.expiresAt, sig: "a".repeat(86) } };
  it("resumes exactly the retained resource without creating a replacement and preserves physical labels", async () => {
    const run = setup({ control: resumed }); await run.supervisor.accept(handoff());
    expect(run.create).not.toHaveBeenCalled(); expect(run.fake.callCount("restore")).toBe(1);
    expect(run.execute.mock.calls[0][0].sandboxId).toBe("retained-vm");
    const log = run.sink.events.find((event) => event.eventType === "log" && JSON.stringify(event.payload).includes("aoa-commander-checkpoint-v1:"));
    const receipt = JSON.parse((log!.payload as { message: string }).message.slice("aoa-commander-checkpoint-v1:".length));
    expect(receipt).toMatchObject({ generation: 2, resourceId: "retained-vm", resourceLabels: physical });
    expect(run.fake.callCount("destroy")).toBe(0);
  });
  it("rejects a primary and resume grant for another job before any provider effect", async () => {
    const wrong = { ...capability, ownedLabels: { ...handoffLabels(), jobId: "00000000-0000-4000-8000-0000000000f1" } };
    const control: CommanderWarmControl = { ...resumed, warmResourceCapability: { ...resumed.warmResourceCapability!, ownedLabels: wrong.ownedLabels } };
    const run = setup({ control, capability: wrong }); await run.supervisor.accept(handoff());
    expect(run.create).not.toHaveBeenCalled(); expect(run.execute).not.toHaveBeenCalled();
    expect(run.fake.callCount("restore")).toBe(0);
    expect(run.sink.events.at(-1)?.payload).toMatchObject({ status: "failed", errorCode: "warm_control_required" });
  });

  it("does not execute or create a replacement after restore refusal and destroys the retained VM", async () => {
    const run = setup({ control: resumed, restoreRefused: true }); await run.supervisor.accept(handoff());
    expect(run.create).not.toHaveBeenCalled(); expect(run.execute).not.toHaveBeenCalled();
    expect(run.fake.callCount("destroy")).toBe(1);
  });
  it("does not emit a terminal past a failed checkpoint ledger write and reclaims the VM", async () => {
    const run = setup({ failCheckpointLog: true }); await run.supervisor.accept(handoff());
    expect(run.sink.events.some((event) => event.eventType === "terminal")).toBe(false);
    expect(run.fake.callCount("destroy")).toBe(1);
  });
});

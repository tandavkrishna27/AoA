import { describe, expect, it } from "vitest";
import { createFakeSandboxProvider } from "./support/fake-provider.js";
import { createSupervisor } from "../supervisor/supervisor.js";
import { collectingSink, makeGate, makeHandoff, SUPERVISOR_IDENTITY, waitFor } from "./support/supervisor-fixtures.js";
import { COMMANDER_STREAM_LOG_PREFIX } from "../supervisor/commander-live-output.js";
function commander() {
  const base = makeHandoff();
  return makeHandoff({ job: { ...base.offer.job, source: { kind: "commander_turn",
    internalAgentRunId: "00000000-0000-4000-8000-0000000000c1", conversationId: "00000000-0000-4000-8000-0000000000c2",
    requestedBy: { principalType: "user", principalId: "user" }, executionPrincipal: { principalType: "system", principalId: "commander" } },
    workload: { command: "node", args: ["/home/user/aoa-commander-runner.cjs", "claude", "/home/user/aoa-commander-input.json", "/home/user/aoa-output/aoa-one-shot-result.json"], stdinArtifactId: null, maxRuntimeSeconds: 240 } } });
}
describe("Commander live events through the actual supervisor", () => {
  it("persists scrubbed live logs before execute finishes and stops before terminal", async () => {
    const fake = createFakeSandboxProvider(); const original = fake.execute.bind(fake); const gate = makeGate();
    const provider = { ...fake, async execute(input: Parameters<typeof fake.execute>[0], context: Parameters<typeof fake.execute>[1]) {
      input.onStdout?.('{"delta":"split-'); input.onStdout?.('secret"}\n');
      await gate.gate; return original(input, context);
    } };
    const sink = collectingSink(); const supervisor = createSupervisor({ provider, identity: SUPERVISOR_IDENTITY,
      eventSink: sink, redactionCanaries: ["split-secret"] });
    const running = supervisor.accept(commander());
    try {
      await waitFor(() => sink.events.some((event) => event.eventType === "log"));
      const log = sink.events.find((event) => event.eventType === "log");
      expect(log?.payload).toMatchObject({ stream: "stdout" });
      expect(JSON.stringify(log)).toContain(COMMANDER_STREAM_LOG_PREFIX);
      expect(JSON.stringify(log)).not.toContain("split-secret");
      expect(sink.events.some((event) => event.eventType === "terminal")).toBe(false);
    } finally { gate.release(); await running; }
    expect(sink.events.at(-1)?.eventType).toBe("terminal");
    expect(sink.events.map((event) => event.seq)).toEqual(sink.events.map((_event, index) => index + 1));
  });
});

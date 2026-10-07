import { describe, expect, it } from "vitest";
import { decodeProcessSignal, decodeProcessStart, decodeProcessStatus } from "../codec.js";

describe("bounded process metadata projection", () => {
  it("drops provider extra fields from every process response", () => {
    expect(decodeProcessStart({ providerOpId: "op", handle: "pid:1", acknowledgedAt: 1, env: { TOKEN: "secret" } })).toEqual({ providerOpId: "op", handle: "pid:1", acknowledgedAt: 1 });
    expect(decodeProcessStatus({ providerOpId: "op", observation: { state: "running", observedAt: 2, stdout: "secret" }, stdout: "secret" })).toEqual({ providerOpId: "op", observation: { state: "running", observedAt: 2 } });
    expect(decodeProcessSignal({ providerOpId: "op", accepted: "accepted", observation: { state: "unknown", reason: "read_failed", error: "secret" } })).toEqual({ providerOpId: "op", accepted: "accepted", observation: { state: "unknown", reason: "read_failed" } });
  });
  it.each([null, {}, { handle: "", acknowledgedAt: 1 }, { handle: "x".repeat(513), acknowledgedAt: 1 }, { handle: "pid:1", acknowledgedAt: NaN }])("rejects malformed launch metadata %j", (input) => {
    expect(() => decodeProcessStart(input === null ? null : { providerOpId: "op", ...input })).toThrow();
  });
  it.each([{ state: "started", observedAt: 1 }, { state: "running", observedAt: Infinity }, { state: "unknown", reason: "unsupported" }, { state: "exited", observedAt: 1, exitCode: "0", signal: null }])("rejects an unobserved or malformed state %j", (observation) => {
    expect(() => decodeProcessStatus({ providerOpId: "op", observation })).toThrow();
  });
  it("never derives stopped state from signal acceptance", () => {
    expect(decodeProcessSignal({ providerOpId: "op", accepted: "accepted", observation: { state: "running", observedAt: 1 } }).observation.state).toBe("running");
    expect(() => decodeProcessSignal({ providerOpId: "op", accepted: "stopped", observation: { state: "gone", observedAt: 1 } })).toThrow();
  });
});

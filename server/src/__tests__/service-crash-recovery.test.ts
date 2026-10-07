import { describe, expect, it } from "vitest";
import { classifyServiceCrashRecovery, SERVICE_CRASH_POLICY } from "../services/service-crash-recovery.js";

describe("durable service crash policy", () => {
  const now = new Date("2026-10-07T00:00:00Z");
  it("starts without exits and expires the crash window", () => {
    expect(classifyServiceCrashRecovery([], now)).toEqual({ action: "restart" });
    expect(classifyServiceCrashRecovery([new Date(now.getTime() - SERVICE_CRASH_POLICY.windowMs - 1)], now))
      .toEqual({ action: "restart" });
  });
  it("doubles backoff using the latest durable exit, independent of order", () => {
    const recent = new Date(now.getTime() - 500);
    expect(classifyServiceCrashRecovery([recent, new Date(now.getTime() - 5_000)], now))
      .toEqual({ action: "wait", until: new Date(recent.getTime() + 2_000) });
  });
  it("allows the exact backoff boundary", () => {
    expect(classifyServiceCrashRecovery([new Date(now.getTime() - 1_000)], now))
      .toEqual({ action: "restart" });
  });
  it("pauses at the crash cap, without inventing a sixth placement", () => {
    expect(classifyServiceCrashRecovery(Array.from({ length: 5 }, () => now), now))
      .toEqual({ action: "pause" });
  });
});

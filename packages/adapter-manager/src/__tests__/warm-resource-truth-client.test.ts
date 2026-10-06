import { describe, expect, it, vi } from "vitest";
import type { ResourceSummary } from "@armyofagents/worker-daemon";
import { makeWarmResourceAcknowledger, makeWarmResourceResolveTruth } from "../warm-resource-truth-client.js";
const labels = { organizationId: "org", targetId: "target", workerId: "worker", jobId: "job", attempt: 1, leaseId: "lease", deviceGeneration: 1 };
const resource = (sandboxId: string): ResourceSummary => ({ sandboxId, resourceLabels: labels, generation: 1, state: "stopped", hasLiveLease: false });
function client(body: unknown, status = 200) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  const truth = makeWarmResourceResolveTruth({ baseUrl: "http://cp", bearer: "peer-only", fetch: fetchImpl,
    leaseTruth: async (resources) => new Map(resources.map((row) => [row.sandboxId, "orphan" as const])) });
  return { truth, fetchImpl };
}
describe("exact-resource retention client", () => {
  it("protects one VM while confirming a same-lease sibling as orphan", async () => {
    const run = client({ verdicts: [{ resourceId: "warm", physicalLabels: labels, verdict: "retained" },
      { resourceId: "sibling", physicalLabels: labels, verdict: "orphan" }] });
    const result = await run.truth([resource("warm"), resource("sibling")]);
    expect(result.get("warm")).toBe("live"); expect(result.get("sibling")).toBe("orphan");
  });
  it.each([{}, { verdicts: [] }, { verdicts: [{ resourceId: "vm", physicalLabels: { ...labels, leaseId: "foreign" }, verdict: "orphan" }] },
    { verdicts: [{ resourceId: "vm", physicalLabels: labels, verdict: "unexpected" }] },
    { verdicts: [{ resourceId: "vm", physicalLabels: labels, verdict: "orphan" }, { resourceId: "vm", physicalLabels: labels, verdict: "retained" }] }])("keeps malformed or competing truth unknown: %j", async (body) => {
    expect((await client(body).truth([resource("vm")])).get("vm")).toBe("unknown");
  });
  it("keeps older or unavailable peers unknown", async () => {
    expect((await client({}, 404).truth([resource("vm")])).get("vm")).toBe("unknown");
  });
  it("does not query resource truth for a live lease", async () => {
    const fetchImpl = vi.fn(); const truth = makeWarmResourceResolveTruth({ baseUrl: "http://cp", bearer: "peer-only", fetch: fetchImpl,
      leaseTruth: async () => new Map([["vm", "live"]]) });
    expect((await truth([resource("vm")])).get("vm")).toBe("live"); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("acknowledges only an exact true reply and sends no worker grant", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ resourceId: "vm", physicalLabels: labels, providerOpId: "op" });
      return new Response(JSON.stringify({ acknowledged: true }));
    });
    const ack = makeWarmResourceAcknowledger({ baseUrl: "http://cp", bearer: "peer-only", fetch: fetchImpl });
    expect(await ack({ resourceId: "vm", physicalLabels: labels, status: "confirmed", providerOpId: "op" })).toBe(true);
  });
});

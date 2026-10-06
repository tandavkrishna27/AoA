import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@armyofagents/db";
const seam = vi.hoisted(() => ({ truth: vi.fn(), reclaimed: vi.fn() }));
vi.mock("../services/commander-warm-resource-truth.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/commander-warm-resource-truth.js")>(),
  createCommanderWarmResourceTruth: () => seam,
}));
import { adapterManagerControlRoutes, TRUTH_ROUTE_ENABLED_ENV } from "../routes/adapter-manager-control.js";
import { TRUTH_SHARED_SECRET_ENV, TRUTH_SHARED_SECRET_HEADER } from "../routes/adapter-manager-control-auth.js";
import { DISTRIBUTED_EXECUTION_ENABLED_ENV } from "../config/distributed-execution.js";
import { errorHandler } from "../middleware/error-handler.js";
const labels = { organizationId: "00000000-0000-4000-8000-000000000001", targetId: "00000000-0000-4000-8000-000000000002",
  workerId: "00000000-0000-4000-8000-000000000003", jobId: "00000000-0000-4000-8000-000000000004", attempt: 1,
  leaseId: "00000000-0000-4000-8000-000000000005", deviceGeneration: 1 };
const resource = { resourceId: "vm", physicalLabels: labels };
function app() { const instance = express(); instance.use(express.json()); instance.use("/api", adapterManagerControlRoutes({ appDb: {} as Db })); instance.use(errorHandler); return instance; }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv(DISTRIBUTED_EXECUTION_ENABLED_ENV, "1"); vi.stubEnv(TRUTH_ROUTE_ENABLED_ENV, "1");
  vi.stubEnv(TRUTH_SHARED_SECRET_ENV, "fake-peer"); seam.truth.mockResolvedValue("retained"); seam.reclaimed.mockResolvedValue(false);
});
afterEach(() => vi.unstubAllEnvs());
describe.each(["resource-truth", "resource-reclaimed"])("authenticated warm peer route %s", (route) => {
  it.each(["distributed", "truth", "unset-peer", "wrong-peer"])("rejects %s before validation or domain reads", async (gate) => {
    if (gate === "distributed") vi.stubEnv(DISTRIBUTED_EXECUTION_ENABLED_ENV, "0");
    if (gate === "truth") vi.stubEnv(TRUTH_ROUTE_ENABLED_ENV, "0");
    if (gate === "unset-peer") vi.stubEnv(TRUTH_SHARED_SECRET_ENV, "");
    const response = await request(app()).post("/api/adapter-manager-control/" + route)
      .set(TRUTH_SHARED_SECRET_HEADER, gate === "wrong-peer" ? "wrong" : "fake-peer").send({ garbage: true });
    expect(response.status).toBe(404); expect(seam.truth).not.toHaveBeenCalled(); expect(seam.reclaimed).not.toHaveBeenCalled();
  });
});
describe("bounded warm resource peer contracts", () => {
  it("returns resource and all physical labels alongside the exact verdict", async () => {
    const response = await request(app()).post("/api/adapter-manager-control/resource-truth")
      .set(TRUTH_SHARED_SECRET_HEADER, "fake-peer").send({ resources: [resource] });
    expect(response.status).toBe(200); expect(response.body).toEqual({ verdicts: [{ ...resource, verdict: "retained" }] });
    expect(seam.truth).toHaveBeenCalledWith(resource);
  });
  it("does not claim acknowledgement before capability expiry", async () => {
    const receipt = { ...resource, providerOpId: "physical-success" };
    const response = await request(app()).post("/api/adapter-manager-control/resource-reclaimed")
      .set(TRUTH_SHARED_SECRET_HEADER, "fake-peer").send(receipt);
    expect(response.status).toBe(200); expect(response.body).toEqual({ acknowledged: false });
    expect(seam.reclaimed).toHaveBeenCalledWith(receipt);
  });
  it.each([{ resources: Array.from({ length: 129 }, () => resource) }, { resources: [{ ...resource, companyId: labels.organizationId }] },
    { resources: [{ ...resource, physicalLabels: { ...labels, attempt: 0 } }] }])("rejects over-bound or caller-expanded authority: %j", async (body) => {
    expect((await request(app()).post("/api/adapter-manager-control/resource-truth")
      .set(TRUTH_SHARED_SECRET_HEADER, "fake-peer").send(body)).status).toBe(400);
    expect(seam.truth).not.toHaveBeenCalled();
  });
});

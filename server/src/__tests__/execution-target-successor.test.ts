import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const { handoff, canOrg, audit } = vi.hoisted(() => ({
  handoff: vi.fn(), canOrg: vi.fn(async () => true), audit: vi.fn(),
}));
vi.mock("../services/organization-access.js", () => ({
  organizationAccessService: () => ({ canOrg }),
}));
vi.mock("../middleware/logger.js", () => ({
  logger: { info: audit, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../services/execution-targets.js", () => ({
  CanarySuccessorError: class CanarySuccessorError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  handoffCanaryExecutionTargetSuccessor: handoff,
}));

import { executionTargetRoutes } from "../routes/execution-targets.js";
import { errorHandler } from "../middleware/error-handler.js";

const ORG = "a6000000-0000-4000-8000-000000000001";
const OLD = "a6000000-0000-4000-8000-000000000003";
const NEXT = "a6000000-0000-4000-8000-000000000006";
const actor = { type: "board", source: "session", userId: "operator-9", companyIds: [] };
const appDb = {} as never;
const operatorDb = {} as never;

function makeApp(principal: unknown = actor, distributed = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { actor: unknown }).actor = principal; next(); });
  app.use("/api", executionTargetRoutes({ db: {} as never,
    ...(distributed ? { workerSession: { appDb, operatorDb, sessionSigningKey: "route-test-key" } } : {}),
  }));
  app.use(errorHandler);
  return app;
}

afterEach(() => { vi.clearAllMocks(); canOrg.mockResolvedValue(true); });

describe("explicit canary successor HTTP contract", () => {
  it("dispatches only the exact IDs through bounded roles and returns sanitized state", async () => {
    handoff.mockResolvedValue({ result: "handed_off", organizationId: ORG, retiredTargetId: OLD,
      successorTargetId: NEXT, retiredSlug: `retired-to-${NEXT}`, executionTargetSlug: "aoa-canary-e2b" });
    const response = await request(makeApp()).post(`/api/organizations/${ORG}/execution-targets/${OLD}/successor`)
      .send({ successorTargetId: NEXT });
    expect(response.status).toBe(200);
    expect(response.body.result).toBe("handed_off");
    expect(handoff).toHaveBeenCalledWith({ appDb, operatorDb, organizationId: ORG,
      retiredTargetId: OLD, successorTargetId: NEXT });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG, retiredTargetId: OLD, successorTargetId: NEXT,
      outcome: "handed_off", operatorUserId: "operator-9",
    }), expect.any(String));
  });

  it("refuses extra body authority and unauthorized organization actors before service mutation", async () => {
    const url = `/api/organizations/${ORG}/execution-targets/${OLD}/successor`;
    expect((await request(makeApp()).post(url).send({ successorTargetId: NEXT, slug: "other" })).status).toBe(400);
    expect(handoff).not.toHaveBeenCalled();
    canOrg.mockResolvedValue(false);
    expect((await request(makeApp()).post(url).send({ successorTargetId: NEXT })).status).toBe(403);
    expect(handoff).not.toHaveBeenCalled();
    canOrg.mockResolvedValue(true);
    expect((await request(makeApp(actor, false)).post(url).send({ successorTargetId: NEXT })).status).toBe(403);
    expect(handoff).not.toHaveBeenCalled();
  });
});

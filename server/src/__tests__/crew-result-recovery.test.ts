import { describe, expect, it, vi, beforeEach } from "vitest";
const { deliver, target, tenant, greaterThan } = vi.hoisted(() => ({
  deliver: vi.fn(), target: vi.fn(), tenant: vi.fn(), greaterThan: vi.fn(),
}));
vi.mock("@armyofagents/db", () => ({
  companies: { id: "company.id", organizationId: "company.organization" },
  internalAgentRuns: { id: "run.id", companyId: "run.company", status: "run.status" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args, eq: (...args: unknown[]) => args,
  asc: (value: unknown) => value, gt: greaterThan,
}));
vi.mock("../db/tenant-context.js", () => ({ runInTenant: tenant }));
vi.mock("../services/crew-result-relay.js", () => ({ deliverCrewRunResult: deliver }));
vi.mock("../services/job-accepted-output-projection.js", () => ({ loadAcceptedOutputTarget: target }));
vi.mock("../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));
import { createCrewResultRecovery } from "../services/crew-result-recovery.js";

const row = { runId: "run-1", companyId: "company-1", organizationId: "org-1",
  jobId: "job-1", issueId: "task-1", agentId: "agent-1" };
function fixture(pages: unknown[][]) {
  const limit = vi.fn(async () => pages.shift() ?? []);
  const select = vi.fn(() => ({ from: () => ({ innerJoin: () => ({ where: () => ({
    orderBy: () => ({ limit }),
  }) }) }) }));
  const ownerDb = { select };
  const appDb = {};
  tenant.mockImplementation(async (_db, _org, callback) => callback({}, appDb));
  return { recovery: createCrewResultRecovery({ ownerDb, appDb } as never), select, limit, ownerDb, appDb };
}
beforeEach(() => {
  vi.clearAllMocks();
  deliver.mockResolvedValue({ delivered: true });
  target.mockResolvedValue({ crewRunId: row.runId, issueId: row.issueId, assigneeAgentId: row.agentId });
});
describe("durable crew result recovery", () => {
  it("revalidates the real job through the tenant pool and delivers through the owner pool", async () => {
    const f = fixture([[row]]);
    await f.recovery.tick();
    expect(tenant).toHaveBeenCalledWith(f.appDb, "org-1", expect.any(Function));
    expect(target).toHaveBeenCalledWith(f.appDb, { organizationId: "org-1", companyId: "company-1", jobId: "job-1" });
    expect(deliver).toHaveBeenCalledWith({ db: f.ownerDb, companyId: "company-1", issueId: "task-1",
      runId: "run-1", agentId: "agent-1", refreshExisting: true });
  });
  it.each([null, { crewRunId: "other" }, { ...row, crewRunId: row.runId, assigneeAgentId: "foreign" }])(
    "never delivers an invalid durable binding: %j", async (binding) => {
      const f = fixture([[row]]); target.mockResolvedValue(binding);
      await f.recovery.tick(); expect(deliver).not.toHaveBeenCalled();
    });
  it("continues after an unreadable job and retries it on a later pass", async () => {
    const f = fixture([[row], [row]]);
    target.mockRejectedValueOnce(new Error("unreadable"));
    await f.recovery.tick(); expect(deliver).not.toHaveBeenCalled();
    await f.recovery.tick(); expect(deliver).toHaveBeenCalledTimes(1);
  });
  it("rotates beyond a full page and resets the cursor after the last page", async () => {
    const full = Array.from({ length: 32 }, (_, i) => ({ ...row, organizationId: null, runId: `run-${i}` }));
    const f = fixture([full, [], []]);
    await f.recovery.tick(); await f.recovery.tick(); await f.recovery.tick();
    expect(greaterThan).toHaveBeenCalledTimes(1);
    expect(greaterThan).toHaveBeenCalledWith("run.id", "run-31");
    expect(f.limit).toHaveBeenCalledTimes(3);
    expect(f.limit).toHaveBeenCalledWith(32);
  });
  it("shares one in-flight tick rather than scanning concurrently", async () => {
    const f = fixture([]);
    let resolve!: (rows: unknown[]) => void;
    f.limit.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const first = f.recovery.tick(); const second = f.recovery.tick();
    expect(first).toBe(second); expect(f.select).toHaveBeenCalledTimes(1);
    resolve([]); await first;
  });
});

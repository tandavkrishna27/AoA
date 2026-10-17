import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, companies, costEvents, createDb, organizations, type Db } from "@armyofagents/db";
import { costService } from "../services/costs.js";
import { startMigratedDatabase, type MigratedDatabase } from "./helpers/migrated-database.js";

const RUN = process.platform !== "win32" || process.env.AOA_RUN_WIN_INTEGRATION === "1";
const COST_CENTS = 37;

describe.skipIf(!RUN)("costService.createEvent idempotency against PostgreSQL", () => {
  let database: MigratedDatabase | undefined;
  let db: Db;
  let service: ReturnType<typeof costService>;
  let organizationId: string;
  let companyId: string;
  let otherCompanyId: string;
  let agentId: string;
  let otherAgentId: string;
  let foreignAgentId: string;

  beforeAll(async () => {
    database = await startMigratedDatabase({ label: "aoa-cost-idempotency-" });
    db = createDb(database.adminUrl);
    service = costService(db);
    organizationId = randomUUID();
    await db.insert(organizations).values({ id: organizationId, name: "Cost idempotency", slug: `cost-idempotency-${organizationId}` });
  }, 180_000);

  afterAll(async () => {
    try {
      await db?.$client.end({ timeout: 5 });
    } finally {
      await database?.teardown();
    }
  }, 60_000);

  beforeEach(async () => {
    companyId = randomUUID();
    otherCompanyId = randomUUID();
    agentId = randomUUID();
    otherAgentId = randomUUID();
    foreignAgentId = randomUUID();
    await db.insert(companies).values([
      { id: companyId, organizationId, name: "Cost company", issuePrefix: `C${companyId.replaceAll("-", "").slice(0, 12)}` },
      { id: otherCompanyId, organizationId, name: "Other cost company", issuePrefix: `C${otherCompanyId.replaceAll("-", "").slice(0, 12)}` },
    ]);
    await db.insert(agents).values([
      { id: agentId, companyId, name: "Cost agent" },
      { id: otherAgentId, companyId, name: "Other cost agent" },
      { id: foreignAgentId, companyId: otherCompanyId, name: "Foreign cost agent" },
    ]);
  });

  function eventData(eventAgentId: string, sourceIdempotencyKey: string) {
    return {
      agentId: eventAgentId,
      sourceIdempotencyKey,
      provider: "codex_local",
      model: "integration-model",
      inputTokens: 19,
      outputTokens: 11,
      costCents: COST_CENTS,
      occurredAt: new Date(),
    };
  }

  async function persistedSpend(eventCompanyId: string, eventAgentId: string) {
    const [company] = await db.select({ spent: companies.spentMonthlyCents }).from(companies).where(eq(companies.id, eventCompanyId));
    const [agent] = await db.select({ spent: agents.spentMonthlyCents }).from(agents).where(eq(agents.id, eventAgentId));
    return { company: company?.spent, agent: agent?.spent };
  }

  it("concurrent duplicate charges return one durable event and increment spend once", async () => {
    const data = eventData(agentId, `concurrent-cost-${randomUUID()}`);
    const results = await Promise.all(Array.from({ length: 4 }, () => service.createEvent(companyId, data, { deferBudgetEvaluation: true })));
    expect(new Set(results.map((event) => event.id)).size).toBe(1);
    const persisted = await db.select().from(costEvents).where(eq(costEvents.companyId, companyId));
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ id: results[0]!.id, companyId, agentId, sourceIdempotencyKey: data.sourceIdempotencyKey, costCents: COST_CENTS });
    expect(await persistedSpend(companyId, agentId)).toEqual({ company: COST_CENTS, agent: COST_CENTS });
  });

  it("the same source key creates independent charges in different companies", async () => {
    const sourceKey = `company-scoped-cost-${randomUUID()}`;
    const [first, second] = await Promise.all([
      service.createEvent(companyId, eventData(agentId, sourceKey), { deferBudgetEvaluation: true }),
      service.createEvent(otherCompanyId, eventData(foreignAgentId, sourceKey), { deferBudgetEvaluation: true }),
    ]);
    expect(first.id).not.toBe(second.id);
    const persisted = await db.select().from(costEvents).where(eq(costEvents.sourceIdempotencyKey, sourceKey));
    expect(persisted).toHaveLength(2);
    expect(new Set(persisted.map((event) => event.companyId))).toEqual(new Set([companyId, otherCompanyId]));
    expect(await persistedSpend(companyId, agentId)).toEqual({ company: COST_CENTS, agent: COST_CENTS });
    expect(await persistedSpend(otherCompanyId, foreignAgentId)).toEqual({ company: COST_CENTS, agent: COST_CENTS });
  });

  it("a duplicate company source key for another agent refuses without changing spend", async () => {
    const sourceKey = `agent-bound-cost-${randomUUID()}`;
    const first = await service.createEvent(companyId, eventData(agentId, sourceKey), { deferBudgetEvaluation: true });
    await expect(service.createEvent(companyId, eventData(otherAgentId, sourceKey), { deferBudgetEvaluation: true })).rejects.toMatchObject({ status: 422 });
    const persisted = await db.select().from(costEvents).where(eq(costEvents.companyId, companyId));
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ id: first.id, agentId });
    expect(await persistedSpend(companyId, agentId)).toEqual({ company: COST_CENTS, agent: COST_CENTS });
    expect(await persistedSpend(companyId, otherAgentId)).toEqual({ company: COST_CENTS, agent: 0 });
  });
});

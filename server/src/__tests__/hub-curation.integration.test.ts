/**
 * W4 curation metadata real-DB integration. Windows runs require
 * AOA_RUN_WIN_INTEGRATION=1; Linux CI remains authoritative.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "@armyofagents/db";
import { hubCurationService } from "../services/hub-curation.js";
import { hubItemsService } from "../services/hub-items.js";
import { startMigratedDatabase, type MigratedDatabase } from "./helpers/migrated-database.js";

const RUN = process.platform !== "win32" || process.env.AOA_RUN_WIN_INTEGRATION === "1";
let database: MigratedDatabase | undefined;
let db: Db;

function firstId(result: unknown): string {
  const id = Array.isArray(result)
    ? (result[0] as { id: string } | undefined)?.id
    : (result as { rows?: { id: string }[] }).rows?.[0]?.id;
  if (!id) throw new Error("firstId: no id returned from INSERT ... RETURNING id");
  return id;
}

beforeAll(async () => {
  database = await startMigratedDatabase({ label: "aoa-hub-curation-" });
  db = createDb(database.adminUrl);
}, 180_000);

afterAll(async () => {
  try {
    await db?.$client.end({ timeout: 5 });
  } finally {
    await database?.teardown();
  }
}, 60_000);

async function seedCompanyWithFounder(): Promise<{ companyId: string; founderId: string }> {
  const companyId = firstId(
    await db.execute(
      sql`INSERT INTO companies (organization_id, id, name, issue_prefix) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 'Hub Curation Co', upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))) RETURNING id`,
    ),
  );
  const founderId = firstId(
    await db.execute(
      sql`INSERT INTO "user" (id, email, name, email_verified, created_at, updated_at) VALUES (gen_random_uuid()::text, ${`f-${randomUUID()}@hub-curation.test`}, 'Founder', false, now(), now()) RETURNING id`,
    ),
  );
  await db.execute(
    sql`INSERT INTO company_memberships (id, company_id, principal_type, principal_id, membership_role, status, created_at, updated_at) VALUES (gen_random_uuid(), ${companyId}, 'user', ${founderId}, 'owner', 'active', now(), now())`,
  );
  await db.execute(sql`INSERT INTO user_roles (id, company_id, user_id, role) VALUES (gen_random_uuid(), ${companyId}, ${founderId}, 'founder')`);
  return { companyId, founderId };
}

describe.skipIf(!RUN)("hub curation service - real DB", () => {
  it("updates display-only curation metadata without changing lifecycle version", async () => {
    const { companyId, founderId } = await seedCompanyWithFounder();
    const item = await hubItemsService(db).emit({
      companyId,
      semanticType: "run_failed",
      sourceType: "heartbeat_run",
      sourceId: "curation-real-db",
      title: "failed run",
      ownerUserId: founderId,
    });

    const before = firstId(
      await db.execute(sql`SELECT version::text AS id FROM notifications WHERE id = ${item.id}`),
    );

    await hubCurationService(db, {
      now: () => new Date("2026-07-01T10:00:00.000Z"),
    }).updateSummary({
      companyId,
      hubItemId: item.id,
      expectedCurationRevision: 0,
      curationGroupLabel: "Failed runs",
      curationGroupSummary: "Provider rejected sk-ant-abc123DEF456ghi789.",
      curationReason: "SLA is due in 20 minutes.",
      curatedByAgentId: null,
    });

    const rows = await db.execute(sql`
      SELECT
        version,
        curation_revision,
        curation_group_label,
        curation_group_summary,
        curation_reason
      FROM notifications
      WHERE id = ${item.id}
    `);
    const row = Array.isArray(rows)
      ? (rows[0] as Record<string, unknown>)
      : (rows as { rows: Record<string, unknown>[] }).rows[0];

    expect(String(row.version)).toBe(before);
    expect(row.curation_revision).toBe(1);
    expect(row.curation_group_label).toBe("Failed runs");
    expect(row.curation_group_summary).toBe("Provider rejected ***REDACTED***.");
    expect(row.curation_reason).toBe("SLA is due in 20 minutes.");

    const audits = await db.execute(sql`
      SELECT actor_type, actor_id, action, entity_type, entity_id, agent_id, run_id, details
      FROM activity_log
      WHERE company_id = ${companyId} AND entity_id = ${item.id}
    `);
    const audit = Array.isArray(audits)
      ? (audits[0] as Record<string, unknown>)
      : (audits as { rows: Record<string, unknown>[] }).rows[0];
    expect(audit).toMatchObject({
      actor_type: "system",
      actor_id: "steward_sweep",
      action: "hub_item.curation_updated",
      entity_type: "hub_item",
      entity_id: item.id,
      agent_id: null,
      run_id: null,
      details: {
        source: "system_sweep",
        previousRevision: 0,
        curationRevision: 1,
        changedFields: ["curationGroupLabel", "curationGroupSummary", "curationReason"],
      },
    });
    expect(JSON.stringify(audit.details)).not.toContain("SLA is due");
  });

  it("audits agent writes with trusted run attribution and rolls back if the audit insert fails", async () => {
    const { companyId } = await seedCompanyWithFounder();
    const agentId = firstId(await db.execute(sql`
      INSERT INTO agents (company_id, name, kind) VALUES (${companyId}, 'Curation Agent', 'aoa') RETURNING id
    `));
    const runId = firstId(await db.execute(sql`
      INSERT INTO internal_agent_runs (company_id, agent_id, trigger_type, trigger_source)
      VALUES (${companyId}, ${agentId}, 'event', 'test') RETURNING id
    `));
    const item = await hubItemsService(db).emit({
      companyId,
      semanticType: "run_failed",
      sourceType: "heartbeat_run",
      sourceId: "curation-agent-real-db",
      title: "failed run",
    });
    const publishSpy = vi.spyOn(await import("../services/live-events.js"), "publishLiveEvent");
    publishSpy.mockClear();

    await hubCurationService(db).updateSummary({
      companyId,
      hubItemId: item.id,
      expectedCurationRevision: 0,
      curationGroupSummary: "Private summary text",
      curatedByAgentId: agentId,
      internalAgentRunId: runId,
    });

    const auditRows = await db.execute(sql`
      SELECT actor_type, actor_id, agent_id, run_id, details
      FROM activity_log
      WHERE company_id = ${companyId} AND entity_id = ${item.id}
    `);
    const audit = Array.isArray(auditRows)
      ? (auditRows[0] as Record<string, unknown>)
      : (auditRows as { rows: Record<string, unknown>[] }).rows[0];
    expect(audit).toMatchObject({
      actor_type: "agent",
      actor_id: agentId,
      agent_id: agentId,
      run_id: null,
      details: {
        source: "agent_tool",
        internalAgentRunId: runId,
        previousRevision: 0,
        curationRevision: 1,
        changedFields: ["curationGroupSummary"],
      },
    });
    expect(JSON.stringify(audit.details)).not.toContain("Private summary text");
    expect(publishSpy.mock.calls.map(([event]) => event.type)).toEqual([
      "activity.logged",
      "hub.item.changed",
    ]);

    publishSpy.mockClear();
    const otherAgentId = firstId(await db.execute(sql`
      INSERT INTO agents (company_id, name, kind) VALUES (${companyId}, 'Other Curation Agent', 'aoa') RETURNING id
    `));
    const otherRunId = firstId(await db.execute(sql`
      INSERT INTO internal_agent_runs (company_id, agent_id, trigger_type, trigger_source)
      VALUES (${companyId}, ${otherAgentId}, 'event', 'test') RETURNING id
    `));
    await expect(hubCurationService(db).updateSummary({
      companyId,
      hubItemId: item.id,
      expectedCurationRevision: 1,
      curationGroupSummary: "Should not persist",
      curatedByAgentId: agentId,
      internalAgentRunId: otherRunId,
    })).rejects.toMatchObject({ status: 422 });
    const unchanged = await db.execute(sql`SELECT curation_revision, curation_group_summary FROM notifications WHERE id = ${item.id}`);
    const unchangedRow = Array.isArray(unchanged)
      ? (unchanged[0] as Record<string, unknown>)
      : (unchanged as { rows: Record<string, unknown>[] }).rows[0];
    expect(unchangedRow).toMatchObject({ curation_revision: 1, curation_group_summary: "Private summary text" });
    expect(publishSpy).not.toHaveBeenCalled();

    await db.execute(sql`DELETE FROM activity_log WHERE action = 'hub_item.curation_updated'`);
    await db.execute(sql`ALTER TABLE activity_log ADD CONSTRAINT hub_curation_audit_failure CHECK (action <> 'hub_item.curation_updated')`);
    try {
      await expect(hubCurationService(db).updateSummary({
        companyId,
        hubItemId: item.id,
        expectedCurationRevision: 1,
        curationGroupLabel: "Must roll back",
        curatedByAgentId: agentId,
        internalAgentRunId: runId,
      })).rejects.toThrow();
    } finally {
      await db.execute(sql`ALTER TABLE activity_log DROP CONSTRAINT hub_curation_audit_failure`);
    }

    const current = await db.execute(sql`SELECT curation_revision, curation_group_label FROM notifications WHERE id = ${item.id}`);
    const currentRow = Array.isArray(current)
      ? (current[0] as Record<string, unknown>)
      : (current as { rows: Record<string, unknown>[] }).rows[0];
    expect(currentRow).toMatchObject({ curation_revision: 1, curation_group_label: null });
    expect(publishSpy).not.toHaveBeenCalled();
    publishSpy.mockRestore();
  });

  it("does not audit or publish a stale revision conflict", async () => {
    const { companyId, founderId } = await seedCompanyWithFounder();
    const item = await hubItemsService(db).emit({
      companyId,
      semanticType: "run_failed",
      sourceType: "heartbeat_run",
      sourceId: "curation-stale-real-db",
      title: "failed run",
      ownerUserId: founderId,
    });
    const publishSpy = vi.spyOn(await import("../services/live-events.js"), "publishLiveEvent");
    publishSpy.mockClear();

    await expect(hubCurationService(db).updateSummary({
      companyId,
      hubItemId: item.id,
      expectedCurationRevision: 1,
      curationGroupLabel: "Stale",
    })).rejects.toMatchObject({ status: 409 });

    const audits = await db.execute(sql`SELECT id FROM activity_log WHERE company_id = ${companyId} AND entity_id = ${item.id}`);
    expect(Array.isArray(audits) ? audits : (audits as { rows: unknown[] }).rows).toHaveLength(0);
    expect(publishSpy).not.toHaveBeenCalled();
    publishSpy.mockRestore();
  });

  it("records Commander curation as the authenticated user without an agent or run foreign key", async () => {
    const { companyId, founderId } = await seedCompanyWithFounder();
    const item = await hubItemsService(db).emit({
      companyId,
      semanticType: "run_failed",
      sourceType: "heartbeat_run",
      sourceId: "curation-commander-real-db",
      title: "failed run",
      ownerUserId: founderId,
    });

    await hubCurationService(db).updateSummary({
      companyId,
      hubItemId: item.id,
      expectedCurationRevision: 0,
      curationGroupSummary: "Founder-authored summary.",
      auditActor: { actorType: "user", actorId: founderId, source: "commander_tool" },
    });

    const audits = await db.execute(sql`
      SELECT actor_type, actor_id, action, agent_id, run_id, details
      FROM activity_log
      WHERE company_id = ${companyId} AND entity_id = ${item.id}
    `);
    const audit = Array.isArray(audits)
      ? (audits[0] as Record<string, unknown>)
      : (audits as { rows: Record<string, unknown>[] }).rows[0];
    expect(audit).toMatchObject({
      actor_type: "user",
      actor_id: founderId,
      action: "hub_item.curation_updated",
      agent_id: null,
      run_id: null,
      details: {
        source: "commander_tool",
        previousRevision: 0,
        curationRevision: 1,
        changedFields: ["curationGroupSummary"],
      },
    });
  });
});

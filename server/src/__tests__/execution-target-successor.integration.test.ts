import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalizeJsonV1 } from "@armyofagents/worker-protocol";
import { executionTargets } from "@armyofagents/db";
import { eq } from "drizzle-orm";
import { runInTenant } from "../db/tenant-context.js";
import { resolveCanaryCredentialBinding } from "../services/canary-credential-binding.js";
import { chooseExecutionTargetRow, type ExecutionTargetRow } from "../services/execution-target-resolver.js";
import { createExecutionTargetRevocationFanout } from "../services/execution-target-revocation-fanout.js";
import { createJobReconciliationService } from "../services/job-reconciliation.js";
import { CanarySuccessorError, handoffCanaryExecutionTargetSuccessor, revokeExecutionTarget } from "../services/execution-targets.js";
import { ORG, TARGET, setupJobControlFixture, type JobControlFixture } from "./helpers/job-control-fixture.js";

const SUCCESSOR = "a6000000-0000-4000-8000-000000000006";
const COLLISION = "a6000000-0000-4000-8000-000000000007";
const OTHER_ORG = "a6000000-0000-4000-8000-000000000010";
const OTHER_CANONICAL = "a6000000-0000-4000-8000-000000000011";
const OTHER_STAGING = "a6000000-0000-4000-8000-000000000012";
const integration = describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1");

integration("explicit canary successor handoff", () => {
  let fixture: JobControlFixture;
  let successorProfile: Record<string, unknown>;
  let providerProfile: Record<string, unknown>;
  let profileHash: string;
  beforeAll(async () => {
    fixture = await setupJobControlFixture("canary-successor");
    const [source] = await fixture.admin<{
      registered_profile: Record<string, unknown>;
      provider_constraint_profile: Record<string, unknown>;
    }[]>`SELECT registered_profile, provider_constraint_profile FROM execution_targets WHERE id = ${TARGET}`;
    successorProfile = { ...source.registered_profile, targetId: SUCCESSOR };
    providerProfile = source.provider_constraint_profile;
    profileHash = createHash("sha256").update(canonicalizeJsonV1(successorProfile)).digest("hex");
    await fixture.admin`INSERT INTO execution_targets
      (id, organization_id, slug, kind, trust_class, status, capabilities, config, scope,
       target_authority_key, device_generation, registered_profile, registered_profile_hash,
       provider_constraint_profile, last_seen_at)
      VALUES (${SUCCESSOR}, ${ORG}, 'w12-staging', 'dedicated_worker', 'dedicated_tenant', 'active', '{}', '{}',
        'organization', ${`organization:${ORG}`}, 1, ${successorProfile}, ${profileHash},
        ${providerProfile}, clock_timestamp())`;
  }, 180_000);
  afterAll(async () => { await fixture?.teardown(); }, 60_000);
  beforeEach(async () => {
    await fixture.resetRuntimeRows();
    await fixture.admin`DELETE FROM execution_target_revocations`;
    await fixture.admin`DELETE FROM execution_targets WHERE id = ${COLLISION}`;
    await fixture.admin`UPDATE execution_targets SET slug = 'w12-staging', status = 'active',
      device_generation = 1, registered_profile = ${successorProfile},
      registered_profile_hash = ${profileHash}, provider_constraint_profile = ${providerProfile}
      WHERE id = ${SUCCESSOR}`;
    await fixture.admin`UPDATE execution_targets SET slug = 'aoa-canary-e2b' WHERE id = ${TARGET}`;
  });

  async function completeCutoff(targetId = TARGET) {
    const cutoff = await revokeExecutionTarget({ appDb: fixture.app.db, operatorDb: fixture.operator.db,
      targetId, organizationId: ORG });
    expect(cutoff).toMatchObject({ revoked: true, revokedGeneration: 1 });
    const fanout = createExecutionTargetRevocationFanout({
      appDb: fixture.app.db, operatorDb: fixture.operator.db,
      reconciliation: createJobReconciliationService({ appDb: fixture.app.db }),
      listAdmittedOrganizationIds: async () => [ORG],
    });
    expect(await fanout.tick()).toMatchObject({ completed: 1 });
  }

  const transfer = (successorTargetId = SUCCESSOR, retiredTargetId = TARGET) =>
    handoffCanaryExecutionTargetSuccessor({ appDb: fixture.app.db, operatorDb: fixture.operator.db,
      organizationId: ORG, retiredTargetId, successorTargetId });

  async function chooseCanary() {
    const rows = await fixture.admin<ExecutionTargetRow[]>`
      SELECT id, slug, kind, status FROM execution_targets
      WHERE organization_id = ${ORG} AND id IN (${TARGET}, ${SUCCESSOR})`;
    const binding = resolveCanaryCredentialBinding();
    return chooseExecutionTargetRow({ credentialKind: binding.credentialKind,
      pinnedTargetId: binding.pinnedTargetId, executionTargetSlug: binding.executionTargetSlug,
      targets: rows });
  }

  it("hands the canonical slug from a truly completed retired target to a ratified successor", async () => {
    await completeCutoff();
    const [revokeRow] = await fixture.admin<{ status: string; revoked_generation: number }[]>`
      SELECT status, revoked_generation FROM execution_target_revocations WHERE target_id = ${TARGET}`;
    expect(revokeRow).toMatchObject({ status: "completed", revoked_generation: 1 });
    const [retiredRow] = await fixture.admin<{ status: string; device_generation: number }[]>`
      SELECT status, device_generation FROM execution_targets WHERE id = ${TARGET}`;
    expect(retiredRow).toMatchObject({ status: "disabled", device_generation: 2 });
    expect(await chooseCanary()).toBeNull();
    const result = await transfer();
    expect(result).toMatchObject({ result: "handed_off", retiredTargetId: TARGET,
      successorTargetId: SUCCESSOR, retiredSlug: `retired-to-${SUCCESSOR}`,
      executionTargetSlug: "aoa-canary-e2b" });
    const rows = await fixture.admin<{ id: string; slug: string; status: string; device_generation: number }[]>`
      SELECT id, slug, status, device_generation FROM execution_targets WHERE id IN (${TARGET}, ${SUCCESSOR}) ORDER BY id`;
    expect(rows).toEqual([
      { id: TARGET, slug: `retired-to-${SUCCESSOR}`, status: "disabled", device_generation: 2 },
      { id: SUCCESSOR, slug: "aoa-canary-e2b", status: "active", device_generation: 1 },
    ]);
    expect((await chooseCanary())?.id).toBe(SUCCESSOR);
    const [beforeRetry] = await fixture.admin<{ updated_at: Date }[]>`
      SELECT updated_at FROM execution_targets WHERE id = ${SUCCESSOR}`;
    expect((await transfer()).result).toBe("already_current");
    const [afterRetry] = await fixture.admin<{ updated_at: Date }[]>`
      SELECT updated_at FROM execution_targets WHERE id = ${SUCCESSOR}`;
    expect(afterRetry.updated_at).toEqual(beforeRetry.updated_at);
  }, 120_000);

  it("refuses a disabled predecessor with no completed durable receipt", async () => {
    await fixture.admin`UPDATE execution_targets SET status = 'disabled', device_generation = 2 WHERE id = ${TARGET}`;
    await expect(transfer()).rejects.toMatchObject({ code: "invalid_lifecycle" } satisfies Partial<CanarySuccessorError>);
    const [old] = await fixture.admin<{ slug: string }[]>`SELECT slug FROM execution_targets WHERE id = ${TARGET}`;
    expect(old.slug).toBe("aoa-canary-e2b");
  });

  it("requires a completed receipt, not merely pending fanout", async () => {
    await revokeExecutionTarget({ appDb: fixture.app.db, operatorDb: fixture.operator.db,
      targetId: TARGET, organizationId: ORG });
    await expect(transfer()).rejects.toMatchObject({ code: "invalid_lifecycle" });
    const [old] = await fixture.admin<{ slug: string }[]>`SELECT slug FROM execution_targets WHERE id = ${TARGET}`;
    expect(old.slug).toBe("aoa-canary-e2b");
  });

  it.each([
    ["unratified", "UPDATE execution_targets SET registered_profile = NULL, registered_profile_hash = NULL, provider_constraint_profile = NULL WHERE id = $1"],
    ["bad stored hash", "UPDATE execution_targets SET registered_profile_hash = repeat('f', 64) WHERE id = $1"],
    ["inactive", "UPDATE execution_targets SET status = 'offline' WHERE id = $1"],
  ])("rejects a %s successor without moving either slug", async (_label, statement) => {
    await completeCutoff();
    await fixture.admin.unsafe(statement, [SUCCESSOR]);
    await expect(transfer()).rejects.toMatchObject({ code: expect.stringMatching(/^invalid_(?:profile|lifecycle)$/) });
    const rows = await fixture.admin<{ id: string; slug: string }[]>`
      SELECT id, slug FROM execution_targets WHERE id IN (${TARGET}, ${SUCCESSOR}) ORDER BY id`;
    expect(rows).toEqual([{ id: TARGET, slug: "aoa-canary-e2b" },
      { id: SUCCESSOR, slug: "w12-staging" }]);
  });

  it("rejects an archive slug occupied by a third retained target", async () => {
    await completeCutoff();
    await fixture.admin`INSERT INTO execution_targets
      (id, organization_id, slug, kind, trust_class, status, capabilities, config, scope, target_authority_key)
      VALUES (${COLLISION}, ${ORG}, ${`retired-to-${SUCCESSOR}`}, 'dedicated_worker',
        'dedicated_tenant', 'disabled', '{}', '{}', 'organization', ${`organization:${ORG}`})`;
    await expect(transfer()).rejects.toMatchObject({ code: "conflict" });
    const [old] = await fixture.admin<{ slug: string }[]>`SELECT slug FROM execution_targets WHERE id = ${TARGET}`;
    expect(old.slug).toBe("aoa-canary-e2b");
  });

  it("rejects revoked-profile and bad-provider-digest successors", async () => {
    await completeCutoff();
    const revoked = { ...successorProfile, revokedAt: new Date().toISOString() };
    const revokedHash = createHash("sha256").update(canonicalizeJsonV1(revoked)).digest("hex");
    await fixture.admin`UPDATE execution_targets SET registered_profile = ${revoked},
      registered_profile_hash = ${revokedHash} WHERE id = ${SUCCESSOR}`;
    await expect(transfer()).rejects.toMatchObject({ code: "invalid_profile" });
    await fixture.admin`UPDATE execution_targets SET registered_profile = ${successorProfile},
      registered_profile_hash = ${profileHash},
      provider_constraint_profile = ${{ ...providerProfile, digest: "0".repeat(64) }} WHERE id = ${SUCCESSOR}`;
    await expect(transfer()).rejects.toMatchObject({ code: "invalid_profile" });
    const [old] = await fixture.admin<{ slug: string }[]>`SELECT slug FROM execution_targets WHERE id = ${TARGET}`;
    expect(old.slug).toBe("aoa-canary-e2b");
  });

  it("keeps missing and foreign IDs uniformly not found", async () => {
    await completeCutoff();
    await fixture.admin`INSERT INTO organizations (id, name, slug)
      VALUES (${OTHER_ORG}, 'W12 foreign org', 'w12-foreign-org')`;
    for (const [targetId, slug] of [
      [OTHER_CANONICAL, "aoa-canary-e2b"], [OTHER_STAGING, "w12-staging"],
    ] as const) {
      const profile = { ...successorProfile, targetId, organizationId: OTHER_ORG };
      const hash = createHash("sha256").update(canonicalizeJsonV1(profile)).digest("hex");
      await fixture.admin`INSERT INTO execution_targets
        (id, organization_id, slug, kind, trust_class, status, capabilities, config, scope,
         target_authority_key, device_generation, registered_profile, registered_profile_hash,
         provider_constraint_profile, last_seen_at)
        VALUES (${targetId}, ${OTHER_ORG}, ${slug}, 'dedicated_worker', 'dedicated_tenant', 'active', '{}', '{}',
          'organization', ${`organization:${OTHER_ORG}`}, 1, ${profile}, ${hash},
          ${providerProfile}, clock_timestamp())`;
    }
    const snapshot = async () => fixture.admin<{ id: string; organization_id: string; slug: string;
      status: string; device_generation: number }[]>`
      SELECT id, organization_id, slug, status, device_generation FROM execution_targets
      WHERE id IN (${TARGET}, ${SUCCESSOR}, ${OTHER_CANONICAL}, ${OTHER_STAGING}) ORDER BY id`;
    const before = await snapshot();
    expect(before.find((row) => row.id === OTHER_CANONICAL)?.slug).toBe("aoa-canary-e2b");
    expect(before.find((row) => row.id === OTHER_STAGING)?.slug).toBe("w12-staging");
    const absent = "a6000000-0000-4000-8000-000000000099";
    await expect(transfer(absent)).rejects.toMatchObject({ code: "not_found" });
    await expect(transfer(SUCCESSOR, absent)).rejects.toMatchObject({ code: "not_found" });
    await expect(transfer(OTHER_STAGING)).rejects.toMatchObject({ code: "not_found" });
    await expect(transfer(SUCCESSOR, OTHER_CANONICAL)).rejects.toMatchObject({ code: "not_found" });
    await expect(transfer(TARGET, TARGET)).rejects.toMatchObject({ code: "invalid_input" });
    const changed = await runInTenant(fixture.app.db, ORG, async (_repos, tx) =>
      tx.update(executionTargets).set({ slug: "foreign-write-must-not-happen" })
        .where(eq(executionTargets.id, OTHER_STAGING)).returning({ id: executionTargets.id }));
    expect(changed).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("grants only app slug-column update and keeps table/other fields and operator update denied", async () => {
    const [privileges] = await fixture.admin<{
      app_slug: boolean; app_table: boolean; app_kind: boolean; operator_slug: boolean;
    }[]>`SELECT
      has_column_privilege('aoa_app', 'public.execution_targets', 'slug', 'UPDATE') AS app_slug,
      has_table_privilege('aoa_app', 'public.execution_targets', 'UPDATE') AS app_table,
      has_column_privilege('aoa_app', 'public.execution_targets', 'kind', 'UPDATE') AS app_kind,
      has_column_privilege('aoa_operator', 'public.execution_targets', 'slug', 'UPDATE') AS operator_slug`;
    expect(privileges).toEqual({ app_slug: true, app_table: false, app_kind: false, operator_slug: false });
  });

  it("retains A and B after A->B->C and never claims A->B is still current", async () => {
    await completeCutoff();
    expect((await transfer()).result).toBe("handed_off");
    const thirdProfile = { ...successorProfile, targetId: COLLISION };
    const thirdHash = createHash("sha256").update(canonicalizeJsonV1(thirdProfile)).digest("hex");
    await fixture.admin`INSERT INTO execution_targets
      (id, organization_id, slug, kind, trust_class, status, capabilities, config, scope,
       target_authority_key, device_generation, registered_profile, registered_profile_hash,
       provider_constraint_profile, last_seen_at)
      VALUES (${COLLISION}, ${ORG}, 'w12-third', 'dedicated_worker', 'dedicated_tenant', 'active', '{}', '{}',
        'organization', ${`organization:${ORG}`}, 1, ${thirdProfile}, ${thirdHash},
        ${providerProfile}, clock_timestamp())`;
    await completeCutoff(SUCCESSOR);
    expect((await transfer(COLLISION, SUCCESSOR)).result).toBe("handed_off");
    await expect(transfer()).rejects.toMatchObject({ code: "invalid_lifecycle" });
    const rows = await fixture.admin<{ id: string; slug: string; status: string }[]>`
      SELECT id, slug, status FROM execution_targets WHERE id IN (${TARGET}, ${SUCCESSOR}, ${COLLISION}) ORDER BY id`;
    expect(rows).toEqual([
      { id: TARGET, slug: `retired-to-${SUCCESSOR}`, status: "disabled" },
      { id: SUCCESSOR, slug: `retired-to-${COLLISION}`, status: "disabled" },
      { id: COLLISION, slug: "aoa-canary-e2b", status: "active" },
    ]);
  });

  it("serializes competing successors and leaves one canonical target", async () => {
    await completeCutoff();
    const thirdProfile = { ...successorProfile, targetId: COLLISION };
    const thirdHash = createHash("sha256").update(canonicalizeJsonV1(thirdProfile)).digest("hex");
    await fixture.admin`INSERT INTO execution_targets
      (id, organization_id, slug, kind, trust_class, status, capabilities, config, scope,
       target_authority_key, device_generation, registered_profile, registered_profile_hash,
       provider_constraint_profile, last_seen_at)
      VALUES (${COLLISION}, ${ORG}, 'w12-third', 'dedicated_worker', 'dedicated_tenant', 'active', '{}', '{}',
        'organization', ${`organization:${ORG}`}, 1, ${thirdProfile}, ${thirdHash},
        ${providerProfile}, clock_timestamp())`;
    let release!: () => void;
    let acquired!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<void>((resolve) => { acquired = resolve; });
    const blocker = runInTenant(fixture.app.db, ORG, async (_repos, tx) => {
      await tx.select({ id: executionTargets.id }).from(executionTargets)
        .where(eq(executionTargets.id, TARGET)).for("update");
      acquired();
      await hold;
    });
    await locked;
    const contenders = Promise.allSettled([transfer(SUCCESSOR), transfer(COLLISION)]);
    try {
      let waiters = 0;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const [row] = await fixture.admin<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE usename = 'aoa_app' AND wait_event_type = 'Lock'`;
        waiters = row.count;
        if (waiters >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiters).toBeGreaterThanOrEqual(2);
    } finally {
      release();
      await blocker;
    }
    const outcomes = await contenders;
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected" &&
      outcome.reason instanceof CanarySuccessorError && outcome.reason.code === "conflict")).toHaveLength(1);
    const [canonical] = await fixture.admin<{ count: number }[]>`
      SELECT count(*)::int AS count FROM execution_targets
      WHERE organization_id = ${ORG} AND slug = 'aoa-canary-e2b' AND status = 'active'`;
    expect(canonical.count).toBe(1);
  }, 120_000);

  it("hands off with the opposite target UUID order", async () => {
    await fixture.admin`UPDATE execution_targets SET slug = 'w12-old-staging' WHERE id = ${TARGET}`;
    await fixture.admin`UPDATE execution_targets SET slug = 'aoa-canary-e2b' WHERE id = ${SUCCESSOR}`;
    await completeCutoff(SUCCESSOR);
    const result = await transfer(TARGET, SUCCESSOR);
    expect(result).toMatchObject({ result: "handed_off", retiredTargetId: SUCCESSOR,
      successorTargetId: TARGET, retiredSlug: `retired-to-${TARGET}` });
    const rows = await fixture.admin<{ id: string; slug: string }[]>`
      SELECT id, slug FROM execution_targets WHERE id IN (${TARGET}, ${SUCCESSOR}) ORDER BY id`;
    expect(rows).toEqual([
      { id: TARGET, slug: "aoa-canary-e2b" },
      { id: SUCCESSOR, slug: `retired-to-${TARGET}` },
    ]);
  }, 120_000);
});

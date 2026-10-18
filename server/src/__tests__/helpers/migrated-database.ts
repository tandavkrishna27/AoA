// server/src/__tests__/helpers/migrated-database.ts
//
// The MINIMAL embedded-Postgres bootstrap for suites that need a real, fully-migrated
// database and a real non-owner `aoa_app` connection — nothing more.
//
// `distributed-execution-db-startup.integration.test.ts` has a bootstrap too, but its
// `beforeAll` is entangled with three extra databases and a legacy table-owner role
// because its own assertions need them. Copying that wholesale into a suite that needs
// one database is how a second, subtly-divergent bootstrap gets written. This is the
// shared one: start it, use it, tear it down.
//
// Callers are responsible for skipping on Windows without AOA_RUN_WIN_INTEGRATION=1
// (embedded-postgres cannot start on the `runneradmin` CI runner — Issue #114).

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres, { type Sql } from "postgres";
import {
  applyPendingMigrations,
  createTenantAppDbConnection,
  type Db,
  type NonOwnerDbConnection,
} from "@armyofagents/db";
import { provisionTenantAppRoleLoginSql } from "../../db/rls-tenant.js";
import { allocateEmbeddedPgPort } from "./embedded-pg-port.js";
import { createOwnedEmbeddedPostgres } from "./owned-embedded-postgres.js";

export type MigratedDatabase = {
  /** Superuser/owner client. Seed through this — migrations run as the database owner. */
  readonly admin: Sql;
  /** Drizzle Db on the NON-OWNER `aoa_app` login role. Read through this. */
  readonly appDb: Db;
  /**
   * Drizzle Db on the NON-OWNER `aoa_operator` login role. ROUND 7 — the canary preflight's
   * definer functions grant EXECUTE to this role only, so the gate's own reads run here while
   * `appDb` stays the pool that must be DENIED.
   */
  readonly operatorDb: Db;
  /**
   * The connection URLs behind `admin` / `operatorDb`. ADDITIVE, for suites that must drive
   * a real OPERATOR ENTRYPOINT as a subprocess — a CLI takes a DATABASE_URL, not a Db, and
   * proving that a `current_user` gate discriminates requires connecting as BOTH roles.
   */
  readonly adminUrl: string;
  readonly operatorUrl: string;
  readonly teardown: () => Promise<void>;
};

export async function startMigratedDatabase(
  options: { label?: string; appPassword?: string; operatorPassword?: string } = {},
): Promise<MigratedDatabase> {
  const label = options.label ?? "aoa-migrated-db-";
  const password = options.appPassword ?? "migrated-database-app-password";
  const operatorPassword = options.operatorPassword ?? "migrated-database-operator-password";
  const dataDir = await mkdtemp(join(tmpdir(), label));
  const port = await allocateEmbeddedPgPort();
  const embedded = await createOwnedEmbeddedPostgres(join(dataDir, "db"), port);
  let admin: Sql | null = null;
  let app: NonOwnerDbConnection | null = null;
  let operator: NonOwnerDbConnection | null = null;
  let disposal: Promise<void> | undefined;
  const teardown = () => disposal ??= (async () => {
    const errors: unknown[] = [];
    for (const cleanup of [
      () => operator?.close({ timeoutSeconds: 5 }),
      () => app?.close({ timeoutSeconds: 5 }),
      () => admin?.end({ timeout: 5 }),
      () => embedded.stop(),
    ]) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length === 0) {
      try { await rm(dataDir, { recursive: true, force: true }); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, `Migrated fixture cleanup failed; inspect retained directory: ${dataDir}`);
  })();
  try {
    await embedded.initialise();
    await embedded.start();
    const adminUrl = `postgres://test:test@127.0.0.1:${port}/postgres`;
    await applyPendingMigrations(adminUrl);
    admin = postgres(adminUrl, { max: 2 });
    await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_app", password));
    app = createTenantAppDbConnection(adminUrl.replace("test:test", `aoa_app:${password}`), {
      max: 4,
    });
    // `provisionTenantAppRoleLoginSql` is role-generic (it runs assertSafeRoleName), and
    // `aoa_operator` is created unconditionally by migration 0213, so this only attaches a
    // login. ROUND 7 needs it because the definer EXECUTE grant now lives on this role.
    await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_operator", operatorPassword));
    const operatorUrl = adminUrl.replace("test:test", `aoa_operator:${operatorPassword}`);
    operator = createTenantAppDbConnection(operatorUrl, { max: 4 });
    return {
      admin,
      appDb: app.db,
      operatorDb: operator.db,
      adminUrl,
      operatorUrl,
      teardown,
    };
  } catch (error) {
    try {
      await teardown();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Migrated fixture setup and cleanup failed; inspect retained directory: ${dataDir}`);
    }
    throw error;
  }
}

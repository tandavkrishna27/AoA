#!/usr/bin/env tsx
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertNonOwnerConnection, createTenantAppDbConnection } from "@armyofagents/db";
import { loadConfig } from "../config.js";
import { createStorageProviderFromConfig } from "../storage/provider-registry.js";
import { reconcileRecoveredArtifacts } from "../services/disaster-recovery/artifact-quarantine.js";

export function parseRecoveryArguments(argv: readonly string[]) {
  let organizationId: string | undefined;
  let companyId: string | undefined;
  let offline = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--offline" && !offline) offline = true;
    else if (argv[i] === "--organization" && !organizationId) organizationId = argv[++i];
    else if (argv[i] === "--company" && !companyId) companyId = argv[++i];
    else throw new Error("Invalid recovery command arguments");
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!offline || !organizationId || !companyId || !uuid.test(organizationId) || !uuid.test(companyId)) {
    throw new Error("Usage: --offline --organization <uuid> --company <uuid>");
  }
  return { organizationId, companyId };
}

/** Shared by the operator command and its real database regression. No owner fallback. */
export async function executeArtifactRecovery(input: Omit<Parameters<typeof reconcileRecoveredArtifacts>[0], "appDb"> & {
  appDatabaseUrl: string;
}) {
  const connection = createTenantAppDbConnection(input.appDatabaseUrl, { max: 2, statementTimeoutMs: 60_000 });
  try {
    await assertNonOwnerConnection(connection.db, "aoa_app");
    return await reconcileRecoveredArtifacts({ ...input, appDb: connection.db });
  } finally { await connection.close({ timeoutSeconds: 5 }); }
}

/** --offline is an operator assertion, not automatic network isolation. Keep
 * control-plane serving, workers and all object writers stopped; isolate or
 * expire outstanding signed object grants. This command never resumes them. */
async function main() {
  const scope = parseRecoveryArguments(process.argv.slice(2));
  const config = loadConfig();
  const databaseUrl = process.env.AOA_APP_DATABASE_URL;
  if (!databaseUrl) throw new Error("Explicit AOA_APP_DATABASE_URL is required");
  const result = await executeArtifactRecovery({ ...scope, appDatabaseUrl: databaseUrl,
    actorId: "recovery-operator", storage: createStorageProviderFromConfig(config) });
  console.log(JSON.stringify({ ...scope, verdict: result.verdict, inspected: result.objects.length,
    verified: result.promoted.length, blockedArtifactIds: result.blockedArtifactIds,
    objects: result.objects.map(({ id, disposition }) => ({ id, disposition })),
    servicesRemainStopped: true }));
  process.exitCode = result.verdict === "recovered" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(() => {
    // Storage/driver errors can include URLs, credentials or request headers.
    // Fail non-zero without printing their unsanitized messages.
    console.error("Recovered artifact reconciliation failed; keep services stopped. Check scope, credentials, migrations and recovered storage.");
    process.exitCode = 1;
  });
}

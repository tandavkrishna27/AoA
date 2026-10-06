import { and, eq } from "drizzle-orm";
import {
  companyMemberships, type Db,
} from "@armyofagents/db";
import type { JobPlacementServiceDependencies } from "./job-placement.js";
import { CANARY_EXECUTION_TARGET_SLUG, resolveCanaryCredentialBinding } from "./canary-credential-binding.js";
import {
  candidateMatchesScope, candidatePassesStaticGates, orderCandidates, ProviderUnavailableError,
  type CandidateRow, type ResolveArgs,
} from "./provider-resolution.js";
import { loadCommanderJobAuthority } from "./commander-job-authority.js";
import { buildResolveDeps } from "./provider-resolution-deps.js";
import type { CliAuthTopology } from "./cli-auth-topology.js";

type RoutingInput = Parameters<JobPlacementServiceDependencies["resolveCredentialBinding"]>[0];
export interface CommanderCredentialSource {
  userId: string;
  provider: string;
  adapterType: string;
}
interface RoutingDependencies {
  loadCommanderSource(input: RoutingInput): Promise<CommanderCredentialSource | null>;
  loadCandidates(input: RoutingInput, source: CommanderCredentialSource): Promise<CandidateRow[]>;
  ownerMembershipActive(companyId: string, ownerUserId: string): Promise<boolean>;
}

/** Metadata only. Secret material and personal auth homes never enter placement. */
export function createJobCredentialRoutingResolver(deps: RoutingDependencies): JobPlacementServiceDependencies["resolveCredentialBinding"] {
  return async (input) => {
    // Preserve the exact historical key set and digest for already placed M1 runs.
    if (input.sourceKind === "task_run" || input.sourceKind === "crew_run" || input.sourceKind === "one_shot") return resolveCanaryCredentialBinding();
    const unavailable = (reason: string, source?: CommanderCredentialSource) =>
      new ProviderUnavailableError(source?.provider ?? "unknown", reason, null);
    if (input.sourceKind !== "commander_turn") throw unavailable("source_not_supported");
    const source = await deps.loadCommanderSource(input);
    if (!source) throw unavailable("source_authority_missing");
    if (!await deps.ownerMembershipActive(input.companyId, source.userId)) {
      throw unavailable("credential_owner_inactive", source);
    }
    const eligible = orderCandidates(await deps.loadCandidates(input, source)).filter((row) => {
      if (row.connectionOrganizationId && row.connectionOrganizationId !== input.organizationId) return false;
      if (row.connectionCompanyId && row.connectionCompanyId !== input.companyId) return false;
      if (!candidateMatchesScope(row, { agentId: null, organizationId: input.organizationId })) return false;
      if (row.scopeType === "agent_override") return false;
      if (row.scopeType === "personal_execution_default" && row.scopeId !== source.userId) return false;
      if (!candidatePassesStaticGates({ ...row, actorKind: "commander", requestCompanyId: input.companyId,
        requestOwnerUserId: source.userId }).ok) return false;
      return row.authMethod === "personal_subscription"
        ? Boolean(row.executionTargetId && row.connectionOwnerUserId === source.userId)
        : Boolean(row.secretRef);
    });
    const selected = eligible[0];
    if (!selected) throw unavailable("no_authorized_assignment", source);
    if (selected.authMethod === "personal_subscription") {
      if (eligible.filter((row) => row.authMethod === "personal_subscription" &&
        row.scopeType === selected.scopeType && row.priority === selected.priority).length !== 1) {
        throw unavailable("binding_ambiguous", source);
      }
      return {
        credentialId: selected.connectionId, credentialKind: "personal_subscription",
        executionTargetSlug: selected.executionTargetId, pinnedTargetId: null,
        credentialOwnerPrincipalId: selected.connectionOwnerUserId,
      };
    }
    return {
      credentialId: selected.connectionId, credentialKind: "company_api_key",
      executionTargetSlug: selected.executionTargetId ?? CANARY_EXECUTION_TARGET_SLUG, pinnedTargetId: null,
      commanderCredential: { connectionId: selected.connectionId, secretId: selected.secretRef!,
        provider: source.provider, adapterType: source.adapterType },
    };
  };
}

/** Uses the existing owner credential broker for metadata; no new table grants. */
export function createDrizzleJobCredentialRoutingResolver(db: Db, topology: CliAuthTopology) {
  const providerDeps = buildResolveDeps(db, topology);
  return createJobCredentialRoutingResolver({
    loadCommanderSource: (input) => loadCommanderJobAuthority(db, input),
    async loadCandidates(input, source) {
      const args: ResolveArgs = {
        organizationId: input.organizationId, companyId: input.companyId, agentId: null,
        actorKind: "commander", adapterType: source.adapterType, provider: source.provider,
        executionTargetId: "", currentEnv: {},
        context: { actorType: "user", actorId: source.userId, consumerType: "system", consumerId: source.userId },
      };
      return providerDeps.bypassNewModel ? [] : providerDeps.loadCandidateRows(db, args);
    },
    async ownerMembershipActive(companyId, userId) {
      const [row] = await db.select({ status: companyMemberships.status }).from(companyMemberships)
        .where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, userId))).limit(1);
      return row?.status === "active";
    },
  });
}

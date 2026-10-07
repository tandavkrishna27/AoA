import { randomUUID, createHash } from "node:crypto";
import type { Sql } from "postgres";
import { canonicalizeJsonV1 } from "@armyofagents/worker-protocol";
import { BROWSER_RUNTIME_ROOT } from "../../services/browser-runtime-preparation.js";
import { stagedPathMarker } from "../../services/job-input-staging.js";

/** Envelope-only fixture: runtime bytes are never downloaded by the polling tests.
 * A caller exercising an active browser fence must supply a real running parent. */
export async function stageBrowserCandidate(admin: Sql, input: {
  organizationId: string; jobId: string; targetId: string;
  parent?: { jobId: string; attemptId: string; leaseId: string };
}) {
  const [worker] = await admin`SELECT profile_hash FROM workers WHERE execution_target_id = ${input.targetId}`;
  const [target] = await admin`SELECT registered_profile_hash, provider_constraint_profile FROM execution_targets WHERE id = ${input.targetId}`;
  const body = { policyId: "test-browser-egress", version: 1, defaultAction: "deny", allow: [], denyPrivateNetworks: true, denyMetadata: true, denyControlPlane: true };
  const networkPolicy = { ...body, digest: createHash("sha256").update(canonicalizeJsonV1(body)).digest("hex") };
  const parent = input.parent ?? { jobId: randomUUID(), attemptId: randomUUID(), leaseId: randomUUID() };
  const preparation = {
    schemaVersion: 1, requestDigest: "b".repeat(64), runId: randomUUID(), agentId: randomUUID(), issueId: randomUUID(),
    parentJobId: parent.jobId, parentAttemptId: parent.attemptId, parentLeaseId: parent.leaseId,
    targetId: input.targetId, targetAuthorityKey: `organization:${input.organizationId}`, targetGeneration: 1,
    profileHash: worker.profile_hash, targetProfileHash: target.registered_profile_hash,
    providerConstraintHash: target.provider_constraint_profile.digest, networkPolicy,
  };
  await admin`UPDATE jobs SET source_intent = source_intent || ${admin.json({ parentJobId: parent.jobId })}::jsonb,
    policy_snapshot = policy_snapshot || ${admin.json({ browserPreparation: preparation })}::jsonb WHERE id = ${input.jobId}`;
  for (const name of ["runner.js", "session.json", "package.json"]) {
    await admin`INSERT INTO job_artifacts (organization_id, job_id, identifier, object_key, sha256, size_bytes, content_type, kind, attempt, status)
      VALUES (${input.organizationId}, ${input.jobId}, ${randomUUID()}, ${`organizations/${input.organizationId}/jobs/${input.jobId}/${name}`}, ${"a".repeat(64)}, 1,
      ${stagedPathMarker(`${BROWSER_RUNTIME_ROOT}/${name}`)}, 'staged_input', 1, 'committed')`;
  }
}

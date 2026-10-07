import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  activityLog,
  agentRuntimeDecisions,
  leases,
  jobArtifacts,
  jobControlCommands,
  jobEvents,
  jobProjectionReceipts,
  jobs,
  internalAgentConfig,
  type ActiveFenceRequest,
  type Db,
} from "@armyofagents/db";
import {
  artifactDownloadGrantV1Schema,
  canonicalizeJsonV1,
  permissionRuntimeDecisionRequestV1Schema,
  type ArtifactDownloadGrantV1,
  type LeaseRenewRequestV1,
} from "@armyofagents/worker-protocol";
import { z } from "zod";
import { runInTenant } from "../db/tenant-context.js";
import type { StorageProvider } from "../storage/types.js";
import { localEncryptedProvider } from "../secrets/local-encrypted-provider.js";
import { parseBrowserPreparation, type BrowserPreparation } from "./browser-runtime-preparation.js";
import { loadCommanderJobAuthority, commanderJobHasHumanOwner } from "./commander-job-authority.js";
import { browserSessionBindingSchema } from "../config/browser-session-bindings.js";
import { exchangeBrowserSessionCookie } from "./browser-session-cookie-exchange.js";
import {
  assertBrowserConnectorCurrent,
  createBrowserConnectorOAuthResolver,
  type BrowserConnectorScope,
} from "./browser-connector-oauth.js";
import type { ResolvedFenceContext } from "./worker-fence-context.js";
import type { VerifiedWorkerOperation } from "./job-leasing.js";
import { runtimeDecisionPromptHash } from "./agent-runtime-decisions.js";

export const BROWSER_SESSION_GRANTS_NAMESPACE =
  "com.armyofagents.browser/session-credential-grants";
export const BROWSER_SESSION_REDEEM_PATH =
  "/api/worker-control/browser-session-credentials/";
const PURPOSE = "browser-session-credential:";
const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
async function bounded<T>(operation: Promise<T>, timeoutMs = 5000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("browser credential storage timeout")),
          timeoutMs
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
const replySchema = z
  .object({
    requestId: z.string().uuid(),
    bindingId: z.string().uuid(),
    policyDigest: z.string().regex(/^[0-9a-f]{64}$/),
    origin: z.string().max(1000),
    expiresAt: z.string().datetime(),
    cookie: z
      .object({
        name: z.string().regex(/^__Host-[A-Za-z0-9_-]{1,64}$/),
        value: z.string().regex(/^[A-Za-z0-9._~-]{16,4096}$/),
      })
      .strict(),
  })
  .strict();
const envelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    fence: z
      .object({
        organizationId: z.string().uuid(),
        companyId: z.string().uuid(),
        jobId: z.string().uuid(),
        attemptId: z.string().uuid(),
        attemptNumber: z.number().int().positive(),
        leaseId: z.string().uuid(),
        workerId: z.string().uuid(),
        targetId: z.string().uuid(),
        targetAuthorityKey: z.string(),
        targetGeneration: z.number().int().positive(),
        profileHash: z.string(),
        providerConstraintHash: z.string(),
        fence: z.string(),
      })
      .strict(),
    parent: z
      .object({
        jobId: z.string().uuid(),
        attemptId: z.string().uuid(),
        leaseId: z.string().uuid(),
      })
      .strict(),
    binding: browserSessionBindingSchema,
    handleId: z.string().uuid(),
    requestDigest: z.string().regex(/^[0-9a-f]{64}$/),
    eventId: z.string().uuid(),
    reply: replySchema,
  })
  .strict();
type Envelope = z.infer<typeof envelopeSchema>;
export interface BrowserSessionCredentialGrant {
  requestId: string;
  bindingId: string;
  policyDigest: string;
  grant: ArtifactDownloadGrantV1;
}
export interface BrowserSessionCredentialPort {
  assertReady(): Promise<void>;
  prepare(
    auth: VerifiedWorkerOperation,
    request: LeaseRenewRequestV1,
    context: ResolvedFenceContext
  ): Promise<BrowserSessionCredentialGrant[]>;
  redeem(artifactId: string, scopedToken: string): Promise<Buffer>;
}
let registered: BrowserSessionCredentialPort | undefined;
export function setBrowserSessionCredentialPort(
  port: BrowserSessionCredentialPort | undefined
) {
  registered = port;
}
export function getBrowserSessionCredentialPort() {
  return registered;
}
export async function browserSessionCredentialGrantExtensions(
  auth: VerifiedWorkerOperation,
  request: LeaseRenewRequestV1,
  context: ResolvedFenceContext
) {
  if (!registered) return [];
  const grants = await registered.prepare(auth, request, context);
  return grants.length
    ? [
        {
          namespace: BROWSER_SESSION_GRANTS_NAMESPACE,
          schemaVersion: 1,
          critical: false,
          value: { grants },
        },
      ]
    : [];
}

/** This is native secret-broker transport. Pending encrypted credential objects
 * never enter ordinary committed artifact download or export paths. */
export function createBrowserSessionCredentialBroker(input: {
  appDb: Db;
  identityDb: Db;
  storage: StorageProvider;
  signingKey: string;
  publicOrigin: string;
  resolveConnectorOAuth?: (input: BrowserConnectorScope) => Promise<string>;
  exchange?: typeof exchangeBrowserSessionCookie;
  assertConnectorCurrent?: (input: BrowserConnectorScope) => Promise<void>;
  now?: () => Date;
  storageTimeoutMs?: number;
}): BrowserSessionCredentialPort {
  const origin = new URL(input.publicOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== input.publicOrigin ||
    origin.username ||
    origin.password ||
    input.signingKey.length < 32
  )
    throw new Error("browser credential transport configuration unavailable");
  const now = input.now ?? (() => new Date()),
    resolveOAuth =
      input.resolveConnectorOAuth ??
      createBrowserConnectorOAuthResolver(input.identityDb);
  const assertConnector =
    input.assertConnectorCurrent ??
    ((scope: BrowserConnectorScope) =>
      assertBrowserConnectorCurrent(input.identityDb, scope));
  const connectorScope = (preparation: BrowserPreparation, companyId: string): BrowserConnectorScope => ({ companyId,
    connectorId: preparation.sessionBinding!.connectorId,
    ...(preparation.schemaVersion === 2 ? { userId: preparation.userId, origin: preparation.sessionBinding!.origin } : { agentId: preparation.agentId }) });
  const assertHumanCurrent = async (preparation: BrowserPreparation, companyId: string) => {
    if (preparation.schemaVersion !== 2) return;
    const authority = await loadCommanderJobAuthority(input.identityDb, { companyId, jobId: preparation.parentJobId });
    const [parent] = await input.identityDb.select({ policy: jobs.policySnapshot, status: jobs.status }).from(jobs)
      .where(and(eq(jobs.id, preparation.parentJobId), eq(jobs.companyId, companyId)));
    const [config] = await input.identityDb.select({ capabilities: internalAgentConfig.enabledCapabilities }).from(internalAgentConfig).where(eq(internalAgentConfig.companyId, companyId));
    const bindings = parent?.policy.browserSessionBindings;
    if (!authority || authority.userId !== preparation.userId || authority.turnId !== preparation.runId || authority.conversationId !== preparation.conversationId ||
      authority.distributedAttemptId !== preparation.parentAttemptId || authority.distributedJobId !== preparation.parentJobId || authority.executionOwner !== "distributed" || authority.status !== "running" || parent?.status !== "running" ||
      !Array.isArray(config?.capabilities) || !config.capabilities.includes("browser_use") || !Array.isArray(bindings) ||
      canonicalizeJsonV1(parent.policy.networkPolicy) !== canonicalizeJsonV1(preparation.networkPolicy) ||
      !bindings.some(binding => canonicalizeJsonV1(binding) === canonicalizeJsonV1(preparation.sessionBinding))) throw new Error("browser human session authority unavailable");
    await assertConnector(connectorScope(preparation, companyId));
  };
  // Probe the existing encryption provider at composition, before accepting an
  // authenticated guest workload. The probe contains no credential value.
  const encryptionReady = localEncryptedProvider
    .createVersion({
      value: "browser-session-readiness",
      externalRef: null,
      context: {
        companyId: "browser-session-broker",
        secretKey: "browser-session-readiness",
        secretName: "browser-session-readiness",
        version: 1,
      },
    })
    .then(
      async (encrypted) =>
        (await localEncryptedProvider.resolveVersion({
          material: encrypted.material,
          externalRef: null,
        })) === "browser-session-readiness"
    )
    .catch(() => false);
  const assertReady = async () => {
    if (!(await encryptionReady))
      throw new Error("browser session encryption unavailable");
  };
  const sign = (payload: string) =>
    createHmac("sha256", input.signingKey)
      .update(`browser-session-grant-v1.${payload}`)
      .digest("base64url");
  const token = (artifact: {
    id: string;
    organizationId: string;
    jobId: string;
    expiresAt: Date;
  }) => {
    const payload = Buffer.from(
      JSON.stringify({
        artifactId: artifact.id,
        organizationId: artifact.organizationId,
        jobId: artifact.jobId,
        expiresAt: artifact.expiresAt.toISOString(),
      })
    ).toString("base64url");
    return `${payload}.${sign(payload)}`;
  };
  const decodeToken = (artifactId: string, value: string) => {
    if (value.length > 2048)
      throw new Error("browser credential grant refused");
    const [payload, mac, ...extra] = value.split(".");
    if (!payload || !mac || extra.length)
      throw new Error("browser credential grant refused");
    const expected = Buffer.from(sign(payload)),
      actual = Buffer.from(mac);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error("browser credential grant refused");
    const scope = z
      .object({
        artifactId: z.string().uuid(),
        organizationId: z.string().uuid(),
        jobId: z.string().uuid(),
        expiresAt: z.string().datetime(),
      })
      .strict()
      .parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (
      scope.artifactId !== artifactId ||
      new Date(scope.expiresAt).getTime() <= now().getTime()
    )
      throw new Error("browser credential grant refused");
    return scope;
  };
  const readEnvelope = async (artifact: {
    objectKey: string | null;
    sha256: string | null;
    sizeBytes: number | null;
  }) => {
    if (
      !artifact.objectKey ||
      !artifact.sha256 ||
      !artifact.sizeBytes ||
      artifact.sizeBytes > 32768
    )
      throw new Error("browser credential object unavailable");
    const object = await bounded(
      input.storage.getObject({ objectKey: artifact.objectKey })
    );
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      await bounded(
        (async () => {
          for await (const chunk of object.stream) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.length;
            if (size > 32768)
              throw new Error("browser credential object too large");
            chunks.push(bytes);
          }
        })()
      );
    } finally {
      object.stream.destroy();
    }
    const bytes = Buffer.concat(chunks);
    if (size !== artifact.sizeBytes || sha(bytes) !== artifact.sha256)
      throw new Error("browser credential object integrity refused");
    const material = JSON.parse(bytes.toString("utf8"));
    const value = await localEncryptedProvider.resolveVersion({
      material,
      externalRef: null,
    });
    return envelopeSchema.parse(JSON.parse(value));
  };
  const makeGrant = (
    artifact: {
      id: string;
      organizationId: string;
      jobId: string;
      objectKey: string | null;
      expiresAt: Date | null;
    },
    envelope: Envelope
  ): BrowserSessionCredentialGrant => {
    const bytes = Buffer.from(JSON.stringify(envelope.reply));
    if (
      bytes.length > 8192 ||
      !artifact.objectKey ||
      !artifact.expiresAt ||
      artifact.expiresAt.getTime() <= now().getTime()
    )
      throw new Error("browser credential grant expired");
    return {
      requestId: envelope.reply.requestId,
      bindingId: envelope.reply.bindingId,
      policyDigest: envelope.reply.policyDigest,
      grant: artifactDownloadGrantV1Schema.parse({
        protocolVersion: 1,
        operation: "download",
        artifactId: artifact.id,
        method: "GET",
        url: `${input.publicOrigin}${BROWSER_SESSION_REDEEM_PATH}${
          artifact.id
        }?grant=${encodeURIComponent(
          token({ ...artifact, expiresAt: artifact.expiresAt })
        )}`,
        headers: {},
        issuedAt: now().toISOString(),
        expiresAt: artifact.expiresAt.toISOString(),
        maxBytes: bytes.length,
        expectedSha256: sha(bytes),
        objectKey: artifact.objectKey,
        redaction: "secret",
      }),
    };
  };
  return {
    assertReady,
    async prepare(auth, request, ctx) {
      await assertReady();
      if (
        ctx.fenceIdentity.organizationId !== auth.organizationId ||
        ctx.fenceIdentity.workerId !== auth.workerId ||
        ctx.fenceIdentity.jobId !== request.jobId ||
        ctx.fenceIdentity.leaseId !== request.leaseId ||
        ctx.fenceIdentity.fence !== request.fenceToken ||
        ctx.fenceIdentity.attemptNumber !== request.attempt
      )
        throw new Error("browser credential fence context refused");
      const prepared = await runInTenant(
        input.appDb,
        auth.organizationId,
        async (repos, tx) => {
          await repos.jobControl.lockActiveFence(ctx.fenceIdentity);
          const [job] = await tx
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.organizationId, auth.organizationId),
                eq(jobs.companyId, ctx.companyId),
                eq(jobs.id, request.jobId)
              )
            );
          const preparation = parseBrowserPreparation(
              job?.policySnapshot.browserPreparation
            ),
            binding = preparation?.sessionBinding;
          if (preparation?.schemaVersion === 2 && binding) {
            if (!job || !commanderJobHasHumanOwner(job) || job.requesterPrincipalId !== preparation.userId) return null;
            await assertHumanCurrent(preparation, ctx.companyId);
          }
          if (
            !job ||
            job.workloadType !== "browser_session" ||
            job.sourceKind !== "browser_request" ||
            !binding ||
            [
              "cancel_requested",
              "succeeded",
              "failed",
              "cancelled",
              "dead_letter",
            ].includes(job.status)
          )
            return null;
          const rows = await tx
            .select({
              event: jobEvents.event,
              eventId: jobEvents.eventId,
              decision: agentRuntimeDecisions,
            })
            .from(jobEvents)
            .innerJoin(
              jobProjectionReceipts,
              and(
                eq(jobProjectionReceipts.organizationId, auth.organizationId),
                eq(jobProjectionReceipts.jobId, jobEvents.jobId),
                eq(jobProjectionReceipts.attemptId, jobEvents.attemptId),
                eq(jobProjectionReceipts.sourceFence, jobEvents.fenceToken),
                eq(jobProjectionReceipts.projectionKind, "runtime_decision"),
                eq(jobProjectionReceipts.status, "applied"),
                eq(
                  jobProjectionReceipts.aggregateKind,
                  "agent_runtime_decisions"
                ),
                eq(jobProjectionReceipts.sourceDigest, jobEvents.eventDigest),
                eq(jobProjectionReceipts.companyId, ctx.companyId),
                sql`${jobProjectionReceipts.sourceIdentity} = 'browser-approval:' || ${jobEvents.companyId}::text || ':' || ${jobEvents.eventId}::text`
              )
            )
            .innerJoin(
              agentRuntimeDecisions,
              and(
                eq(agentRuntimeDecisions.companyId, ctx.companyId),
                eq(
                  agentRuntimeDecisions.id,
                  jobProjectionReceipts.targetAggregateId
                )
              )
            )
            .where(
              and(
                eq(jobEvents.organizationId, auth.organizationId),
                eq(jobEvents.companyId, ctx.companyId),
                eq(jobEvents.jobId, request.jobId),
                eq(jobEvents.attemptId, ctx.fenceIdentity.attemptId),
                eq(jobEvents.leaseId, request.leaseId),
                eq(jobEvents.fenceToken, request.fenceToken),
                eq(jobEvents.eventType, "runtime_decision_requested"),
                eq(
                  agentRuntimeDecisions.toolName,
                  "browser.session_credentials"
                ),
                eq(agentRuntimeDecisions.decision, "allow_once"),
                isNotNull(agentRuntimeDecisions.answeredByUserId),
                inArray(agentRuntimeDecisions.status, ["answered", "relayed"])
              )
            )
            .limit(2);
          if (rows.length !== 1) return null;
          const row = rows[0]!,
            parsed = permissionRuntimeDecisionRequestV1Schema.safeParse(
              row.event.payload
            );
          if (!parsed.success) return null;
          const permission = parsed.data;
          if (
            permission.command !== null ||
            permission.cwd !== null ||
            permission.path !== null ||
            row.decision.kind !== "permission" ||
            row.decision.adapterType !== "browser_runtime" ||
            row.decision.networkTarget !== binding.origin ||
            row.decision.riskClass !== "credential_use" ||
            row.decision.title !== "Use scoped browser session" ||
            row.decision.summary !== preparation.networkPolicy.digest ||
            row.decision.command !== null ||
            row.decision.cwd !== null ||
            row.decision.path !== null ||
            // The native aggregate revision advances on answer/relay (and may
            // advance on display). Immutable wire sourceRevision stays zero;
            // its full tuple/hash remains checked separately below.
            row.decision.timeoutPolicy !== "deny" ||
            permission.requestId !== row.decision.id ||
            permission.nonce !== binding.bindingId ||
            permission.summary !== preparation.networkPolicy.digest ||
            permission.networkTarget !== binding.origin ||
            permission.title !== "Use scoped browser session" ||
            permission.toolName !== "browser.session_credentials" ||
            permission.riskClass !== "credential_use" ||
            permission.sourceRevision !== 0 ||
            permission.schemaVersion !== 1 ||
            permission.timeoutPolicy !== "deny" ||
            permission.defaultDecision !== null ||
            permission.requestDigest !==
              runtimeDecisionPromptHash({
                kind: "permission",
                ...permission,
                promptText: null,
              }) ||
            row.decision.promptHash !== permission.requestDigest ||
            row.decision.nonce !== permission.nonce ||
            !row.decision.expiresAt ||
            row.decision.expiresAt.getTime() <= now().getTime()
          )
            return null;
          const [command] = await tx
            .select({ body: jobControlCommands.command })
            .from(jobControlCommands)
            .where(
              and(
                eq(jobControlCommands.organizationId, auth.organizationId),
                eq(jobControlCommands.companyId, ctx.companyId),
                eq(jobControlCommands.jobId, request.jobId),
                eq(jobControlCommands.attemptId, ctx.fenceIdentity.attemptId),
                eq(jobControlCommands.leaseId, request.leaseId),
                eq(jobControlCommands.fenceToken, request.fenceToken),
                eq(jobControlCommands.commandKind, "runtime_decision_result"),
                sql`${jobControlCommands.command}->'result'->>'requestId' = ${permission.requestId}`
              )
            )
            .limit(1);
          const result = command?.body.result as
            | Record<string, unknown>
            | undefined;
          const decidedBy = result?.decidedBy as
            | Record<string, unknown>
            | undefined;
          if (
            !result ||
            decidedBy?.principalType !== "user" ||
            decidedBy.principalId !== row.decision.answeredByUserId ||
            (preparation.schemaVersion === 2 && row.decision.answeredByUserId !== preparation.userId) ||
            result.decision !== "allow_once" ||
            result.requestDigest !== permission.requestDigest ||
            result.nonce !== binding.bindingId ||
            result.sourceRevision !== 0 ||
            result.schemaVersion !== 1
          )
            return null;
          const identifier = PURPOSE + permission.requestId;
          const existing = await tx
            .select()
            .from(jobArtifacts)
            .where(
              and(
                eq(jobArtifacts.organizationId, auth.organizationId),
                eq(jobArtifacts.jobId, request.jobId),
                eq(jobArtifacts.identifier, identifier),
                eq(jobArtifacts.kind, "browser_cookie_state")
              )
            )
            .limit(2)
            .for("update");
          if (existing.length > 1) return null;
          if (existing[0])
            return existing[0].status === "pending" && existing[0].sha256
              ? {
                  artifact: existing[0],
                  replayed: true as const,
                  fence: ctx.fenceIdentity,
                  preparation,
                }
              : null;
          const [attempt] = await tx
            .select({ startedAt: leases.activatedAt })
            .from(leases)
            .where(
              and(
                eq(leases.organizationId, auth.organizationId),
                eq(leases.companyId, ctx.companyId),
                eq(leases.id, ctx.fenceIdentity.leaseId)
              )
            );
          if (!attempt?.startedAt) return null;
          const expiresAt = new Date(
            Math.min(
              now().getTime() + 300000,
              new Date(permission.expiresAt).getTime(),
              ctx.leaseDeadline.getTime(),
              attempt.startedAt.getTime() +
                Number(job.input.maxSessionSeconds ?? 900) * 1000
            )
          );
          if (expiresAt.getTime() <= now().getTime()) return null;
          const artifactId = randomUUID(),
            objectKey = `organizations/${auth.organizationId}/jobs/${job.id}/attempts/${request.attempt}/browser-session/${permission.requestId}`;
          const [artifact] = await tx
            .insert(jobArtifacts)
            .values({
              id: artifactId,
              organizationId: auth.organizationId,
              jobId: job.id,
              identifier,
              kind: "browser_cookie_state",
              status: "pending",
              sensitivity: "secret",
              retention: "ephemeral",
              attempt: request.attempt,
              leaseId: request.leaseId,
              fenceToken: request.fenceToken,
              objectKey,
              expiresAt,
            })
            .returning();
          const handleId = randomUUID();
          const minted = await repos.jobControl.insertExecutionSecretHandle({
            organizationId: auth.organizationId,
            companyId: ctx.companyId,
            jobId: job.id,
            handle: handleId,
            refKind: "connector_oauth",
            refId: binding.connectorId,
            materialization: "proxy",
            usePolicy: "fence_proxy",
            envTarget: null,
            destination: binding.origin,
            refVersion: null,
            boundTargetGeneration: ctx.fenceIdentity.targetGeneration,
            ownerPrincipalKind: null,
            ownerPrincipalId: null,
            activeFence: ctx.fenceIdentity,
          });
          const authorized = await repos.jobControl.resolveExecutionSecret({
            ...ctx.fenceIdentity,
            handle: minted.handle,
            appliedPolicyVersion: preparation.networkPolicy.version,
          });
          if (
            authorized.refKind !== "connector_oauth" ||
            authorized.materialization !== "proxy" ||
            authorized.usePolicy !== "fence_proxy" ||
            authorized.destination !== binding.origin ||
            authorized.refId !== binding.connectorId
          )
            throw new Error("browser connector proxy authority refused");
          const [parent] = await tx
            .select({ policy: jobs.policySnapshot })
            .from(jobs)
            .where(
              and(
                eq(jobs.organizationId, auth.organizationId),
                eq(jobs.companyId, ctx.companyId),
                eq(jobs.id, preparation.parentJobId)
              )
            );
          const controlPlaneDenyCidrs = parent?.policy.controlPlaneDenyCidrs;
          if (
            !Array.isArray(controlPlaneDenyCidrs) ||
            !controlPlaneDenyCidrs.every((value) => typeof value === "string")
          )
            throw new Error(
              "browser parent control-plane authority unavailable"
            );
          return {
            artifact: artifact!,
            replayed: false as const,
            fence: ctx.fenceIdentity,
            preparation,
            permission,
            eventId: row.eventId,
            handleId: minted.handle,
            controlPlaneDenyCidrs: controlPlaneDenyCidrs as string[],
          };
        }
      );
      if (!prepared) return [];
      if (prepared.replayed) {
        await assertHumanCurrent(prepared.preparation, prepared.fence.companyId);
        const envelope = await readEnvelope(prepared.artifact);
        if (JSON.stringify(envelope.fence) !== JSON.stringify(prepared.fence))
          return [];
        return [makeGrant(prepared.artifact, envelope)];
      }
      let putSettled = true;
      let putAbandoned = false;
      const compensate = async () => {
        const writerSettledBeforeDelete = putSettled;
        await bounded(
          input.storage.deleteObject({
            objectKey: prepared.artifact.objectKey!,
          })
        );
        await runInTenant(
          input.appDb,
          auth.organizationId,
          async (_repos, tx) => {
            await tx
              .update(jobArtifacts)
              .set({
                status: "expired",
                objectKey: writerSettledBeforeDelete
                  ? null
                  : prepared.artifact.objectKey,
                updatedAt: sql`clock_timestamp()`,
              })
              .where(
                and(
                  eq(jobArtifacts.id, prepared.artifact.id),
                  eq(jobArtifacts.organizationId, auth.organizationId),
                  inArray(jobArtifacts.status, ["pending", "expired"])
                )
              );
          }
        );
      };
      try {
        await assertHumanCurrent(prepared.preparation, prepared.fence.companyId);
        const accessToken = await resolveOAuth({ ...connectorScope(prepared.preparation, prepared.fence.companyId),
          ...(prepared.preparation.schemaVersion === 2 ? { assertAuthorityCurrent: async () => {
            await runInTenant(input.appDb, auth.organizationId, repos => repos.jobControl.lockActiveFence(prepared.fence));
            await assertHumanCurrent(prepared.preparation, prepared.fence.companyId);
          } } : {}) });
        await runInTenant(input.appDb, auth.organizationId, (repos) =>
          repos.jobControl.lockActiveFence(prepared.fence)
        );
        await assertHumanCurrent(prepared.preparation, prepared.fence.companyId);
        const cookie = await (input.exchange ?? exchangeBrowserSessionCookie)({
          binding: prepared.preparation.sessionBinding!,
          accessToken,
          policy: prepared.preparation.networkPolicy,
          controlPlaneDenyCidrs: prepared.controlPlaneDenyCidrs,
          expiresAt: prepared.artifact.expiresAt!,
          signal: AbortSignal.timeout(10000),
        });
        const reply = replySchema.parse({
          requestId: prepared.permission.requestId,
          bindingId: prepared.preparation.sessionBinding!.bindingId,
          policyDigest: prepared.preparation.networkPolicy.digest,
          origin: prepared.preparation.sessionBinding!.origin,
          expiresAt: cookie.expiresAt,
          cookie: { name: cookie.name, value: cookie.value },
        });
        const envelope: Envelope = {
          schemaVersion: 1,
          fence: prepared.fence,
          parent: {
            jobId: prepared.preparation.parentJobId,
            attemptId: prepared.preparation.parentAttemptId,
            leaseId: prepared.preparation.parentLeaseId,
          },
          binding: prepared.preparation.sessionBinding!,
          handleId: prepared.handleId,
          requestDigest: prepared.permission.requestDigest,
          eventId: prepared.eventId,
          reply,
        };
        if (
          reply.cookie.name !==
            prepared.preparation.sessionBinding!.cookieName ||
          reply.cookie.value === accessToken ||
          new Date(reply.expiresAt).getTime() >
            prepared.artifact.expiresAt!.getTime() ||
          new Date(reply.expiresAt).getTime() <= now().getTime()
        )
          throw new Error("scoped browser session reply refused");
        await assertHumanCurrent(prepared.preparation, prepared.fence.companyId);
        await assertConnector(connectorScope(prepared.preparation, prepared.fence.companyId));
        const encrypted = await localEncryptedProvider.createVersion({
          value: JSON.stringify(envelope),
          externalRef: null,
          context: {
            companyId: prepared.fence.companyId,
            secretKey: "browser-session-credential",
            secretName: "browser-session-credential",
            version: 1,
          },
        });
        const bytes = Buffer.from(JSON.stringify(encrypted.material));
        if (bytes.length > 32768)
          throw new Error("encrypted browser session grant too large");
        putSettled = false;
        const put = input.storage.putObject({
          objectKey: prepared.artifact.objectKey!,
          body: bytes,
          contentType: "application/vnd.aoa.encrypted-session+json",
          contentLength: bytes.length,
        });
        // Bound the response, while retaining a durable tombstone until the
        // original non-abortable writer settles and compensation succeeds.
        const settle = () => {
          putSettled = true;
          if (putAbandoned)
            void compensate().catch(() => {
              /* sweeper retains the pointer */
            });
        };
        void put.then(settle, settle);
        try {
          await bounded(
            put,
            Math.max(1, Math.min(5000, input.storageTimeoutMs ?? 5000))
          );
        } catch (error) {
          putAbandoned = true;
          throw error;
        }
        const artifact = await runInTenant(
          input.appDb,
          auth.organizationId,
          async (repos, tx) => {
            await repos.jobControl.lockActiveFence(prepared.fence);
            await assertHumanCurrent(prepared.preparation, prepared.fence.companyId);
            const [row] = await tx
              .update(jobArtifacts)
              .set({
                sha256: sha(bytes),
                sizeBytes: bytes.length,
                contentType: "application/vnd.aoa.encrypted-session+json",
                expiresAt: new Date(reply.expiresAt),
                updatedAt: sql`clock_timestamp()`,
              })
              .where(
                and(
                  eq(jobArtifacts.id, prepared.artifact.id),
                  eq(jobArtifacts.organizationId, auth.organizationId),
                  eq(jobArtifacts.status, "pending")
                )
              )
              .returning();
            if (!row) throw new Error("browser session grant cancelled");
            await tx.insert(activityLog).values({
              organizationId: auth.organizationId,
              companyId: prepared.fence.companyId,
              actorType: "system",
              actorId: "browser-session-broker",
              action: "browser.session_credential.staged",
              entityType: "job_artifact",
              entityId: row.id,
              details: {
                jobId: row.jobId,
                requestId: reply.requestId,
                bindingId: reply.bindingId,
              },
            });
            return row;
          }
        );
        return [makeGrant(artifact, envelope)];
      } catch (error) {
        try {
          await compensate();
        } catch {
          /* cleanup scanner retries encrypted pending objects */
        }
        throw error;
      }
    },
    async redeem(artifactId, scopedToken) {
      const scope = decodeToken(artifactId, scopedToken);
      const [artifact] = await runInTenant(
        input.appDb,
        scope.organizationId,
        async (_repos, tx) =>
          tx
            .select()
            .from(jobArtifacts)
            .where(
              and(
                eq(jobArtifacts.id, artifactId),
                eq(jobArtifacts.organizationId, scope.organizationId),
                eq(jobArtifacts.jobId, scope.jobId),
                eq(jobArtifacts.kind, "browser_cookie_state"),
                eq(jobArtifacts.status, "pending")
              )
            )
      );
      if (
        !artifact ||
        !artifact.identifier.startsWith(PURPOSE) ||
        !artifact.expiresAt ||
        artifact.expiresAt.toISOString() !== scope.expiresAt
      )
        throw new Error("browser credential grant refused");
      const envelope = await readEnvelope(artifact),
        bytes = Buffer.from(JSON.stringify(envelope.reply));
      if (
        bytes.length > 8192 ||
        envelope.fence.organizationId !== scope.organizationId ||
        envelope.fence.jobId !== scope.jobId ||
        artifact.identifier !== PURPOSE + envelope.reply.requestId ||
        envelope.reply.expiresAt !== scope.expiresAt ||
        artifact.leaseId !== envelope.fence.leaseId ||
        artifact.fenceToken !== envelope.fence.fence
      )
        throw new Error("browser credential grant refused");
      await runInTenant(
        input.appDb,
        scope.organizationId,
        async (repos, tx) => {
          await repos.jobControl.lockActiveFence(envelope.fence);
          const [job] = await tx
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.organizationId, scope.organizationId),
                eq(jobs.companyId, envelope.fence.companyId),
                eq(jobs.id, scope.jobId)
              )
            );
          if (
            !job ||
            [
              "cancel_requested",
              "succeeded",
              "failed",
              "cancelled",
              "dead_letter",
            ].includes(job.status)
          )
            throw new Error("browser credential grant refused");
          const preparation = parseBrowserPreparation(
            job?.policySnapshot.browserPreparation
          );
          if (
            !preparation?.sessionBinding ||
            JSON.stringify(preparation.sessionBinding) !==
              JSON.stringify(envelope.binding) ||
            preparation.networkPolicy.digest !== envelope.reply.policyDigest ||
            preparation.parentJobId !== envelope.parent.jobId ||
            preparation.parentAttemptId !== envelope.parent.attemptId ||
            preparation.parentLeaseId !== envelope.parent.leaseId
          )
            throw new Error("browser credential grant refused");
          const authorized = await repos.jobControl.resolveExecutionSecret({
            ...envelope.fence,
            handle: envelope.handleId,
            appliedPolicyVersion: preparation.networkPolicy.version,
          });
          if (
            authorized.refKind !== "connector_oauth" ||
            authorized.materialization !== "proxy" ||
            authorized.usePolicy !== "fence_proxy" ||
            authorized.refId !== envelope.binding.connectorId ||
            authorized.destination !== envelope.binding.origin
          )
            throw new Error("browser credential grant refused");
          const [current] = await tx
            .select()
            .from(jobArtifacts)
            .where(
              and(
                eq(jobArtifacts.id, artifactId),
                eq(jobArtifacts.organizationId, scope.organizationId),
                eq(jobArtifacts.status, "pending"),
                eq(jobArtifacts.sha256, artifact.sha256!)
              )
            )
            .for("update");
          if (
            !current ||
            !current.expiresAt ||
            current.expiresAt.getTime() <= now().getTime()
          )
            throw new Error("browser credential grant refused");
          if (preparation.schemaVersion === 2 && (!commanderJobHasHumanOwner(job!) || job!.requesterPrincipalId !== preparation.userId)) throw new Error("browser credential grant refused");
          await assertHumanCurrent(preparation, envelope.fence.companyId);
          await assertConnector(connectorScope(preparation, envelope.fence.companyId));
          await bounded(
            input.storage.deleteObject({ objectKey: artifact.objectKey! })
          );
          await tx
            .update(jobArtifacts)
            .set({
              status: "expired",
              objectKey: null,
              updatedAt: sql`clock_timestamp()`,
            })
            .where(eq(jobArtifacts.id, artifactId));
          await tx.insert(activityLog).values({
            organizationId: scope.organizationId,
            companyId: envelope.fence.companyId,
            actorType: "system",
            actorId: "browser-session-broker",
            action: "browser.session_credential.consumed",
            entityType: "job_artifact",
            entityId: artifactId,
            details: {
              jobId: scope.jobId,
              requestId: envelope.reply.requestId,
              bindingId: envelope.binding.bindingId,
            },
          });
        }
      );
      return bytes;
    },
  };
}

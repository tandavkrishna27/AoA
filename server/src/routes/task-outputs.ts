import { Router } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { issues, taskOutputs } from "@armyofagents/db";
import { mutableTaskOutputSchema, upsertTaskOutputSchema } from "@armyofagents/shared";
import { validate } from "../middleware/validate.js";
import { logActivity, taskOutputBackfillService, taskOutputService } from "../services/index.js";
import { HttpError, notFound } from "../errors.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import type { TaskOutputContent } from "../services/task-output-content.js";
import { getSafeServingHeaders } from "../services/asset-serving-safety.js";
import { EMPTY_ARTIFACT_SHA256, verifyArtifactStream } from "../storage/artifact-content-stream.js";
import { pipeline } from "node:stream/promises";
import { registerIssueParamNormalizer } from "./issue-param-normalizer.js";

async function getIssueCompanyId(db: Db, issueId: string) {
  return db
    .select({ companyId: issues.companyId })
    .from(issues)
    .where(eq(issues.id, issueId))
    .then((rows) => rows[0] ?? null);
}

async function getTaskOutputCompanyId(db: Db, id: string) {
  return db
    .select({ companyId: taskOutputs.companyId })
    .from(taskOutputs)
    .where(eq(taskOutputs.id, id))
    .then((rows) => rows[0] ?? null);
}

export function taskOutputRoutes(db: Db, content?: {
  openContent: (outputId: string, companyId: string) => Promise<TaskOutputContent>;
}) {
  const router = Router();
  const svc = taskOutputService(db);
  const backfillSvc = taskOutputBackfillService(db);
  registerIssueParamNormalizer(router, db, ["issueId"]);

  router.get("/task-outputs/:id/content", async (req, res, next) => {
    assertBoard(req);
    const id = req.params.id as string;
    const row = await getTaskOutputCompanyId(db, id);
    if (!row) throw notFound("Task output content not found");
    try { await assertCompanyAccess(db, req, row.companyId); }
    catch (error) {
      if (error instanceof HttpError && error.status === 403) throw notFound("Task output content not found");
      throw error;
    }
    if (!content) throw new HttpError(503, "Distributed output storage unavailable");
    const artifact = await content.openContent(id, row.companyId);
    // close may already have fired while storage lookup was pending.
    if (res.destroyed) {
      artifact.stream.destroy();
      return;
    }
    // Empty responses have no final byte to withhold; reject contradictory hashes before headers.
    if (artifact.sizeBytes === 0 && artifact.sha256 !== EMPTY_ARTIFACT_SHA256) {
      artifact.stream.destroy();
      throw new HttpError(502, "Artifact integrity check failed");
    }
    const stream = verifyArtifactStream(artifact.stream, artifact);
    // A provider can fail while the audit is in flight, before pipeline installs its handlers.
    const observeEarlyError = () => {};
    stream.on("error", observeEarlyError);
    const abort = () => stream.destroy();
    res.once("close", abort);
    try {
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: row.companyId, actorType: actor.actorType, actorId: actor.actorId,
        agentId: actor.agentId, runId: actor.runId,
        action: "task_output.content_read", entityType: "task_output", entityId: id,
        details: { artifactId: artifact.artifactId, jobId: artifact.jobId, attempt: artifact.attempt },
      });
      if (stream.errored) throw new HttpError(502, "Artifact integrity check failed");
      if (res.destroyed) {
        stream.destroy();
        return;
      }
      const safe = getSafeServingHeaders(artifact.contentType, artifact.filename);
      res.setHeader("Content-Type", safe.contentType);
      res.setHeader("Content-Length", artifact.sizeBytes);
      res.setHeader("Content-Disposition", safe.contentDisposition.replace(/^inline;/, "attachment;"));
      res.setHeader("X-Content-Type-Options", safe.xContentTypeOptions);
      res.setHeader("Cache-Control", "private, no-store");
      await pipeline(stream, res);
    } catch (error) {
      stream.destroy();
      if (res.headersSent || res.destroyed) res.destroy();
      else next(error);
    } finally {
      res.off("close", abort);
      stream.off("error", observeEarlyError);
    }
  });

  router.get(["/issues/:issueId/outputs", "/issues/:issueId/task-outputs"], async (req, res) => {
    const issueId = req.params.issueId as string;
    const issue = await getIssueCompanyId(db, issueId);
    if (!issue) throw notFound("Task not found");
    await assertCompanyAccess(db, req, issue.companyId);

    await backfillSvc.backfillIssueIfEmpty(issue.companyId, issueId);
    const result = await svc.listForIssue(issue.companyId, issueId);
    res.json(result);
  });

  router.post(
    ["/issues/:issueId/outputs", "/issues/:issueId/task-outputs"],
    validate(upsertTaskOutputSchema),
    async (req, res) => {
      const issueId = req.params.issueId as string;
      const issue = await getIssueCompanyId(db, issueId);
      if (!issue) throw notFound("Task not found");
      await assertCompanyAccess(db, req, issue.companyId);

      const output = await svc.upsertForIssue(issue.companyId, issueId, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: issue.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "task_output.upserted",
        entityType: "task_output",
        entityId: output.id,
        details: {
          issueId,
          type: output.type,
          provider: output.provider,
          externalId: output.externalId,
        },
      });

      res.status(201).json(output);
    },
  );

  router.get("/task-outputs/:id", async (req, res) => {
    const id = req.params.id as string;
    const row = await getTaskOutputCompanyId(db, id);
    if (!row) throw notFound("Task output not found");
    await assertCompanyAccess(db, req, row.companyId);

    const output = await svc.getById(row.companyId, id);
    if (!output) throw notFound("Task output not found");
    res.json(output);
  });

  router.patch(
    "/task-outputs/:id",
    validate(mutableTaskOutputSchema),
    async (req, res) => {
      const id = req.params.id as string;
      const row = await getTaskOutputCompanyId(db, id);
      if (!row) throw notFound("Task output not found");
      await assertCompanyAccess(db, req, row.companyId);

      const output = await svc.updateMutable(row.companyId, id, req.body);
      if (!output) throw notFound("Task output not found");

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: row.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "task_output.updated",
        entityType: "task_output",
        entityId: output.id,
        details: req.body,
      });

      res.json(output);
    },
  );

  return router;
}

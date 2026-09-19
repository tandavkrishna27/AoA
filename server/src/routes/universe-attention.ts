import { Router, type Request } from "express";
import type { Db } from "@armyofagents/db";
import type { UserRole } from "@armyofagents/shared";
import { unauthorized } from "../errors.js";
import { permissionService } from "../services/permissions.js";
import { universeAttentionProjectionService } from "../services/universe-attention-projection.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

function boardUser(req: Request): string {
  assertBoard(req);
  if (req.actor.type !== "board" || !req.actor.userId) throw unauthorized("Board authentication required");
  return req.actor.userId;
}

function implicitFounder(req: Request): boolean {
  return req.actor.type === "board" && (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin === true);
}

export function universeAttentionRoutes(
  db: Db,
  options: { projection?: Pick<ReturnType<typeof universeAttentionProjectionService>, "get"> } = {},
) {
  const router = Router();
  const projection = options.projection ?? universeAttentionProjectionService(db);
  const permissions = permissionService(db);

  router.get("/companies/:companyId/universe/attention", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCompanyAccess(db, req, companyId);
    const actorUserId = boardUser(req);
    const role: UserRole = implicitFounder(req)
      ? "founder"
      : await permissions.getEffectiveRole(companyId, actorUserId);
    res.setHeader("cache-control", "no-store");
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    res.json(await projection.get({ companyId, actorUserId, role, cursor }));
  });

  return router;
}

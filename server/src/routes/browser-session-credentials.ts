import { Router } from "express";
import { z } from "zod";
import { getBrowserSessionCredentialPort } from "../services/browser-session-credentials.js";

/** Dedicated secret-broker transport, outside ordinary artifact downloads.
 * Do not log the grant URL/query, response, or exception contents. */
export function browserSessionCredentialRoutes() {
  const router = Router();
  router.get(
    "/worker-control/browser-session-credentials/:artifactId",
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const id = z.string().uuid().safeParse(req.params.artifactId);
      const token = z.string().min(1).max(2048).safeParse(req.query.grant);
      const port = getBrowserSessionCredentialPort();
      if (
        !id.success ||
        !token.success ||
        !port ||
        Object.keys(req.query).length !== 1
      ) {
        res.status(403).json({ error: "Browser session grant refused" });
        return;
      }
      try {
        const bytes = await port.redeem(id.data, token.data);
        if (bytes.length > 8192) throw new Error("response refused");
        res.type("application/json").status(200).send(bytes);
      } catch {
        res.status(403).json({ error: "Browser session grant refused" });
      }
    }
  );
  return router;
}

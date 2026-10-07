import { HttpError } from "../../errors.js";
import { err, ok, type ToolHandler } from "./types.js";

export const handleBrowserSessionRequest: ToolHandler = async (ctx, args) => {
  if (ctx.actor.source !== "agent" || !ctx.actor.agentId || !ctx.actor.runId || ctx.actor.companyId !== ctx.companyId) {
    return err(403, -32003, "Browser requests require an authenticated active agent task run");
  }
  try {
    const { requestBrowserSessionForActiveRun } = await import("../../services/agent-browser-request.js");
    return ok(await requestBrowserSessionForActiveRun({ companyId: ctx.companyId, agentId: ctx.actor.agentId, runId: ctx.actor.runId }, args));
  } catch (error) {
    if (error instanceof HttpError) return err(error.status, -32009, error.message);
    return err(503, -32009, "Governed browser execution is unavailable");
  }
};

export const BROWSER_SESSION_TOOL_PARAMETERS = { type: "object" as const, additionalProperties: false,
  properties: { idempotencyKey: { type: "string" }, sessionBindingId:{type:"string",format:"uuid"},urls: { type: "array", minItems: 1, maxItems: 16, items: { type: "string" } },
    options: { type: "object", additionalProperties: false, properties: {
      viewport: { type: "object", properties: { width: { type: "integer" }, height: { type: "integer" } }, required: ["width", "height"] },
      locale: { type: "string" }, timezone: { type: "string" }, recordTrace: { type: "boolean" }, recordVideo: { type: "boolean" }, maxSessionSeconds: { type: "integer" },
    } } }, required: ["idempotencyKey", "urls"] };

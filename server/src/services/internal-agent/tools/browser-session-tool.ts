import { BROWSER_SESSION_TOOL_PARAMETERS } from "../../../mcp/tools/browser-session-tool.js";
import { requestBrowserSessionForActiveRun } from "../../agent-browser-request.js";
import type { AgentTool } from "../types.js";

export const browserSessionTool: AgentTool = {
  name: "request_browser_session",
  description: "Request a governed browser session for your active task, within inherited network and execution authority. Returns job identifiers, never browser control credentials.",
  parameters: BROWSER_SESSION_TOOL_PARAMETERS,
  category: "coordination", requiredRole: "team_member", requiresConfirmation: false,
  async execute(params, ctx) {
    if (ctx.actorType !== "agent" || !["org", "aoa"].includes(ctx.agentKind ?? "") || !ctx.agentId || !ctx.runId) {
      return { success: false, data: null, summary: "Browser requests require an active agent task run", error: "FORBIDDEN" };
    }
    try {
      const data = await requestBrowserSessionForActiveRun({ companyId: ctx.companyId, agentId: ctx.agentId, runId: ctx.runId,
        runKind: ctx.agentKind === "aoa" ? "internal_agent" : "heartbeat" }, params);
      return { success: true, data, summary: "Governed browser session queued" };
    } catch {
      return { success: false, data: null, summary: "Governed browser session unavailable or refused", error: "BROWSER_REQUEST_REFUSED" };
    }
  },
};

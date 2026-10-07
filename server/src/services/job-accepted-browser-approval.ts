import { and, eq, sql } from "drizzle-orm";
import { jobs, type AcceptedEventProjector } from "@armyofagents/db";
import { submitJobSourceSchema } from "@armyofagents/shared";
import { permissionRuntimeDecisionRequestV1Schema } from "@armyofagents/worker-protocol";
import { agentRuntimeDecisionService, runtimeDecisionPromptHash } from "./agent-runtime-decisions.js";
import {parseBrowserPreparation} from "./browser-runtime-preparation.js";

/** The accepted-event seam already holds the live fence. Creation and its
 * projection receipt share that savepoint; no approval can precede acceptance. */
export function createAcceptedBrowserApprovalProjector(): AcceptedEventProjector {
  return {
    projectionKind: "runtime_decision", aggregateKind: "agent_runtime_decisions",
    sourceIdentity(event, fence) {
      if (event.eventType !== "runtime_decision_requested") return null;
      const request = permissionRuntimeDecisionRequestV1Schema.safeParse(event.payload.payload);
      return request.success && ["browser.navigate", "browser.download","browser.session_credentials"].includes(request.data.toolName ?? "")
        ? `browser-approval:${fence.companyId}:${event.eventId}` : null;
    },
    async apply({ tx, event, fence }) {
      const [job] = await tx.select({ workloadType: jobs.workloadType, source: jobs.sourceIntent, sourceKind: jobs.sourceKind, sourceIdentity: jobs.sourceIdentity,policy:jobs.policySnapshot }).from(jobs).where(and(
        eq(jobs.id, fence.jobId), eq(jobs.companyId, fence.companyId), eq(jobs.organizationId, fence.organizationId)));
      const source = submitJobSourceSchema.safeParse(job?.source);
      if (!job || job.workloadType !== "browser_session" || job.sourceKind !== "browser_request" || !source.success ||
          source.data.kind !== "browser_request" || source.data.browserRequestId !== job.sourceIdentity) {
        throw new Error("browser approval source mismatch");
      }
      const request = permissionRuntimeDecisionRequestV1Schema.parse(event.payload.payload);
      const clock = await tx.execute(sql`select clock_timestamp() as now`);
      const authorityNow = new Date(clock[0].now as string | Date);
      const expiresAt = new Date(request.expiresAt);
      if (request.sourceRevision !== 0 || request.schemaVersion !== 1 || request.timeoutPolicy !== "deny" || request.defaultDecision !== null ||
          !(expiresAt.getTime() > new Date(authorityNow).getTime()) || expiresAt.getTime() > new Date(authorityNow).getTime() + 300_000 ||
          !["browser.navigate", "browser.download","browser.session_credentials"].includes(request.toolName ?? "") || request.command !== null || request.cwd !== null || request.path !== null) {
        throw new Error("invalid browser approval scope");
      }
      if(request.toolName==="browser.session_credentials") {
        const preparation=parseBrowserPreparation(job.policy.browserPreparation),binding=preparation?.sessionBinding;
        if(!binding || request.title!=="Use scoped browser session" || request.nonce!==binding.bindingId || request.networkTarget!==binding.origin || request.summary!==preparation.networkPolicy.digest || request.riskClass!=="credential_use")throw new Error("invalid scoped browser session permission");
      } else if (request.toolName === "browser.navigate") {
        let target: URL;
        try { target = new URL(request.networkTarget ?? ""); } catch { throw new Error("invalid browser approval destination"); }
        if (target.protocol !== "https:" || target.origin !== request.networkTarget || request.riskClass !== "network_egress") throw new Error("invalid browser approval destination");
      } else if (request.networkTarget !== null || request.riskClass !== "download") throw new Error("invalid browser download scope");
      if (request.requestDigest !== runtimeDecisionPromptHash({ kind: "permission", ...request, promptText: null })) throw new Error("browser approval digest mismatch");
      const { decision } = await agentRuntimeDecisionService(tx, { now: () => new Date(authorityNow) }).createPrompt({
        requestId: request.requestId, companyId: fence.companyId, agentId: null, runId: null, adapterType: "browser_runtime",
        kind: "permission", nonce: request.nonce, title: request.title, summary: request.summary, toolName: request.toolName,
        networkTarget: request.networkTarget, riskClass: request.riskClass, command: null, promptText: null, cwd: null, path: null,
        expiresAt, timeoutPolicy: "deny",
      });
      return { targetAggregateId: decision.id };
    },
  };
}

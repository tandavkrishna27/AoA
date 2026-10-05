import { brokeredAoaMcpConfig } from "@armyofagents/adapter-utils";
import { applySandboxOutputRootDirective } from "./sandbox-output-root.js";

/** Context for the worker's distributed sandbox, independent of legacy environment acquisition.
 * Called only while building a distributed task workload; a refused workload still falls back
 * through the unchanged legacy path. The deployment/Organization decision remains the MCP gate.
 */
export function prepareDistributedTaskRunContext(input: {
  adapterType: string;
  companyId: string;
  apiBaseUrl: string | undefined;
  toolSurfaceAuthorized: boolean;
  currentTaskMarkdown: unknown;
}): { currentTaskMarkdown: string; aoaMcpConfig: string | null } {
  return {
    currentTaskMarkdown: applySandboxOutputRootDirective({
      adapterType: input.adapterType,
      runTargetsSandbox: true,
      currentTaskMarkdown: input.currentTaskMarkdown,
    }),
    aoaMcpConfig: input.toolSurfaceAuthorized && input.apiBaseUrl
      ? brokeredAoaMcpConfig({ apiBaseUrl: input.apiBaseUrl, companyId: input.companyId })
      : null,
  };
}

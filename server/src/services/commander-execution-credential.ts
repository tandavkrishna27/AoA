import { submitJobSourceSchema } from "@armyofagents/shared";
export interface PlacementJobSource {
  sourceKind: string; sourceIdentity: string; sourceIntent: Record<string, unknown>; input: Record<string, unknown>;
}
export interface CommanderExecutionCredential {
  connectionId: string; secretId: string; provider: string; adapterType: string;
}
export const COMMANDER_CONNECTION_SELECTOR = "commander-connection:";
/** Both source and credential metadata come from trusted placement reads, never worker input. */
export function commanderAdapterForPlacement(input: {
  jobSource?: PlacementJobSource; commanderCredential?: CommanderExecutionCredential;
  executorPrincipalKind: string; executorPrincipalId: string;
}): "claude_local" | "codex_local" | null {
  const source = submitJobSourceSchema.safeParse(input.jobSource?.sourceIntent);
  const credential = input.commanderCredential;
  if (input.jobSource?.sourceKind !== "commander_turn" || !source.success || source.data.kind !== "commander_turn" ||
    input.executorPrincipalKind !== "sandbox" || input.executorPrincipalId !== source.data.internalAgentRunId ||
    input.jobSource.sourceIdentity !== source.data.internalAgentRunId || !credential ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(credential.connectionId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(credential.secretId)) return null;
  if (credential.provider === "openai" && credential.adapterType === "codex_local") return "codex_local";
  if (credential.provider === "anthropic" && credential.adapterType === "claude_local") return "claude_local";
  return null;
}

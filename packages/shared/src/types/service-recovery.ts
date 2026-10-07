/** Public operator metadata. Checkpoint bytes and storage authority stay private. */
export interface ServiceRecoveryMetadata<Time = string> {
  recovery: { action: "restart" } | { action: "wait"; until: Time } | { action: "pause" };
  checkpoint: {
    restoreArtifactId: string | null;
    latest: { artifactId: string; generation: number; createdAt: Time; expiresAt: Time | null; available: boolean } | null;
  };
  companyBudget: { amountCents: number; observedCents: number; hardStopEnabled: boolean; status: "ok" | "warning" | "hard_stop" } | null;
  instanceHistory: Array<{ serviceInstanceId: string; generation: number; status: string;
    terminalizedBy: string | null; lastObservedAt: Time | null; createdAt: Time; updatedAt: Time }>;
  historyLimit: number;
}

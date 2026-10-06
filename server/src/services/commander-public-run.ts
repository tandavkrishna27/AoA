/** Durable resource authority is internal; it is never a public run field. */
export function commanderPublicRun<T extends { distributedWarmState?: unknown; distributedWarmConversationId?: unknown }>(run: T): Omit<T, "distributedWarmState" | "distributedWarmConversationId"> {
  const publicRun = { ...run };
  delete publicRun.distributedWarmState;
  delete publicRun.distributedWarmConversationId;
  return publicRun;
}

import type { EffectAuthority } from "./effect-authority.js";
import type { ProviderOpContext } from "./provider.js";
import { readBrowserDecisionDelivery } from "./browser-decision.js";

export const BROWSER_APPROVAL_DIRECTORY = "/home/user/.aoa/browser-approvals";

/** The fixed provider operation has its own bounded ownership gate, so a
 * waiting guest execute cannot block the matched decision's mailbox write. */
export async function deliverBrowserApproval(input: {
  effect: Pick<EffectAuthority, "deliverBrowserDecision">;
  sandboxId: string;
  response: { requestId: string; decision: string; expiresAt: string };
  now(): number;
  ctx: ProviderOpContext;
}): Promise<void> {
  const delivery = readBrowserDecisionDelivery({ sandboxId: input.sandboxId, response: input.response }, input.now());
  const remainingMs = Date.parse(delivery.response.expiresAt) - input.now();
  if (!Number.isFinite(input.ctx.deadlineMs) || input.ctx.deadlineMs <= 0 || remainingMs <= 0) throw new Error("invalid browser approval response");
  const result = await input.effect.deliverBrowserDecision(delivery,
    { ...input.ctx, deadlineMs: Math.min(input.ctx.deadlineMs, remainingMs, 5000) });
  if (result.delivered !== true) throw new Error("browser approval write failed");
}

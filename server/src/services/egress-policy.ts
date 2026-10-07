import { NETWORK_DENIAL_CLASSES } from "@armyofagents/worker-protocol";
import type { ControlPlaneDenySet } from "@armyofagents/shared/egress-policy";
export { classifyEgressDestination, ipInCidr } from "@armyofagents/shared/egress-policy";
export type { ControlPlaneDenySet, EgressClassification, NetworkDenialClass } from "@armyofagents/shared/egress-policy";
import { parseIp } from "@armyofagents/shared/ip-literal";
/**
 * Resolve the config-sourced control-plane deny set from the environment. The
 * `AOA_CONTROL_PLANE_DENY_CIDRS` var is a comma/whitespace-separated list of CIDRs
 * or bare IP literals (the control plane's own address(es) that must never be an
 * egress destination). Absent → empty (no config-driven control-plane denial;
 * metadata + private still apply).
 */
export function resolveControlPlaneDenySet(
  env: Record<string, string | undefined> = process.env,
): ControlPlaneDenySet {
  const raw = env.AOA_CONTROL_PLANE_DENY_CIDRS ?? "";
  const cidrs = raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return { cidrs };
}

/** Re-exported for the vectors gate's dual-driven contract (D5). */
/** Re-exported so this module's public surface is unchanged: the implementation now
 * lives in ./ip-literal.ts, which `outbound-url-guard.ts` shares. */
export { parseIp };

export { NETWORK_DENIAL_CLASSES };

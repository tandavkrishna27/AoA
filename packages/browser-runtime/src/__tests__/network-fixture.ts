import { canonicalizeJsonV1 } from "@armyofagents/worker-protocol";
import { createHash } from "node:crypto";
import type { NetworkPolicyV1 } from "@armyofagents/worker-protocol";
export function fixtureNetwork(allow: NetworkPolicyV1["allow"] = [{ scheme: "https", host: "allowed.example", port: 443 }]) {
  const body = { policyId: "browser-egress", version: 1, defaultAction: "deny" as const, allow,
    denyPrivateNetworks: true as const, denyMetadata: true as const, denyControlPlane: true as const };
  return { networkPolicy: { ...body, digest: createHash("sha256").update(canonicalizeJsonV1(body)).digest("hex") }, controlPlaneDenyCidrs: ["8.8.8.8/32"] };
}

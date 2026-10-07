import { createHash } from "node:crypto";
import type { NetworkPolicyV1 } from "@armyofagents/worker-protocol";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function fixtureNetwork(allow: NetworkPolicyV1["allow"] = [{ scheme: "https", host: "allowed.example", port: 443 }]) {
  const body = { policyId: "browser-egress", version: 1, defaultAction: "deny" as const, allow,
    denyPrivateNetworks: true as const, denyMetadata: true as const, denyControlPlane: true as const };
  return { networkPolicy: { ...body, digest: createHash("sha256").update(canonical(body)).digest("hex") }, controlPlaneDenyCidrs: ["8.8.8.8/32"] };
}

import { createHash } from "node:crypto";
import { z } from "zod";
import { parseIp, resolveControlPlaneDenySet } from "../services/egress-policy.js";
import { canonicalizeJsonV1, networkAllowRuleSchema, networkPolicyV1Schema, type NetworkPolicyV1 } from "@armyofagents/worker-protocol";

export const DISTRIBUTED_NETWORK_POLICIES_ENV = "AOA_DISTRIBUTED_NETWORK_POLICIES";
export function resolveBrowserControlPlaneDenyCidrs(env: Record<string, string | undefined> = process.env): string[] {
  const cidrs = [...resolveControlPlaneDenySet(env).cidrs];
  if (cidrs.length > 128 || cidrs.some((entry) => {
    if (entry.length > 80 || entry.includes("%") || entry.includes("[") || entry.includes("]")) return true;
    const parts = entry.split("/"); const ip = parseIp(parts[0]!);
    return !ip || parts.length > 2 || (parts.length === 2 && (!/^\d+$/.test(parts[1]!) || Number(parts[1]) > (ip.family === 4 ? 32 : 128)));
  })) throw new Error("invalid control-plane deny configuration");
  return [...new Set(cidrs)];
}
const configuredPolicySchema = z.object({ policyId: z.string().min(1).max(200), version: z.number().int().positive(),
  allow: z.array(z.custom<NetworkPolicyV1["allow"][number]>((value) => networkAllowRuleSchema.safeParse(value).success)).max(256)
    .refine((rules) => new Set(rules.map((rule) => `${rule.host}:${rule.port}`)).size === rules.length, "duplicate network rule")
    .refine((rules) => rules.every((rule) => rule.host.includes(".") && ![".localhost", ".local", ".internal"].some((suffix) => rule.host.endsWith(suffix))), "public DNS rule required") }).strict();
const policiesSchema = z.record(z.string().uuid(), z.record(z.string().uuid(), configuredPolicySchema));

function rejectDuplicateJsonKeys(raw: string): void {
  // JSON.parse has already checked syntax. Tokenize strings as single tokens so
  // escaped quotes and braces in strings cannot masquerade as structural keys.
  const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^{}\[\]:,\s]+/g) ?? [];
  const stack: Array<{ object: boolean; keys: Set<string>; expectKey: boolean }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "{" || token === "[") stack.push({ object: token === "{", keys: new Set(), expectKey: token === "{" });
    else if (token === "}" || token === "]") stack.pop();
    else {
      const context = stack.at(-1);
      if (!context?.object) continue;
      if (token === ",") context.expectKey = true;
      else if (context.expectKey && token.startsWith('"') && tokens[i + 1] === ":") {
        const key = JSON.parse(token) as string;
        if (context.keys.has(key)) throw new Error("duplicate network policy configuration key");
        context.keys.add(key); context.expectKey = false;
      }
    }
  }
}

/** Trusted server configuration, keyed by BOTH tenant identities. A rule never
 * originates in an agent request. The server hashes the complete policy body. */
export function parseDistributedNetworkPolicies(raw: string | undefined): Map<string, NetworkPolicyV1> {
  if (!raw?.trim()) return new Map();
  if (Buffer.byteLength(raw, "utf8") > 262_144) throw new Error("network policy configuration too large");
  const decoded: unknown = JSON.parse(raw);
  rejectDuplicateJsonKeys(raw);
  const configured = policiesSchema.parse(decoded);
  const policies = new Map<string, NetworkPolicyV1>();
  for (const [organizationId, companies] of Object.entries(configured)) for (const [companyId, config] of Object.entries(companies)) {
    if (policies.size >= 128) throw new Error("too many configured network policies");
    const body = { policyId: config.policyId, version: config.version, defaultAction: "deny" as const, allow: config.allow,
      denyPrivateNetworks: true as const, denyMetadata: true as const, denyControlPlane: true as const };
    const policy = networkPolicyV1Schema.parse({ ...body, digest: createHash("sha256").update(canonicalizeJsonV1(body)).digest("hex") });
    policies.set(`${organizationId}:${companyId}`, policy);
  }
  return policies;
}

let cachedRaw: string | undefined;
let cachedPolicies = new Map<string, NetworkPolicyV1>();
export function resolveDistributedNetworkPolicy(organizationId: string, companyId: string, env: Record<string, string | undefined> = process.env): NetworkPolicyV1 | null {
  const raw = env[DISTRIBUTED_NETWORK_POLICIES_ENV];
  if (raw !== cachedRaw) { const parsed = parseDistributedNetworkPolicies(raw); cachedPolicies = parsed; cachedRaw = raw; }
  const policy = cachedPolicies.get(`${organizationId}:${companyId}`);
  return policy ? structuredClone(policy) : null;
}

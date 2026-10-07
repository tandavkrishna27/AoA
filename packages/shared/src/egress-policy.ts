import { parseIp } from "./ip-literal.js";
import { isPrivateIP } from "./private-ip.js";
export interface EgressNetworkPolicy { readonly allow: readonly { readonly scheme: "https"; readonly host: string; readonly port: number }[] }
/** The frozen network-denial destination classes (`NETWORK_DENIAL_CLASSES`). */
export type NetworkDenialClass = "metadata" | "private" | "control_plane" | "not_allowlisted";
export type EgressClassification = "allow" | NetworkDenialClass;

/** The config-sourced control-plane deny ranges (CIDRs or bare IP literals). */
export interface ControlPlaneDenySet {
  readonly cidrs: readonly string[];
}

/**
 * Well-known cloud metadata endpoints (industry constants, not deployment config).
 * `isPrivateIP` also catches 169.254.0.0/16 as link-local, so these only make the
 * REPORTED class more specific; a miss still fails closed as `private`.
 */
const METADATA_DENY_CIDRS: readonly string[] = [
  "169.254.169.254/32", // AWS/GCP/Azure/OpenStack IMDS
  "169.254.170.2/32", // AWS ECS task metadata
  "fd00:ec2::254/128", // AWS IMDS over IPv6
];

const DENY_SEVERITY: Record<NetworkDenialClass, number> = {
  metadata: 4,
  control_plane: 3,
  private: 2,
  not_allowlisted: 1,
};

// --- CIDR matching (pure, family-aware) --------------------------------------
//
// W13 — the IP-literal GRAMMAR moved to ./ip-literal.ts, unchanged. It used to live
// here in `parseIpv4`/`parseIpv6Value`/`parseIp` while `outbound-url-guard.ts` carried
// a SECOND, stricter copy that rejected an embedded dotted quad. One grammar, one file,
// two importers; the CIDR arithmetic below stays here because it is this module's.

/** True iff `ip` falls inside `cidr` (a CIDR block or a bare IP literal treated as
 * a host route). Families must match. */
export function ipInCidr(ip: string, cidr: string): boolean {
  const parsedIp = parseIp(ip);
  if (!parsedIp) return false;
  const slash = cidr.indexOf("/");
  const baseStr = slash === -1 ? cidr : cidr.slice(0, slash);
  const parsedBase = parseIp(baseStr.trim());
  if (!parsedBase) return false;
  if (parsedIp.family !== parsedBase.family) return false;
  const bits = parsedIp.family === 4 ? 32 : 128;
  let prefix: number;
  if (slash === -1) {
    prefix = bits;
  } else {
    const raw = Number(cidr.slice(slash + 1));
    if (!Number.isInteger(raw) || raw < 0 || raw > bits) return false;
    prefix = raw;
  }
  if (prefix === 0) return true;
  const shift = BigInt(bits - prefix);
  return (parsedIp.value >> shift) === (parsedBase.value >> shift);
}

function inAnyCidr(ip: string, cidrs: readonly string[]): boolean {
  for (const cidr of cidrs) {
    if (cidr && ipInCidr(ip, cidr)) return true;
  }
  return false;
}

// --- The per-address classification + the public classifier ------------------

function classifyAddress(addr: string, controlPlane: ControlPlaneDenySet): NetworkDenialClass | null {
  // Unparseable resolved address → cannot confirm public → fail-closed deny.
  if (!parseIp(addr)) return "private";
  if (inAnyCidr(addr, METADATA_DENY_CIDRS)) return "metadata";
  if (inAnyCidr(addr, controlPlane.cidrs)) return "control_plane";
  if (isPrivateIP(addr)) return "private";
  return null;
}

/** True iff `url` is https, its host is a member of `policy.allow`, and its port
 * matches that rule. `not_allowlisted` otherwise (parse failures included). */
function isAllowlisted(url: string, policy: EgressNetworkPolicy): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const port = parsed.port === "" ? 443 : Number(parsed.port);
  if (!Number.isInteger(port)) return false;
  return policy.allow.some((rule) => rule.scheme === "https" && rule.host === host && rule.port === port);
}

/**
 * THE pure default-deny egress destination decision (D1). Returns `'allow'` or the
 * frozen denial class. `controlPlane` defaults to the empty set (the pure fn stays
 * deterministic — the proxy passes `resolveControlPlaneDenySet()`, the vectors gate
 * passes the fixture's set).
 */
export function classifyEgressDestination(
  requestedUrl: string,
  resolvedAddrs: readonly string[],
  policy: EgressNetworkPolicy,
  controlPlane: ControlPlaneDenySet = { cidrs: [] },
): EgressClassification {
  // 1. Allowlist gate (host/scheme/port). A non-allowlisted destination is refused
  //    regardless of where it resolves — the default-deny posture.
  if (!isAllowlisted(requestedUrl, policy)) return "not_allowlisted";

  // 2. IP-range gate. Deny if ANY resolved address is unsafe; an empty/unverifiable
  //    resolution is fail-closed `private`.
  if (resolvedAddrs.length === 0) return "private";
  let worst: NetworkDenialClass | null = null;
  for (const addr of resolvedAddrs) {
    const cls = classifyAddress(addr, controlPlane);
    if (cls && (worst === null || DENY_SEVERITY[cls] > DENY_SEVERITY[worst])) worst = cls;
  }
  return worst ?? "allow";
}


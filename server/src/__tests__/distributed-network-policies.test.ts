import { describe, expect, it } from "vitest";
import { parseDistributedNetworkPolicies, resolveDistributedNetworkPolicy, resolveBrowserControlPlaneDenyCidrs, DISTRIBUTED_NETWORK_POLICIES_ENV } from "../config/distributed-network-policies.js";
import { parseAuthoritativeBrowserPolicy } from "../services/browser-runtime-preparation.js";
const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const configured = { policyId: "example-egress", version: 2, allow: [{ scheme: "https", host: "example.com", port: 443 }] };
const raw = JSON.stringify({ [org]: { [company]: configured } });
describe("server-authored distributed network policy snapshots", () => {
  it("requires explicit valid bounded control-plane address authority", () => {
    expect(resolveBrowserControlPlaneDenyCidrs({})).toEqual([]);
    expect(resolveBrowserControlPlaneDenyCidrs({AOA_CONTROL_PLANE_DENY_CIDRS:"203.0.113.8/32,2001:db8::/64"})).toEqual(["203.0.113.8/32","2001:db8::/64"]);
    for (const raw of ["invalid/32", "203.0.113.8/33", "2001:db8::/129", "203.0.113.8/", "::1%eth0", Array.from({length:129},()=>"203.0.113.8").join(",")]) expect(()=>resolveBrowserControlPlaneDenyCidrs({AOA_CONTROL_PLANE_DENY_CIDRS:raw})).toThrow();
  });
  it("authors digest from actual complete default-deny bytes", () => {
    const policy = parseDistributedNetworkPolicies(raw).get(`${org}:${company}`)!;
    expect(parseAuthoritativeBrowserPolicy(policy)).toEqual(policy);
    expect(policy).toMatchObject({ defaultAction: "deny", denyPrivateNetworks: true, denyMetadata: true, denyControlPlane: true });
    expect(parseDistributedNetworkPolicies(JSON.stringify({ [org]: { [company]: { allow: configured.allow, version: 2, policyId: configured.policyId } } })).get(`${org}:${company}`)).toEqual(policy);
  });
  it("does not reuse a company's authority across either tenant identity", () => {
    const env = { [DISTRIBUTED_NETWORK_POLICIES_ENV]: raw };
    expect(resolveDistributedNetworkPolicy(org, company, env)).not.toBeNull();
    expect(resolveDistributedNetworkPolicy(org, other, env)).toBeNull();
    expect(resolveDistributedNetworkPolicy(other, company, env)).toBeNull();
    expect(resolveDistributedNetworkPolicy(org, company, {})).toBeNull();
  });
  it("returns independent immutable-intent snapshots", () => {
    const env = { [DISTRIBUTED_NETWORK_POLICIES_ENV]: raw };
    const first = resolveDistributedNetworkPolicy(org, company, env)!;
    first.allow.length = 0;
    expect(resolveDistributedNetworkPolicy(org, company, env)!.allow).toHaveLength(1);
  });
  it.each([
    { ...configured, allow: [...configured.allow, ...configured.allow] },
    { ...configured, allow: [{ scheme: "https", host: "127.0.0.1", port: 443 }] },
    { ...configured, allow: [{ scheme: "http", host: "example.com", port: 80 }] },
    { ...configured, defaultAction: "allow" },
    { ...configured, digest: "a".repeat(64) },
  ])("rejects unsafe, duplicated or caller-digested policy %j", (policy) => {
    expect(() => parseDistributedNetworkPolicies(JSON.stringify({ [org]: { [company]: policy } }))).toThrow();
  });
  it("rejects duplicate and escaped duplicate configuration keys", () => {
    expect(() => parseDistributedNetworkPolicies(`{"${org}":{"${company}":${JSON.stringify(configured)},"${company}":${JSON.stringify(configured)}}}`)).toThrow("duplicate");
    expect(() => parseDistributedNetworkPolicies(`{"${org}":{"${company}":{"policyId":"x","\\u0070olicyId":"y","version":1,"allow":[]}}}`)).toThrow("duplicate");
  });
  it("bounds configuration size and rejects malformed JSON", () => {
    expect(() => parseDistributedNetworkPolicies(" ".repeat(262145) + "{}")).toThrow("too large");
    expect(() => parseDistributedNetworkPolicies("{" )).toThrow();
  });
});

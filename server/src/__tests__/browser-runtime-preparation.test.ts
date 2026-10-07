import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalizeJsonV1 } from "@armyofagents/worker-protocol";
import { browserSessionRequestSchema, buildBrowserRunnerConfig, parseAuthoritativeBrowserPolicy } from "../services/browser-runtime-preparation.js";

const body = { policyId: "parent-egress", version: 1, defaultAction: "deny", allow: [{ scheme: "https", host: "example.com", port: 443 }], denyPrivateNetworks: true, denyMetadata: true, denyControlPlane: true };
const policy = { ...body, digest: createHash("sha256").update(canonicalizeJsonV1(body)).digest("hex") };

describe("trusted browser runtime preparation", () => {
  it("fails closed when explicit parent control-plane addresses are absent", () => {
    const request = browserSessionRequestSchema.parse({idempotencyKey:"one",urls:["https://example.com/"]});
    expect(()=>buildBrowserRunnerConfig(request,policy)).toThrow("control-plane deny authority unavailable");
  });
  it("requires actual digest-bound policy bytes, not a placement reference", () => {
    expect(parseAuthoritativeBrowserPolicy({ policyId: policy.policyId, version: 1, digest: policy.digest })).toBeNull();
    expect(parseAuthoritativeBrowserPolicy({ ...policy, digest: "f".repeat(64) })).toBeNull();
    expect(parseAuthoritativeBrowserPolicy(policy)).toEqual(policy);
  });
  it("never expands the inherited policy to requested URLs", () => {
    const request = browserSessionRequestSchema.parse({ idempotencyKey: "browser-one", urls: ["https://other.example/"] });
    expect(() => buildBrowserRunnerConfig(request, policy, ["203.0.113.8/32"])).toThrow("outside parent network policy");
    expect(policy.allow).toEqual(body.allow);
  });
  it.each(["http://example.com/", "https://user:secret@example.com/", "https://127.0.0.1/", "https://example.com/?token=secret"])("refuses unsafe URL %s", (url) => {
    expect(browserSessionRequestSchema.safeParse({ idempotencyKey: "browser-one", urls: [url] }).success).toBe(false);
  });
  it("authors fixed paths, approval gate and bounded frozen settings", () => {
    const request = browserSessionRequestSchema.parse({ idempotencyKey: "browser-one", urls: ["https://example.com/docs"], options: { viewport: { width: 800, height: 600 }, recordTrace: true } });
    const { config, workload } = buildBrowserRunnerConfig(request, policy, ["203.0.113.8/32"]);
    expect(config).toMatchObject({ requireApproval: true, approvalDirectory: "/home/user/.aoa/browser-approvals", userDataDir: "/home/user/.aoa/browser-profile", downloadRoot: "/home/user/aoa-output", steps: [{ action: "navigate", url: "https://example.com/docs" }] });
    expect(config.launch).toMatchObject({ chromiumSandbox: true, viewport: workload.viewport });
    expect(workload.recordTrace).toBe(true);
    expect(browserSessionRequestSchema.safeParse({ ...request, parentJobId: "caller-selected" }).success).toBe(false);
  });
});

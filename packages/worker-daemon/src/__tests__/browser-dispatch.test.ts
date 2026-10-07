import { describe, expect, it } from "vitest";
import { leaseOfferV1Schema, verifyWorkerEventDigestV1, controlCommandV1Schema } from "@armyofagents/worker-protocol";
import { browserDispatchRefusal, BROWSER_CONFIG_PATH, BROWSER_RUNNER_PATH } from "../supervisor/browser-dispatch.js";
import { STAGED_INPUT_EXTENSION_NAMESPACE } from "../lease/staged-input.js";
import { createSupervisor } from "../supervisor/supervisor.js";
import { createFakeSandboxProvider } from "./support/fake-provider.js";
import { collectingSink, makeHandoff, SUPERVISOR_IDENTITY, waitFor } from "./support/supervisor-fixtures.js";
import { sha256hex } from "./support/poll-fixtures.js";
import { makeSelfModel } from "./support/poll-fixtures.js";
import { createHash } from "node:crypto";
import { canonicalizeJsonV1 } from "@armyofagents/worker-protocol";
import { BROWSER_DISPATCH_NAMESPACE } from "../supervisor/browser-dispatch.js";

function browser(paths: string[] = []) {
  const base = makeHandoff();
  const principal = base.offer.job.source.executionPrincipal;
  const policyBody = { policyId: "browser-policy", version: 1, defaultAction: "deny", allow: [], denyPrivateNetworks: true, denyMetadata: true, denyControlPlane: true };
  const digest = createHash("sha256").update(canonicalizeJsonV1(policyBody)).digest("hex");
  const offer = leaseOfferV1Schema.parse({ ...base.offer, job: { ...base.offer.job,
    workloadType: "browser_session", source: { kind: "browser_request",
      browserRequestId: "77777777-7777-4777-8777-777777777777", parentJobId: null,
      requestedBy: principal, executionPrincipal: principal },
    workload: { engine: "chromium", viewport: { width: 1280, height: 800 }, locale: "en-US",
      timezone: "UTC", recordTrace: false, recordVideo: false, maxSessionSeconds: 60 },
    networkPolicy: { policyId: policyBody.policyId, version: 1, digest },
    extensions: [{ namespace: BROWSER_DISPATCH_NAMESPACE, schemaVersion: 1, critical: false, value: {
      runnerPath: BROWSER_RUNNER_PATH, configPath: BROWSER_CONFIG_PATH, networkPolicy: { ...policyBody, digest },
    } }, ...(paths.length ? [{ namespace: STAGED_INPUT_EXTENSION_NAMESPACE, schemaVersion: 1, critical: false,
      value: { files: paths.map((path, index) => ({ id: `artifact-${index}`, path, key: `key-${index}`, sha256: "a".repeat(64), size: 10 })) } }] : [])],
  } });
  return { ...base, offer, workloadClass: "browser_session" as const };
}

describe("browser dispatch prerequisites", () => {
  it("requires control-plane staged runner and config", () => {
    expect(browserDispatchRefusal(browser())).toBe("browser_staging_invalid");
    expect(browserDispatchRefusal(browser([BROWSER_RUNNER_PATH]))).toBe("browser_staging_invalid");
  });
  it.each(["/home/user/.aoa/browser-runtime/../runner.js", "/etc/passwd", BROWSER_RUNNER_PATH])(
    "rejects unsafe or duplicate staged path %s", (extra) => {
      expect(browserDispatchRefusal(browser([BROWSER_RUNNER_PATH, BROWSER_CONFIG_PATH, extra]))).toBe("browser_staging_invalid");
    });
  it("a frozen policy ref cannot assert provider network enforcement", () => {
    expect(browserDispatchRefusal(browser([BROWSER_RUNNER_PATH, BROWSER_CONFIG_PATH]))).toBe("browser_network_authority_unavailable");
  });
  it("rejects policy body/ref digest mismatch even with a verified fake self-model", () => {
    const handoff = browser([BROWSER_RUNNER_PATH, BROWSER_CONFIG_PATH]);
    handoff.offer.job.networkPolicy.digest = "b".repeat(64);
    expect(browserDispatchRefusal(handoff, true)).toBe("browser_network_policy_invalid");
  });
  it("duplicate staging extension fails closed", () => {
    const handoff = browser([BROWSER_RUNNER_PATH, BROWSER_CONFIG_PATH]);
    handoff.offer.job.extensions.push(handoff.offer.job.extensions[1]);
    expect(browserDispatchRefusal(handoff, true)).toBe("browser_staging_invalid");
  });
  it("verified self-model alone cannot authorize an unverified provider", async () => {
    const provider = createFakeSandboxProvider(); const sink = collectingSink();
    const supervisor = createSupervisor({ provider, browserSelfModel: await makeSelfModel(), identity: SUPERVISOR_IDENTITY,
      eventSink: sink, redactionCanaries: [], resolveStagedFiles: async () => [] });
    await supervisor.accept(browser([BROWSER_RUNNER_PATH, BROWSER_CONFIG_PATH]));
    expect(provider.callCount("create")).toBe(0);
    expect(sink.events.at(-1)?.payload).toMatchObject({ errorCode: "browser_network_authority_unavailable" });
  });
  it("rejects a mismatched source", () => {
    const handoff = browser();
    handoff.offer.job.source = makeHandoff().offer.job.source;
    expect(browserDispatchRefusal(handoff)).toBe("browser_contract_invalid");
  });
  it("executes fixed node guest runner only after provider attests exact installed policy", async () => {
    const handoff = browser([BROWSER_RUNNER_PATH, BROWSER_CONFIG_PATH]);
    const fake = createFakeSandboxProvider({ stdoutChunks: [JSON.stringify({ type: "session_started", steps: 0 }) + "\n", JSON.stringify({ type: "session_completed", savedDownloads: [] }) + "\n"] });
    const provider = { ...fake, browserNetworkPolicyMode: "verified_default_deny" as const,
      stageFiles: async (_sandbox: string, files: readonly { path: string }[]) => ({ stagedPaths: files.map((file) => file.path) }),
      create: async (...args: Parameters<typeof fake.create>) => ({ ...await fake.create(...args), browserNetworkPolicyDigest: args[0].browserNetworkPolicy?.digest }) };
    const sink = collectingSink();
    const supervisor = createSupervisor({ provider, browserSelfModel: await makeSelfModel(), identity: SUPERVISOR_IDENTITY,
      eventSink: sink, redactionCanaries: [], resolveStagedFiles: async () => [BROWSER_RUNNER_PATH, BROWSER_CONFIG_PATH].map((path, index) => ({ path, grant: {
        protocolVersion: 1, operation: "download", method: "GET", artifactId: `artifact-${index}`,
        objectKey: `key-${index}`, expectedSha256: "a".repeat(64), maxBytes: 10, url: "https://store.example/get", headers: {},
        issuedAt: "2026-10-07T00:00:00Z", expiresAt: "2026-10-07T01:00:00Z", redaction: "secret",
      } })) });
    await supervisor.accept(handoff);
    expect(fake.callCount("execute")).toBe(1);
    const executed = fake.calls().find((call) => call.op === "execute");
    expect(executed).toBeDefined();
    expect(sink.events.map((event) => event.eventType)).toEqual(["attempt_started", "browser_observation", "browser_observation", "terminal"]);
    expect(sink.events.at(-1)?.payload).toMatchObject({ status: "succeeded" });
  });
  it.each(["completed", "cancelled", "lease_lost"] as const)("supervisor approval delivery closes on %s", async (outcome) => {
    const handoff = browser([BROWSER_RUNNER_PATH, BROWSER_CONFIG_PATH]); const fake = createFakeSandboxProvider(); const sink = collectingSink();
    let finish!: () => void; const gate = new Promise<void>((resolve) => { finish = resolve; });
    let delivered = 0;
    const provider = { ...fake, browserNetworkPolicyMode: "verified_default_deny" as const,
      create: async (...args: Parameters<typeof fake.create>) => ({ ...await fake.create(...args), browserNetworkPolicyDigest: args[0].browserNetworkPolicy?.digest }),
      stageFiles: async (_sandbox: string, files: readonly { path: string }[]) => ({ stagedPaths: files.map((file) => file.path) }),
      execute: async (...args: Parameters<typeof fake.execute>) => {
        const input = args[0];
        if (input.args[0] === BROWSER_RUNNER_PATH) {
          expect(input.command).toBe("node"); expect(input.args).toEqual([BROWSER_RUNNER_PATH, BROWSER_CONFIG_PATH]);
          input.onStdout?.(JSON.stringify({ type: "approval_requested", requestId: "77777777-7777-4777-8777-777777777777",
            expiresAt: new Date(Date.now() + 30000).toISOString(), intent: { action: "navigate", title: "credential-canary", summary: null,
              networkTarget: "https://example.com", riskClass: "network_egress" } }) + "\n");
          await gate;
          input.onStdout?.(JSON.stringify({ type: "session_completed", savedDownloads: [] }) + "\n");
        } else { delivered++; expect(input.args[0]).toBe("-e"); }
        return fake.execute({ ...input, onStdout: undefined }, args[1]);
      } };
    const supervisor = createSupervisor({ provider, browserSelfModel: await makeSelfModel(), identity: SUPERVISOR_IDENTITY, eventSink: sink,
      redactionCanaries: ["credential-canary"], resolveStagedFiles: async () => [BROWSER_RUNNER_PATH, BROWSER_CONFIG_PATH].map((path, index) => ({ path, grant: {
        protocolVersion: 1, operation: "download", method: "GET", artifactId: `artifact-${index}`, objectKey: `key-${index}`,
        expectedSha256: "a".repeat(64), maxBytes: 10, url: "https://store.example/get", headers: {}, issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(), redaction: "secret" } })) });
    const running = supervisor.accept(handoff);
    await waitFor(() => sink.events.some((event) => event.eventType === "runtime_decision_requested"));
    const event = sink.events.find((entry) => entry.eventType === "runtime_decision_requested")!;
    expect(JSON.stringify(event)).not.toContain("credential-canary");
    const request = event.payload as import("@armyofagents/worker-protocol").PermissionRuntimeDecisionRequestV1;
    const command = controlCommandV1Schema.parse({ protocolVersion: 1, audience: "control_channel", organizationId: event.organizationId,
      companyId: event.companyId, workerId: event.workerId, jobId: event.jobId, attempt: event.attempt, leaseId: event.leaseId,
      fenceToken: event.fenceToken, commandId: "88888888-8888-4888-8888-888888888888", commandSeq: 1,
      idempotencyKey: "88888888-8888-4888-8888-888888888888", issuedAt: new Date().toISOString(), nonce: "control-nonce", commandKind: "runtime_decision_result",
      result: { decisionKind: "permission", requestId: request.requestId, nonce: request.nonce, requestDigest: request.requestDigest,
        schemaVersion: 1, sourceRevision: request.sourceRevision, expiresAt: request.expiresAt, timeoutPolicy: "deny",
        decidedBy: { principalType: "user", principalId: "founder" }, decidedAt: new Date().toISOString(),
        idempotencyKey: "88888888-8888-4888-8888-888888888888", decision: "allow_once" } });
    await supervisor.applyBrowserDecision!(command); await supervisor.applyBrowserDecision!(command);
    expect(delivered).toBe(1);
    if (outcome === "cancelled") await supervisor.cancel(handoff.leaseId);
    if (outcome === "lease_lost") await supervisor.onLeaseLost(handoff.leaseId);
    if (outcome !== "completed") await expect(supervisor.applyBrowserDecision!(command)).rejects.toThrow("closed");
    finish(); await running;
    await expect(supervisor.applyBrowserDecision!(command)).rejects.toThrow("unavailable");
    expect(sink.events.at(-1)?.payload).toMatchObject({ status: outcome === "completed" ? "succeeded" : "cancelled" });
  });
  it("actual supervisor refuses before secrets, create or generic execute and emits a fenced digest-valid terminal", async () => {
    const provider = createFakeSandboxProvider(); const sink = collectingSink(); let redeemed = false;
    const supervisor = createSupervisor({ provider, identity: SUPERVISOR_IDENTITY, eventSink: sink, redactionCanaries: [],
      materializeRunSecrets: async () => { redeemed = true; return { env: {}, canaries: [] }; } });
    await supervisor.accept(browser([BROWSER_RUNNER_PATH, BROWSER_CONFIG_PATH]));
    expect(redeemed).toBe(false); expect(provider.callCount("create")).toBe(0); expect(provider.callCount("execute")).toBe(0);
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0].eventType).toBe("terminal");
    expect(sink.events[0].payload).toMatchObject({ status: "failed", errorCode: "browser_network_authority_unavailable" });
    expect(await verifyWorkerEventDigestV1(sink.events[0], sha256hex)).toBe(true);
    expect(supervisor.activeRunCount()).toBe(0);
  });
});

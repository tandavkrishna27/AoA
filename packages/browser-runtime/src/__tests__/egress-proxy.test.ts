import { canonicalizeJsonV1 } from "@armyofagents/worker-protocol";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { connect } from "node:net";
import { startBrowserEgressProxy, validateBrowserNetworkConfig } from "../egress-proxy.js";
const body = { policyId: "browser-egress", version: 1, defaultAction: "deny", allow: [{ scheme: "https", host: "allowed.example", port: 443 }],
  denyPrivateNetworks: true, denyMetadata: true, denyControlPlane: true };
export const network = { networkPolicy: { ...body, digest: createHash("sha256").update(canonicalizeJsonV1(body)).digest("hex") }, controlPlaneDenyCidrs: ["8.8.8.8/32"] };
describe("guest default deny egress", () => {
  it("closes pending DNS connections without dialing after cancellation", async () => {
    let finishDns!: (addresses: string[]) => void; let observed!: () => void;
    const started = new Promise<void>((resolve) => { observed = resolve; }); let connects = 0;
    const proxy = await startBrowserEgressProxy(network, { resolve: () => { observed(); return new Promise<string[]>((resolve) => { finishDns = resolve; }); },
      dial: () => { connects++; throw new Error("closed"); } });
    const socket = connect(proxy.port, "127.0.0.1", () => socket.write("CONNECT allowed.example:443 HTTP/1.1\r\n\r\n"));
    const closed = new Promise<void>((resolve) => socket.once("close", resolve));
    await started; await proxy.close(); finishDns(["93.184.216.34"]); await closed;
    expect(connects).toBe(0);
  });
  it("requires a canonical policy and nonempty valid control-plane deny set", () => {
    expect(validateBrowserNetworkConfig(network).networkPolicy.digest).toBe(network.networkPolicy.digest);
    expect(() => validateBrowserNetworkConfig({ ...network, controlPlaneDenyCidrs: [] })).toThrow();
    expect(() => validateBrowserNetworkConfig({ ...network, controlPlaneDenyCidrs: ["bad/33"] })).toThrow();
    expect(() => validateBrowserNetworkConfig({ ...network, networkPolicy: { ...network.networkPolicy, version: 2 } })).toThrow();
  });
  it.each([
    ["unknown.example:443", ["93.184.216.34"], "not_allowlisted"],
    ["allowed.example:80", ["93.184.216.34"], "not_allowlisted"],
    ["allowed.example:443", ["169.254.169.254"], "metadata"],
    ["allowed.example:443", ["93.184.216.34", "127.0.0.1"], "private"],
    ["allowed.example:443", ["8.8.8.8"], "control_plane"],
    ["127.0.0.1:443", ["127.0.0.1"], "not_allowlisted"],
  ])("denies %s without dialing or leaking destination", async (authority, addresses, destinationClass) => {
    const denied: string[] = []; let connects = 0;
    const proxy = await startBrowserEgressProxy(network, { resolve: async () => addresses as string[],
      dial: () => { connects++; throw new Error("must not dial"); }, denied: (value) => denied.push(value) });
    try {
      const response = await new Promise<string>((resolve, reject) => {
        const socket = connect(proxy.port, "127.0.0.1", () => socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
        socket.on("data", (data) => { resolve(data.toString()); socket.destroy(); }); socket.on("error", reject);
      });
      expect(response).toContain("403"); expect(connects).toBe(0); expect(denied).toEqual([destinationClass]);
    } finally { await proxy.close(); }
  });
});

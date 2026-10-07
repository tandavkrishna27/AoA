import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseBrowserSessionBindings,
  resolveBrowserSessionBindings,
  BROWSER_SESSION_BINDINGS_ENV,
} from "../config/browser-session-bindings.js";
import { buildBrowserRunnerConfig } from "../services/browser-runtime-preparation.js";
import { parseDistributedNetworkPolicies } from "../config/distributed-network-policies.js";
const org = randomUUID(),
  company = randomUUID();
const binding = {
  bindingId: randomUUID(),
  connectorId: randomUUID(),
  origin: "https://example.com",
  exchangeUrl: "https://example.com/login",
  cookieName: "__Host-session",
};
const config = { [org]: { [company]: [binding] } };
const policy = parseDistributedNetworkPolicies(
  JSON.stringify({
    [org]: {
      [company]: {
        policyId: "test",
        version: 1,
        allow: [{ scheme: "https", host: "example.com", port: 443 }],
      },
    },
  })
).get(`${org}:${company}`)!;
describe("trusted scoped browser bindings", () => {
  it("requires exact organization/company configuration and returns independent snapshots", () => {
    const env = { [BROWSER_SESSION_BINDINGS_ENV]: JSON.stringify(config) };
    expect(resolveBrowserSessionBindings(org, randomUUID(), env)).toEqual([]);
    const first = resolveBrowserSessionBindings(org, company, env);
    first[0]!.origin = "https://wrong.example";
    expect(resolveBrowserSessionBindings(org, company, env)).toEqual([binding]);
    expect(parseBrowserSessionBindings(undefined).size).toBe(0);
  });
  it.each([
    { cookieName: "__Host-" + "a".repeat(65) },
    { exchangeUrl: "https://other.example/login" },
    { exchangeUrl: "http://example.com/login" },
    { exchangeUrl: "https://example.com/login?token=x" },
    { origin: "https://example.com/" },
  ])("refuses invalid trusted binding %o", (patch) =>
    expect(() =>
      parseBrowserSessionBindings(
        JSON.stringify({ [org]: { [company]: [{ ...binding, ...patch }] } })
      )
    ).toThrow()
  );
  it("refuses duplicate rules and JSON keys", () => {
    expect(() =>
      parseBrowserSessionBindings(
        JSON.stringify({ [org]: { [company]: [binding, binding] } })
      )
    ).toThrow();
    expect(() =>
      parseBrowserSessionBindings(`{"${org}":{},"${org}":{}}`)
    ).toThrow();
  });
  it("stages only named cookie authority and requires an explicit matching request", () => {
    const request = {
      idempotencyKey: "one",
      urls: ["https://example.com/"],
      sessionBindingId: binding.bindingId,
    };
    const { config } = buildBrowserRunnerConfig(
      request,
      policy,
      ["203.0.113.8/32"],
      binding
    );
    expect(config.sessionCredential).toEqual({
      bindingId: binding.bindingId,
      origin: binding.origin,
      cookieName: binding.cookieName,
    });
    expect(JSON.stringify(config)).not.toContain("connectorId");
    expect(() =>
      buildBrowserRunnerConfig(
        { ...request, sessionBindingId: undefined },
        policy,
        ["203.0.113.8/32"],
        binding
      )
    ).toThrow();
    expect(() =>
      buildBrowserRunnerConfig(
        { ...request, options: { recordTrace: true } },
        policy,
        ["203.0.113.8/32"],
        binding
      )
    ).toThrow();
  });
});

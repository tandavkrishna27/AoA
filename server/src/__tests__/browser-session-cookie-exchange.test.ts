import { describe, expect, it, vi } from "vitest";
import { parseDistributedNetworkPolicies } from "../config/distributed-network-policies.js";
import { exchangeBrowserSessionCookie } from "../services/browser-session-cookie-exchange.js";
const org = "11111111-1111-4111-8111-111111111111",
  company = "22222222-2222-4222-8222-222222222222";
const policy = parseDistributedNetworkPolicies(
  JSON.stringify({
    [org]: {
      [company]: {
        policyId: "login",
        version: 1,
        allow: [{ scheme: "https", host: "example.com", port: 443 }],
      },
    },
  })
).get(`${org}:${company}`)!;
const now = new Date("2026-10-07T00:00:00.000Z");
const binding = {
  bindingId: org,
  connectorId: company,
  origin: "https://example.com",
  exchangeUrl: "https://example.com/aoa/session",
  cookieName: "__Host-aoa-session",
};
const cookie = "scoped_session_abcdefghijklmnop";
const input = {
  binding,
  accessToken: "connector-access-token",
  policy,
  controlPlaneDenyCidrs: ["203.0.113.8/32"],
  expiresAt: new Date(now.getTime() + 300000),
  signal: new AbortController().signal,
};
function deps(
  header = `__Host-aoa-session=${cookie}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=300`
) {
  return {
    now: () => now,
    resolveAddresses: vi.fn(async () => ["93.184.216.34"]),
    dispatch: vi.fn(async () => ({
      status: 200,
      statusText: "OK",
      headers: { "set-cookie": header },
      body: "",
    })),
  };
}
describe("control-plane scoped session-cookie exchange", () => {
  it("aborts hanging DNS before sending the connector token", async () => {
    const controller = new AbortController(),
      ports = deps();
    ports.resolveAddresses.mockImplementation(
      () => new Promise<string[]>(() => {})
    );
    const pending = exchangeBrowserSessionCookie(
      { ...input, signal: controller.signal },
      ports
    );
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(ports.dispatch).not.toHaveBeenCalled();
  });
  it("pins a classified address and emits only the named scoped cookie", async () => {
    const ports = deps();
    const reply = await exchangeBrowserSessionCookie(input, ports);
    expect(reply).toEqual({
      name: binding.cookieName,
      value: cookie,
      expiresAt: input.expiresAt.toISOString(),
    });
    expect(ports.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedAddress: "93.184.216.34",
        tlsServername: "example.com",
      }),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer connector-access-token",
        }),
      }),
      input.signal,
      { maxBodyBytes: 8192 }
    );
    expect(JSON.stringify(reply)).not.toContain(input.accessToken);
  });
  it.each([
    "Domain=example.com",
    "Path=/other",
    "SameSite=Lax",
    "Max-Age=301",
    "Max-Age=0",
    "Secure; Secure",
  ])("refuses unsafe cookie attribute %s", async (attribute) => {
    const ports = deps(
      `__Host-aoa-session=${cookie}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=300; ${attribute}`
    );
    await expect(exchangeBrowserSessionCookie(input, ports)).rejects.toThrow();
  });
  it("refuses token repackaging and extra cookies", async () => {
    await expect(
      exchangeBrowserSessionCookie(
        input,
        deps(
          `__Host-aoa-session=${input.accessToken}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=300`
        )
      )
    ).rejects.toThrow();
    await expect(
      exchangeBrowserSessionCookie(
        input,
        deps(
          `__Host-aoa-session=${cookie}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=300, other=secret`
        )
      )
    ).rejects.toThrow();
  });
  it.each(["127.0.0.1", "169.254.169.254", "203.0.113.8"])(
    "refuses DNS resolution to %s before sending credentials",
    async (address) => {
      const ports = deps();
      ports.resolveAddresses.mockResolvedValue([address]);
      await expect(
        exchangeBrowserSessionCookie(input, ports)
      ).rejects.toThrow();
      expect(ports.dispatch).not.toHaveBeenCalled();
    }
  );
  it("refuses widened endpoints, redirects, empty CP authority and expired requests", async () => {
    const ports = deps();
    await expect(
      exchangeBrowserSessionCookie(
        {
          ...input,
          binding: { ...binding, exchangeUrl: "https://other.example/login" },
        },
        ports
      )
    ).rejects.toThrow();
    await expect(
      exchangeBrowserSessionCookie(
        { ...input, controlPlaneDenyCidrs: [] },
        ports
      )
    ).rejects.toThrow();
    await expect(
      exchangeBrowserSessionCookie({ ...input, expiresAt: now }, ports)
    ).rejects.toThrow();
    ports.dispatch.mockResolvedValue({
      status: 302,
      statusText: "Found",
      headers: { "set-cookie": "" },
      body: "",
    });
    await expect(exchangeBrowserSessionCookie(input, ports)).rejects.toThrow();
  });
});

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createServer } from "node:http";
import { connect, isIP, type Socket } from "node:net";
import { classifyEgressDestination, type NetworkDenialClass, ipInCidr } from "@armyofagents/shared/egress-policy";
import { canonicalizeJsonV1, networkPolicyV1Schema, type NetworkPolicyV1 } from "@armyofagents/worker-protocol";

export interface BrowserNetworkConfig {
  readonly networkPolicy: NetworkPolicyV1;
  readonly controlPlaneDenyCidrs: readonly string[];
}
export function validateBrowserNetworkConfig(raw: unknown): BrowserNetworkConfig {
  if (!raw || typeof raw !== "object") throw new Error("Browser network authority missing");
  const input = raw as Record<string, unknown>;
  const policy = networkPolicyV1Schema.parse(input.networkPolicy);
  const { digest, ...body } = policy;
  if (digest !== createHash("sha256").update(canonicalizeJsonV1(body)).digest("hex")) throw new Error("Browser network digest mismatch");
  const cidrs = input.controlPlaneDenyCidrs;
  if (!Array.isArray(cidrs) || cidrs.length < 1 || cidrs.length > 256 || cidrs.some((value) => {
    if (typeof value !== "string" || value.length > 100 || value.trim() !== value) return true;
    const [base, prefix, extra] = value.split("/");
    return extra !== undefined || !base || !isIP(base) || (prefix !== undefined && !/^\d+$/.test(prefix)) || !ipInCidr(base, value);
  })) throw new Error("Browser control-plane deny authority missing or invalid");
  return { networkPolicy: policy, controlPlaneDenyCidrs: [...cidrs] as string[] };
}

/** URL gate used on every context request, including redirects and popups. DNS is
 * independently classified and pinned at CONNECT, never resolved in Chromium. */
export function browserOriginAllowed(url: string, config: BrowserNetworkConfig): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || isIP(parsed.hostname.replace(/^\[|\]$/g, ""))) return false;
    const port = parsed.port ? Number(parsed.port) : 443;
    return parsed.protocol === "https:" && config.networkPolicy.allow.some((rule) => rule.host === parsed.hostname && rule.port === port);
  } catch { return false; }
}

interface ProxyDependencies {
  resolve(host: string): Promise<readonly string[]>;
  dial(address: string, port: number): Socket;
  denied(value: NetworkDenialClass): void;
}
export interface BrowserEgressProxy { readonly port: number; readonly server: string; close(): Promise<void> }

/** Production uses only pinned literal addresses returned by the validated lookup.
 * The injected transport seam lets local TLS controls exercise this without a private-IP exception. */
export async function startBrowserEgressProxy(raw: unknown, overrides: Partial<ProxyDependencies> = {}): Promise<BrowserEgressProxy> {
  const config = validateBrowserNetworkConfig(raw);
  const deps: ProxyDependencies = {
    resolve: async (host) => (await lookup(host, { all: true })).map((entry) => entry.address),
    dial: (address, port) => connect({ host: address, port }), denied: () => {}, ...overrides,
  };
  const sockets = new Set<Socket>(); let closing = false;
  const track = (socket: Socket): void => {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy()); socket.setTimeout(30_000, () => socket.destroy());
  };
  const server = createServer({ maxHeaderSize: 8192 }, (_request, response) => {
    deps.denied("not_allowlisted"); response.writeHead(403, { Connection: "close" }).end();
  });
  server.maxConnections = 64; server.headersTimeout = 5000; server.requestTimeout = 5000;
  server.on("connection", track);
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("connect", (request, stream, head) => {
    const socket = stream as Socket;
    const deny = (value: NetworkDenialClass): void => { deps.denied(value); if (!socket.destroyed) socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); };
    void (async () => {
      const authority = request.url ?? "";
      // CONNECT accepts only exact DNS host:port, never userinfo, paths or IP literals.
      if (head.length > 16_384 || !/^[a-z0-9.-]+:[0-9]{1,5}$/.test(authority) || !browserOriginAllowed(`https://${authority}`, config)) { deny("not_allowlisted"); return; }
      const parsed = new URL(`https://${authority}`); const port = Number(authority.slice(authority.lastIndexOf(":") + 1));
      let timer: ReturnType<typeof setTimeout> | undefined;
      let addresses: readonly string[];
      try {
        addresses = await Promise.race([deps.resolve(parsed.hostname), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("DNS timeout")), 5000);
        })]);
      } catch { deny("private"); return; } finally { if (timer) clearTimeout(timer); }
      const classification = classifyEgressDestination(`https://${authority}`, addresses, config.networkPolicy, { cidrs: config.controlPlaneDenyCidrs });
      if (classification !== "allow") { deny(classification); return; }
      if (closing || socket.destroyed) return;
      const upstream = deps.dial(addresses[0]!, port); track(upstream);
      socket.once("close", () => upstream.destroy()); upstream.once("close", () => socket.destroy());
      const connectTimeout = setTimeout(() => { upstream.destroy(); socket.destroy(); }, 5000);
      upstream.once("close", () => clearTimeout(connectTimeout));
      upstream.once("connect", () => {
        clearTimeout(connectTimeout);
        if (closing || socket.destroyed) { upstream.destroy(); return; }
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream); upstream.pipe(socket);
      });
    })().catch(() => { deny("private"); });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Browser proxy bind failed");
  return { port: address.port, server: `http://127.0.0.1:${address.port}`, close: async () => {
    closing = true; for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } };
}

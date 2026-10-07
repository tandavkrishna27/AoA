import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { connect as tcpConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { describe, expect, it } from "vitest";
import { fixtureNetwork } from "./network-fixture.js";
import { startBrowserEgressProxy } from "../egress-proxy.js";

describe("guest proxy real local TLS controls", () => {
  it("pins validated public DNS once and tunnels TLS; private rebinding is denied", async () => {
    const site = createServer({ cert: readFileSync(new URL("../../../../docker/d1/certs/public.crt", import.meta.url)),
      key: readFileSync(new URL("../../../../docker/d1/certs/private.key", import.meta.url)) }, (_req, res) => res.end("allowed-marker"));
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    const address = site.address(); if (!address || typeof address === "string") throw new Error("fixture bind");
    const port = address.port; const pinned: string[] = []; let resolutions = 0;
    const config = fixtureNetwork([{ scheme: "https", host: "allowed.example", port }]);
    const proxy = await startBrowserEgressProxy(config, { resolve: async () => { resolutions++; return ["93.184.216.34"]; },
      // TEST ONLY: dial validated fixture address into the local TLS server. No
      // production private-network exemption is available in staged config.
      dial: (ip, targetPort) => { pinned.push(ip); expect(targetPort).toBe(port); return tcpConnect(port, "127.0.0.1"); } });
    try {
      const tunnel = tcpConnect(proxy.port, "127.0.0.1");
      await new Promise<void>((resolve, reject) => {
        tunnel.once("connect", () => tunnel.write(`CONNECT allowed.example:${port} HTTP/1.1\r\nHost: allowed.example:${port}\r\n\r\n`));
        tunnel.once("data", (data) => { expect(data.toString()).toContain("200 Connection Established"); resolve(); }); tunnel.once("error", reject);
      });
      const secure = tlsConnect({ socket: tunnel, servername: "allowed.example", rejectUnauthorized: false });
      const result = await new Promise<string>((resolve, reject) => {
        let output = ""; secure.once("secureConnect", () => secure.write("GET / HTTP/1.1\r\nHost: allowed.example\r\nConnection: close\r\n\r\n"));
        secure.on("data", (data) => { output += data.toString(); }); secure.once("end", () => resolve(output)); secure.once("error", reject);
      });
      expect(result).toContain("allowed-marker"); expect(resolutions).toBe(1); expect(pinned).toEqual(["93.184.216.34"]);
    } finally { await proxy.close(); await new Promise<void>((resolve) => site.close(() => resolve())); }
    const blocked = await startBrowserEgressProxy(config, { resolve: async () => ["127.0.0.1"], dial: () => { throw new Error("private must not dial"); } });
    try {
      const result = await new Promise<string>((resolve, reject) => {
        const socket = tcpConnect(blocked.port, "127.0.0.1", () => socket.write(`CONNECT allowed.example:${port} HTTP/1.1\r\n\r\n`));
        socket.on("data", (data) => { resolve(data.toString()); socket.destroy(); }); socket.on("error", reject);
      });
      expect(result).toContain("403 Forbidden");
    } finally { await blocked.close(); }
  });
});

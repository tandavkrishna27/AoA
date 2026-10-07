import { lookup } from "node:dns/promises";
import type { NetworkPolicyV1 } from "@armyofagents/worker-protocol";
import { classifyEgressDestination } from "./egress-policy.js";
import {
  executePinnedRequest,
  type ValidatedFetchTarget,
} from "./outbound-url-guard.js";
import { parseAuthoritativeBrowserPolicy } from "./browser-runtime-preparation.js";
import { resolveBrowserControlPlaneDenyCidrs } from "../config/distributed-network-policies.js";
import {
  validateBrowserSessionBinding,
  type BrowserSessionBinding,
} from "../config/browser-session-bindings.js";

/** CP-only exchange. This return value is sensitive and must be encrypted before
 * persistence; the OAuth token stays in this process and is never returned. */
export async function exchangeBrowserSessionCookie(
  input: {
    binding: BrowserSessionBinding;
    accessToken: string;
    policy: NetworkPolicyV1;
    controlPlaneDenyCidrs: string[];
    expiresAt: Date;
    signal: AbortSignal;
  },
  deps: {
    now?: () => Date;
    resolveAddresses?: (host: string) => Promise<string[]>;
    dispatch?: typeof executePinnedRequest;
  } = {}
) {
  validateBrowserSessionBinding(input.binding);
  const now = deps.now ?? (() => new Date());
  const deadline = input.expiresAt.getTime(),
    started = now().getTime();
  if (
    !Number.isFinite(deadline) ||
    deadline <= started ||
    deadline > started + 300_000 ||
    typeof input.accessToken !== "string" ||
    input.accessToken.length < 1 ||
    input.accessToken.length > 32_768 ||
    /[\r\n\x00]/.test(input.accessToken) ||
    !parseAuthoritativeBrowserPolicy(input.policy)
  )
    throw new Error("browser session exchange authority unavailable");
  const cidrs = resolveBrowserControlPlaneDenyCidrs({
    AOA_CONTROL_PLANE_DENY_CIDRS: input.controlPlaneDenyCidrs.join(","),
  });
  if (!cidrs.length)
    throw new Error("control-plane deny authority unavailable");
  const endpoint = new URL(input.binding.exchangeUrl);
  let onAbort: () => void = () => {};
  let timer: NodeJS.Timeout | undefined;
  let addresses: string[];
  try {
    if (input.signal.aborted)
      throw new Error("browser session exchange cancelled");
    addresses = await Promise.race([
      (
        deps.resolveAddresses ??
        (async (host) =>
          (await lookup(host, { all: true })).map((entry) => entry.address))
      )(endpoint.hostname),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("browser session exchange cancelled"));
        input.signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(
          () => reject(new Error("browser session exchange expired")),
          Math.min(10000, deadline - started)
        );
        timer.unref();
      }),
    ]);
  } finally {
    input.signal.removeEventListener("abort", onAbort);
    if (timer) clearTimeout(timer);
  }
  if (input.signal.aborted || now().getTime() >= deadline)
    throw new Error("browser session exchange expired");
  if (
    classifyEgressDestination(endpoint.href, addresses, input.policy, {
      cidrs,
    }) !== "allow"
  )
    throw new Error("browser session exchange egress refused");
  const target: ValidatedFetchTarget = {
    parsedUrl: endpoint,
    resolvedAddress: addresses[0]!,
    hostHeader: endpoint.host,
    tlsServername: endpoint.hostname,
    useTls: true,
  };
  const response = await (deps.dispatch ?? executePinnedRequest)(
    target,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    },
    input.signal,
    { maxBodyBytes: 8192 }
  );
  // The pinned transport follows no redirects. Only an explicit successful login
  // with ONE host-only named cookie is accepted; Expires/date commas are refused.
  const header = Object.entries(response.headers).find(
    ([key]) => key.toLowerCase() === "set-cookie"
  )?.[1];
  if (
    response.status < 200 ||
    response.status >= 300 ||
    !header ||
    Buffer.byteLength(header) > 8192 ||
    header.includes(",") ||
    /[\r\n]/.test(header)
  )
    throw new Error("browser session exchange refused");
  const parts = header.split(";").map((part) => part.trim());
  const first = parts.shift()!;
  const equal = first.indexOf("=");
  const name = first.slice(0, equal),
    value = first.slice(equal + 1);
  if (
    equal < 1 ||
    name !== input.binding.cookieName ||
    !/^[A-Za-z0-9._~-]{16,4096}$/.test(value) ||
    value === input.accessToken
  )
    throw new Error("invalid scoped browser cookie");
  const attributes = new Map<string, string | null>();
  for (const part of parts) {
    const split = part.indexOf("="),
      key = (split < 0 ? part : part.slice(0, split)).toLowerCase(),
      attribute = split < 0 ? null : part.slice(split + 1);
    if (
      !key ||
      attributes.has(key) ||
      !["secure", "httponly", "samesite", "path", "max-age"].includes(key)
    )
      throw new Error("unsafe browser cookie scope");
    attributes.set(key, attribute);
  }
  const maxAge = attributes.get("max-age");
  if (
    !attributes.has("secure") ||
    attributes.get("secure") !== null ||
    !attributes.has("httponly") ||
    attributes.get("httponly") !== null ||
    attributes.get("samesite")?.toLowerCase() !== "strict" ||
    attributes.get("path") !== "/" ||
    !maxAge ||
    !/^\d+$/.test(maxAge) ||
    Number(maxAge) < 1 ||
    Number(maxAge) > 300
  )
    throw new Error("unsafe browser cookie scope");
  const finished = now().getTime(),
    expiresAt = Math.min(deadline, finished + Number(maxAge) * 1000);
  if (finished >= deadline || input.signal.aborted)
    throw new Error("browser session exchange expired");
  return { name, value, expiresAt: new Date(expiresAt).toISOString() };
}

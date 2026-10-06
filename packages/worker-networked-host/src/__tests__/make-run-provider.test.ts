// DEP-011 Slice 2b-ii — the container networked-provider factory + the URL resolver.
//
// Construction is INERT: building the `NetworkedProviderDriver` performs NO I/O (the hop only
// fires on an op call), so this drives a real `create` through an INJECTED fetch — no adapter
// manager, no network. It proves: (a) the resolver's none/url split; (b) a URL yields a
// `makeRunProvider` whose product is a `NetworkedProviderDriver` bound to the right baseUrl +
// capability (observed on the wire); and (c) the RE-VALIDATION fail-closed edges (the F-cast
// fix) — an absent / wrong-version / wrong-audience capability throws rather than blind-casting.

import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  NetworkedProviderDriver,
  OWNED_LABELS_CAPABILITY_AUDIENCE,
  OWNED_LABELS_CAPABILITY_VERSION,
  decodeOpRequest,
  encodeOkResponse,
  signOwnedLabelsCapability,
  signWarmResourceCapability,
} from "@armyofagents/provider-wire";
import type { OwnedLabelsCapability } from "@armyofagents/provider-wire";

import { PROVIDER_URL_ENV, resolveProviderUrl } from "../resolve-provider-url.js";
import { NetworkedProviderCapabilityError, makeNetworkedRunProvider } from "../make-run-provider.js";

const OWNED = {
  organizationId: "org-1",
  targetId: "tgt-1",
  workerId: "wkr-1",
  jobId: "job-1",
  attempt: 1,
  leaseId: "lease-1",
  deviceGeneration: 7,
};

/** A REAL minted capability (v:1 / adapter-manager). The factory re-validates only the
 * version/audience literals; the signature is verified server-side by the adapter-manager. */
function mintCapability(): OwnedLabelsCapability {
  const { privateKey } = generateKeyPairSync("ed25519");
  return signOwnedLabelsCapability(
    { v: OWNED_LABELS_CAPABILITY_VERSION, audience: OWNED_LABELS_CAPABILITY_AUDIENCE, ownedLabels: OWNED, expiresAt: 1_700_000_060_000 },
    privateKey,
  );
}

/** The supervisor passes { handoff, capability }; the factory reads only `capability`. */
function callFactory(factory: ReturnType<typeof makeNetworkedRunProvider>, capability: unknown) {
  return factory({ handoff: {}, capability } as unknown as Parameters<typeof factory>[0]);
}

describe("resolveProviderUrl", () => {
  it("returns {kind:'none'} when the env var is unset / empty / whitespace (the shipped default)", () => {
    expect(resolveProviderUrl({})).toEqual({ kind: "none" });
    expect(resolveProviderUrl({ [PROVIDER_URL_ENV]: "" })).toEqual({ kind: "none" });
    expect(resolveProviderUrl({ [PROVIDER_URL_ENV]: "   " })).toEqual({ kind: "none" });
  });

  it("returns {kind:'url'} with the trimmed URL when set", () => {
    expect(resolveProviderUrl({ [PROVIDER_URL_ENV]: "  http://adapter-manager:9000  " })).toEqual({
      kind: "url",
      url: "http://adapter-manager:9000",
    });
  });
});

describe("makeNetworkedRunProvider — construction (inert) + the type bridge", () => {
  it("a URL yields a makeRunProvider whose product is a NetworkedProviderDriver bound to the baseUrl + capability", async () => {
    const cap = mintCapability();
    let sawUrl: string | undefined;
    let sawBody: string | undefined;
    const fetchSpy = vi.fn(async (url: string, init: { body: string }) => {
      sawUrl = url;
      sawBody = init.body;
      return { text: async () => encodeOkResponse({ providerOpId: "op-1", sandboxId: "sbx-1", generation: 1 }) } as unknown as Response;
    });

    const factory = makeNetworkedRunProvider("http://adapter-manager:9000", fetchSpy as unknown as typeof fetch);
    const provider = callFactory(factory, cap);
    // Construction is inert — no hop fired yet.
    expect(provider).toBeInstanceOf(NetworkedProviderDriver);
    expect(provider.checkpointMode).toBe("none");
    expect(fetchSpy).not.toHaveBeenCalled();

    // ONE op call fires the hop: the baseUrl is wired (URL) and the capability is carried (body).
    await provider.create({ sandboxId: "sbx-1", command: "run.sh", args: [], env: {}, resourceLabels: OWNED } as never, {
      deadlineMs: 5_000,
      idempotencyKey: "idem-1",
    });
    expect(sawUrl).toBe("http://adapter-manager:9000/op/create");
    expect(decodeOpRequest(sawBody!).capability).toEqual(cap);
  });

  it("fails CLOSED when NO capability is minted for the run (never a silent no-cap driver)", () => {
    const factory = makeNetworkedRunProvider("http://adapter-manager:9000");
    expect(() => callFactory(factory, undefined)).toThrow(NetworkedProviderCapabilityError);
  });

  it("★ fails CLOSED on a FORWARD-INCOMPATIBLE capability version (the F-cast fix: no blind down-cast)", () => {
    // A planned v:2 must NOT be silently re-labelled v:1. The upstream shape guard checks only
    // typeof v === 'number', so this wide-but-wrong capability would pass a blind `as` cast — the
    // re-validation here is the only thing that rejects it.
    const factory = makeNetworkedRunProvider("http://adapter-manager:9000");
    const v2 = { v: 2, audience: OWNED_LABELS_CAPABILITY_AUDIENCE, ownedLabels: OWNED, expiresAt: 1_700_000_060_000, sig: "x" };
    expect(() => callFactory(factory, v2)).toThrow(NetworkedProviderCapabilityError);
  });

  it("★ fails CLOSED on a wrong audience", () => {
    const factory = makeNetworkedRunProvider("http://adapter-manager:9000");
    const wrongAud = { v: OWNED_LABELS_CAPABILITY_VERSION, audience: "someone-else", ownedLabels: OWNED, expiresAt: 1_700_000_060_000, sig: "x" };
    expect(() => callFactory(factory, wrongAud)).toThrow(NetworkedProviderCapabilityError);
  });
});


describe("networked warm provider construction", () => {
  it("carries only the signed retained-resource grant with a fresh primary capability", async () => {
    const keys = generateKeyPairSync("ed25519");
    const primary = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: OWNED, expiresAt: 2000 }, keys.privateKey);
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const grant = signWarmResourceCapability({ v: 1, audience: "adapter-manager-warm-resource", sessionId, generation: 2, resourceId: "retained-vm",
      physicalLabels: { ...OWNED, leaseId: "old-lease", jobId: "old-job" }, ownedLabels: OWNED,
      previousCapabilityExpiresAt: 1000, issuedAt: 1000, expiresAt: 2000 }, keys.privateKey);
    const control = { version: 1, sessionId, generation: 2, mode: "resume", resourceId: "retained-vm", idleTtlMs: 1800000,
      historicalCanaries: ["old-private-key"], warmResourceCapability: grant };
    let body = "";
    const fetchSpy = vi.fn(async (_url, init) => {
      body = String(init?.body);
      return new Response(encodeOkResponse({ providerOpId: "restore-op", restored: true }));
    });
    const factory = makeNetworkedRunProvider("http://adapter-manager:9000", fetchSpy);
    const provider = factory({ handoff: {}, capability: primary, warmControl: control } as unknown as Parameters<typeof factory>[0]);
    expect(provider.checkpointMode).toBe("snapshot");
    expect(fetchSpy).not.toHaveBeenCalled();
    await provider.restore("retained-vm", { deadlineMs: 5000, idempotencyKey: "restore" });
    expect(decodeOpRequest(body)).toMatchObject({ capability: primary, warmResourceCapability: grant });
    expect(body).not.toContain("old-private-key");
    expect(body).not.toContain("historicalCanaries");
  });
});

import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalizeJsonV1, networkPolicyV1Schema, type NetworkPolicyV1 } from "@armyofagents/worker-protocol";
import { normalizeBrowserJobInput } from "./browser-job-config.js";
import { resolveBrowserControlPlaneDenyCidrs } from "../config/distributed-network-policies.js";
import {browserSessionBindingSchema,type BrowserSessionBinding} from "../config/browser-session-bindings.js";

export const BROWSER_DISPATCH_NAMESPACE = "com.armyofagents.browser/dispatch";
export const BROWSER_RUNTIME_ROOT = "/home/user/.aoa/browser-runtime";
export const BROWSER_RUNNER_PATH = `${BROWSER_RUNTIME_ROOT}/runner.js`;
export const BROWSER_CONFIG_PATH = `${BROWSER_RUNTIME_ROOT}/session.json`;

function safeNavigationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    // This first producer accepts public HTTPS navigation without embedded auth,
    // query credentials or fragments. A requested URL never creates egress authority.
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      /^[a-z0-9.-]+$/.test(url.hostname) && url.hostname.includes(".") && !/^\d+(?:\.\d+){3}$/.test(url.hostname) &&
      url.hostname !== "localhost" && !url.hostname.endsWith(".localhost");
  } catch { return false; }
}

export const browserSessionRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(128),
  sessionBindingId:z.string().uuid().optional(),
  urls: z.array(z.string().max(2048).refine(safeNavigationUrl, "public HTTPS URL without credentials required")).min(1).max(16),
  options: z.object({
    viewport: z.object({ width: z.number().int().min(320).max(3840), height: z.number().int().min(240).max(2160) }).strict().optional(),
    locale: z.string().max(64).optional(), timezone: z.string().max(64).optional(),
    recordTrace: z.boolean().optional(), recordVideo: z.boolean().optional(),
    maxSessionSeconds: z.number().int().min(1).max(3600).optional(),
  }).strict().optional(),
}).strict();
export type BrowserSessionRequest = z.infer<typeof browserSessionRequestSchema>;

/** Only persisted server policy bytes can authorize a child. References and
 * placement digests deliberately fail here; requested URLs never mint rules. */
export function parseAuthoritativeBrowserPolicy(raw: unknown): NetworkPolicyV1 | null {
  const parsed = networkPolicyV1Schema.safeParse(raw);
  if (!parsed.success) return null;
  const { digest, ...body } = parsed.data;
  return createHash("sha256").update(canonicalizeJsonV1(body)).digest("hex") === digest ? parsed.data : null;
}

const agentBrowserPreparationSchema = z.object({
  schemaVersion: z.literal(1),
  requestDigest: z.string().regex(/^[0-9a-f]{64}$/),
  runId: z.string().uuid(), agentId: z.string().uuid(), issueId: z.string().uuid(),
  parentJobId: z.string().uuid(), parentAttemptId: z.string().uuid(), parentLeaseId: z.string().uuid(),
  targetId: z.string().uuid(), targetAuthorityKey: z.string().min(1), targetGeneration: z.number().int().positive(),
  profileHash: z.string().regex(/^[0-9a-f]{64}$/), providerConstraintHash: z.string().regex(/^[0-9a-f]{64}$/),
  targetProfileHash: z.string().regex(/^[0-9a-f]{64}$/),
  networkPolicy: z.custom<NetworkPolicyV1>((value) => networkPolicyV1Schema.safeParse(value).success),
  sessionBinding:browserSessionBindingSchema.optional(),
}).strict();
export const browserPreparationSchema = z.discriminatedUnion("schemaVersion", [agentBrowserPreparationSchema,
  agentBrowserPreparationSchema.extend({ schemaVersion: z.literal(2),
    principalKind: z.literal("commander"), userId: z.string().min(1).max(256), conversationId: z.string().uuid(),
    agentId: z.null(), issueId: z.null() }).strict()]);
export type BrowserPreparation = z.infer<typeof browserPreparationSchema>;

export function parseBrowserPreparation(raw: unknown): BrowserPreparation | null {
  const parsed = browserPreparationSchema.safeParse(raw);
  return parsed.success && parseAuthoritativeBrowserPolicy(parsed.data.networkPolicy) ? parsed.data : null;
}

export function browserDispatchExtension(preparation: BrowserPreparation) {
  return { namespace: BROWSER_DISPATCH_NAMESPACE, schemaVersion: 1, critical: false as const,
    value: { runnerPath: BROWSER_RUNNER_PATH, configPath: BROWSER_CONFIG_PATH, networkPolicy: preparation.networkPolicy } };
}

export function buildBrowserRunnerConfig(request: BrowserSessionRequest, policy: NetworkPolicyV1, controlPlaneDenyCidrs: string[] = [], sessionBinding?:BrowserSessionBinding) {
  if (!parseAuthoritativeBrowserPolicy(policy)) throw new Error("parent network policy unavailable");
  for (const value of request.urls) {
    const url = new URL(value);
    if (!policy.allow.some((rule) => rule.scheme === "https" && rule.host === url.hostname && rule.port === Number(url.port || 443))) {
      throw new Error("browser destination outside parent network policy");
    }
  }
  if (!controlPlaneDenyCidrs.every((value) => typeof value === "string")) throw new Error("invalid parent control-plane deny authority");
  const validatedCidrs = resolveBrowserControlPlaneDenyCidrs({ AOA_CONTROL_PLANE_DENY_CIDRS: controlPlaneDenyCidrs.join(",") });
  if (!validatedCidrs.length) throw new Error("parent control-plane deny authority unavailable");
  const normalized = normalizeBrowserJobInput(request.options ?? {});
  if (!normalized.ok) throw new Error(`invalid browser options: ${normalized.reason}`);
  const workload = normalized.value;
  if (sessionBinding) sessionBinding = browserSessionBindingSchema.parse(sessionBinding);
  if(Boolean(request.sessionBindingId)!==Boolean(sessionBinding) || (sessionBinding && (sessionBinding.bindingId!==request.sessionBindingId || workload.recordTrace || request.urls.some(url=>new URL(url).origin!==sessionBinding.origin)))) throw new Error("scoped browser session binding refused");
  const config = {
    networkPolicy: policy, controlPlaneDenyCidrs: validatedCidrs,
    ...(sessionBinding?{sessionCredential:{bindingId:sessionBinding.bindingId,origin:sessionBinding.origin,cookieName:sessionBinding.cookieName}}:{}),
    userDataDir: "/home/user/.aoa/browser-profile", downloadsStagingPath: "/home/user/.aoa/browser-downloads",
    downloadRoot: "/home/user/aoa-output", approvalDirectory: "/home/user/.aoa/browser-approvals",
    requireApproval: true, approvalTimeoutMs: Math.min(60_000, workload.maxSessionSeconds * 1000),
    steps: request.urls.map((url) => ({ action: "navigate", url })),
    launch: { chromiumSandbox: true, headless: true, viewport: workload.viewport, locale: workload.locale,
      timezoneId: workload.timezone, recordTrace: workload.recordTrace },
    ...(workload.recordVideo ? { videoDir: "/home/user/.aoa/browser-video-staging" } : {}),
  };
  return { workload, config };
}

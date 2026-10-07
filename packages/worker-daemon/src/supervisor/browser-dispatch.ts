import { createHash } from "node:crypto";
import { browserWorkloadV1Schema, executionSourceV1Schema, canonicalizeJsonV1, networkPolicyV1Schema, type NetworkPolicyV1 } from "@armyofagents/worker-protocol";
import { readStagedInputPointers } from "../lease/staged-input.js";
import type { LeaseHandoff } from "../poll/poll-loop.js";

export const BROWSER_RUNNER_PATH = "/home/user/.aoa/browser-runtime/runner.js";
export const BROWSER_CONFIG_PATH = "/home/user/.aoa/browser-runtime/session.json";
export const BROWSER_DISPATCH_NAMESPACE = "com.armyofagents.browser/dispatch";

export function readBrowserNetworkPolicy(handoff: LeaseHandoff): NetworkPolicyV1 | null {
  const extensions = handoff.offer.job.extensions.filter((entry) => entry.namespace === BROWSER_DISPATCH_NAMESPACE);
  if (extensions.length !== 1) return null;
  const extension = extensions[0];
  if (extension.schemaVersion !== 1 || extension.critical !== false) return null;
  const value = extension.value;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 3) return null;
  const data = value as Record<string, unknown>;
  if (data.runnerPath !== BROWSER_RUNNER_PATH || data.configPath !== BROWSER_CONFIG_PATH) return null;
  const parsed = networkPolicyV1Schema.safeParse(data.networkPolicy);
  if (!parsed.success) return null;
  const { digest, ...body } = parsed.data;
  const computed = createHash("sha256").update(canonicalizeJsonV1(body)).digest("hex");
  const ref = handoff.offer.job.networkPolicy;
  return digest === computed && ref.digest === digest && ref.policyId === body.policyId && ref.version === body.version ? parsed.data : null;
}

/** Paths name control-plane-authored objects. They never authorize tenant commands,
 * policy bodies, credentials or steps supplied in the frozen workload. */
export function browserDispatchRefusal(handoff: LeaseHandoff, verifiedNetwork = false): string | null {
  const job = handoff.offer.job;
  const source = executionSourceV1Schema.safeParse(job.source);
  if (!source.success || source.data.kind !== "browser_request" || !browserWorkloadV1Schema.safeParse(job.workload).success) {
    return "browser_contract_invalid";
  }
  let pointers;
  try {
    const staged = job.extensions.filter((entry) => entry.namespace === "com.armyofagents.job/staged-input");
    if (staged.length !== 1 || staged[0].schemaVersion !== 1 || staged[0].critical !== false) return "browser_staging_invalid";
    const value = staged[0].value;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1) return "browser_staging_invalid";
    const files = (value as Record<string, unknown>).files;
    if (!Array.isArray(files) || files.length > 128 || files.some((file) => !file || typeof file !== "object" || Array.isArray(file) ||
      Object.keys(file).length !== 5 || !["id", "path", "key", "sha256", "size"].every((key) => Object.hasOwn(file, key)))) return "browser_staging_invalid";
    pointers = readStagedInputPointers(job.extensions);
  }
  catch { return "browser_staging_invalid"; }
  const paths = pointers.map((pointer) => pointer.path);
  if (!paths.includes(BROWSER_RUNNER_PATH) || !paths.includes(BROWSER_CONFIG_PATH) ||
      new Set(pointers.map((pointer) => pointer.artifactId)).size !== pointers.length ||
      new Set(paths).size !== paths.length || paths.some((path) =>
        !/^\/home\/user\/\.aoa\/browser-runtime\/[a-zA-Z0-9_-]+\.(js|json)$/.test(path))) {
    return "browser_staging_invalid";
  }
  // Frozen job.networkPolicy is only a reference. Current leasing supplies a
  // placement digest, not the digest of an enforceable policy body. Neither it
  // nor a tenant extension can attest provider default-deny enforcement.
  if (!readBrowserNetworkPolicy(handoff)) return "browser_network_policy_invalid";
  return verifiedNetwork ? null : "browser_network_authority_unavailable";
}

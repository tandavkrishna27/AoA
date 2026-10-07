import { z } from "zod";
import { rejectDuplicateJsonKeys } from "./distributed-network-policies.js";

export interface BrowserSessionBinding {
  bindingId: string;
  connectorId: string;
  origin: string;
  exchangeUrl: string;
  cookieName: string;
}
export function validateBrowserSessionBinding(
  binding: BrowserSessionBinding
): void {
  const endpoint = new URL(binding.exchangeUrl),
    origin = new URL(binding.origin);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    origin.origin !== binding.origin ||
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    endpoint.origin !== binding.origin ||
    !/^[a-z0-9.-]+$/.test(endpoint.hostname) ||
    !/^__Host-[A-Za-z0-9_-]{1,64}$/.test(binding.cookieName)
  )
    throw new Error("invalid trusted browser session binding");
}

export const BROWSER_SESSION_BINDINGS_ENV = "AOA_BROWSER_SESSION_BINDINGS";
export const browserSessionBindingSchema = z
  .object({
    bindingId: z.string().uuid(),
    connectorId: z.string().uuid(),
    origin: z.string().max(1000),
    exchangeUrl: z.string().max(2048),
    cookieName: z.string().max(71),
  })
  .strict()
  .superRefine((binding, ctx) => {
    try {
      validateBrowserSessionBinding(binding);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "invalid trusted browser session binding",
      });
    }
  });
const configSchema = z.record(
  z.string().uuid(),
  z.record(
    z.string().uuid(),
    z
      .array(browserSessionBindingSchema)
      .max(32)
      .refine(
        (bindings) =>
          new Set(bindings.map((binding) => binding.bindingId)).size ===
          bindings.length,
        "duplicate browser session binding"
      )
  )
);

export function parseBrowserSessionBindings(
  raw: string | undefined
): Map<string, BrowserSessionBinding[]> {
  if (!raw?.trim()) return new Map();
  if (Buffer.byteLength(raw) > 262144)
    throw new Error("browser session bindings too large");
  const decoded: unknown = JSON.parse(raw);
  rejectDuplicateJsonKeys(raw);
  const configured = configSchema.parse(decoded);
  const result = new Map<string, BrowserSessionBinding[]>();
  for (const [organizationId, companies] of Object.entries(configured))
    for (const [companyId, bindings] of Object.entries(companies)) {
      if (result.size >= 128)
        throw new Error("too many browser session binding tenants");
      result.set(`${organizationId}:${companyId}`, bindings);
    }
  return result;
}
export function resolveBrowserSessionBindings(
  organizationId: string,
  companyId: string,
  env: Record<string, string | undefined> = process.env
): BrowserSessionBinding[] {
  return structuredClone(
    parseBrowserSessionBindings(env[BROWSER_SESSION_BINDINGS_ENV]).get(
      `${organizationId}:${companyId}`
    ) ?? []
  );
}

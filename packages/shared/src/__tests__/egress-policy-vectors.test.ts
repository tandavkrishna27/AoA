import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyEgressDestination } from "../egress-policy.js";
const fixture = JSON.parse(readFileSync(new URL("../../../../tests/fixtures/egress-policy/v1/vectors.json", import.meta.url), "utf8")) as {
  context: { allow: Array<{ host: string; port: number }>; controlPlaneCidrs: string[] };
  allowVectors: Array<{ name: string; requestedUrl: string; resolvedAddrs: string[] }>;
  denyVectors: Array<{ name: string; requestedUrl: string; resolvedAddrs: string[]; class: string }>;
};
describe("shared server/guest classifier frozen vectors", () => {
  const policy = { allow: fixture.context.allow.map((rule) => ({ ...rule, scheme: "https" as const })) };
  const cp = { cidrs: fixture.context.controlPlaneCidrs };
  it.each(fixture.allowVectors)("allows $name", (vector) => expect(classifyEgressDestination(vector.requestedUrl, vector.resolvedAddrs, policy, cp)).toBe("allow"));
  it.each(fixture.denyVectors)("denies $name", (vector) => expect(classifyEgressDestination(vector.requestedUrl, vector.resolvedAddrs, policy, cp)).toBe(vector.class));
});

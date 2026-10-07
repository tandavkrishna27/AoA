import { beforeEach, describe, expect, it, vi } from "vitest";
import { serviceControlApi } from "@/api/service-control";
const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/api/client", () => ({ api: client }));
beforeEach(() => { client.get.mockReset(); client.post.mockReset(); });
describe("service operator API", () => {
  const root = "/organizations/org-1/companies/company-1/services";
  const definition = { command: "node", args: ["worker.js"], gracefulStopSeconds: 30 };
  it("scopes reads to organization and company", async () => {
    await serviceControlApi.list("org-1", "company-1");
    await serviceControlApi.detail("org-1", "company-1", "service-1");
    expect(client.get.mock.calls).toEqual([[root], [`${root}/service-1`]]);
  });
  it("creates paused and sends structured generation and desired state controls", async () => {
    await serviceControlApi.create("org-1", "company-1", definition);
    await serviceControlApi.generation("org-1", "company-1", "service-1", definition, "Operator update");
    await serviceControlApi.desiredState("org-1", "company-1", "service-1", "stopped", "Operator stop");
    expect(client.post.mock.calls).toEqual([
      [root, { definition, desiredState: "paused" }],
      [`${root}/service-1/generation`, { definition, reason: "Operator update" }],
      [`${root}/service-1/desired-state`, { desiredState: "stopped", reason: "Operator stop" }],
    ]);
  });
  it("propagates server authority failures", async () => {
    client.post.mockRejectedValue(new Error("Forbidden"));
    await expect(serviceControlApi.create("org-1", "company-1", definition)).rejects.toThrow("Forbidden");
  });
});

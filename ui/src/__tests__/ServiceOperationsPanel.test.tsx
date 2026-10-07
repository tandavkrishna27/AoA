import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ServiceOperationsPanel } from "@/components/settings/sections/ServiceOperationsPanel";
const methods = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), create: vi.fn(), desiredState: vi.fn(), generation: vi.fn() }));
vi.mock("@/api/service-control", () => ({ serviceControlApi: methods }));
beforeEach(() => {
  for (const method of Object.values(methods)) method.mockReset();
  methods.list.mockResolvedValue([{ serviceId: "service-1", desiredState: "running", generation: 2 }]);
  methods.detail.mockResolvedValue({ serviceId: "service-1", desiredState: "running", generation: 2,
    definition: { command: "node", args: ["worker.js"], gracefulStopSeconds: 30 },
    liveInstance: { serviceInstanceId: "instance-1", status: "healthy", generation: 2, jobId: "job-1" } });
  methods.desiredState.mockResolvedValue({ outcome: "changed" }); methods.create.mockResolvedValue({ serviceId: "service-new" });
  methods.generation.mockResolvedValue({ outcome: "changed" });
});
function panel() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <ServiceOperationsPanel organizationId="org-1" companyId="company-1" /></QueryClientProvider>);
}
describe("durable service operator controls", () => {
  it.each(["stopped", "deleted"])("disables invalid transitions from %s", async (desiredState) => {
    methods.list.mockResolvedValue([{ serviceId: "service-1", desiredState, generation: 2 }]); panel();
    expect(await screen.findByRole("button", { name: "Pause" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
    if (desiredState === "deleted") expect(screen.getByRole("button", { name: "Resume" })).toBeDisabled();
    else expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled();
  });
  it("reconnects live status and applies scoped pause/resume/stop", async () => {
    const user = userEvent.setup(); panel();
    await user.click(await screen.findByRole("button", { name: "Service details" }));
    expect(await screen.findByText("Active instance: healthy")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(methods.desiredState).toHaveBeenCalledWith("org-1", "company-1", "service-1", "paused", expect.any(String)));
    const before = methods.detail.mock.calls.length; await user.click(screen.getByRole("button", { name: "Refresh services" }));
    await waitFor(() => expect(methods.detail.mock.calls.length).toBeGreaterThan(before));
  });
  it("creates a paused service with structured command arguments and rolls a generation through the server", async () => {
    const user = userEvent.setup(); panel();
    await user.click(screen.getByRole("button", { name: "New service" }));
    await user.type(screen.getByLabelText("Service command"), "node");
    await user.type(screen.getByLabelText("Arguments (one per line)"), "serve.js\n--worker");
    await user.click(screen.getByRole("button", { name: "Create paused service" }));
    await waitFor(() => expect(methods.create).toHaveBeenCalledWith("org-1", "company-1", { command: "node", args: ["serve.js", "--worker"], gracefulStopSeconds: 30 }));
    await user.click(await screen.findByRole("button", { name: "Service details" }));
    await user.click(await screen.findByRole("button", { name: "Update generation" }));
    await user.clear(screen.getByLabelText("Service command")); await user.type(screen.getByLabelText("Service command"), "new-worker");
    await user.click(screen.getByRole("button", { name: "Save generation" }));
    await waitFor(() => expect(methods.generation).toHaveBeenCalledWith("org-1", "company-1", "service-1",
      { command: "new-worker", args: ["worker.js"], gracefulStopSeconds: 30 }, expect.any(String)));
  });
  it("shows failed reads instead of an empty service view", async () => {
    methods.list.mockRejectedValueOnce(new Error("connection lost")); panel();
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to load services");
  });
  it("shows rejected control actions and failed detail reads", async () => {
    methods.desiredState.mockRejectedValueOnce(new Error("Service control forbidden"));
    methods.detail.mockRejectedValueOnce(new Error("connection lost"));
    const user = userEvent.setup(); panel();
    await user.click(await screen.findByRole("button", { name: "Pause" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Service control forbidden");
    await user.click(screen.getByRole("button", { name: "Service details" }));
    expect(await screen.findByText("Failed to load service details.")).toBeInTheDocument();
  });
});

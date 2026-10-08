import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OperationsSection } from "@/components/settings/sections/OperationsSection";

const CID = "co-1";
const OID = "org-1";
const JOB = "job-1";
const WORKER = "worker-1";

// ─── Mutable company context (org present vs. absent) ─────────────────────────
let mockCompany: { selectedCompanyId: string | null; selectedCompany: { organizationId: string } | null } = {
  selectedCompanyId: CID,
  selectedCompany: { organizationId: OID },
};

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => mockCompany,
}));

vi.mock("@/api/job-control", () => ({
  jobControlApi: {
    listJobs: vi.fn(),
    getJob: vi.fn(),
    listWorkers: vi.fn(),
    cancelJob: vi.fn(),
    drainJob: vi.fn(),
    revokeWorker: vi.fn(),
  },
}));
vi.mock("@/api/service-control", () => ({ serviceControlApi: { list: vi.fn().mockResolvedValue([]) } }));
const decisions = vi.hoisted(() => ({ detail: vi.fn(), answer: vi.fn() }));
vi.mock("@/api/agent-runtime-decisions", () => ({ agentRuntimeDecisionsApi: decisions }));

import { jobControlApi } from "@/api/job-control";

const mocked = jobControlApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <OperationsSection />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  decisions.detail.mockReset(); decisions.answer.mockReset();
  mockCompany = { selectedCompanyId: CID, selectedCompany: { organizationId: OID } };
  for (const key of Object.keys(mocked)) mocked[key]!.mockReset();
  mocked.listJobs!.mockResolvedValue([{ id: JOB, status: "queued", workloadType: "batch", createdAt: "2026-01-01T00:00:00Z" }]);
  mocked.listWorkers!.mockResolvedValue([]);
  mocked.getJob!.mockResolvedValue({ job: { id: JOB, status: "queued" }, attempts: [], leases: [], events: [] });
  mocked.cancelJob!.mockResolvedValue({ status: "queued", command: null });
  mocked.drainJob!.mockResolvedValue({ status: "queued", command: null });
  mocked.revokeWorker!.mockResolvedValue({ revoked: true, revokedGeneration: 2 });
});

describe("OperationsSection (JOB-008 operator controls)", () => {
  it("links only committed unexpired evidence to the existing task output content route", async () => {
    mocked.getJob!.mockResolvedValue({ job: { id: JOB, status: "succeeded" }, attempts: [], leases: [], events: [], artifacts: [
      { id: "a", identifier: "ready", kind: "screenshot", status: "committed", outputId: "output/a", expiresAt: "2099-01-01T00:00:00Z" },
      { id: "b", identifier: "pending", kind: "screenshot", status: "granted", outputId: "pending" },
      { id: "c", identifier: "old", kind: "screenshot", status: "committed", outputId: "old", expiresAt: "2000-01-01T00:00:00Z" },
      { id: "d", identifier: "cookie", kind: "browser_cookie_state", status: "committed", outputId: "cookie" },
      { id: "e", identifier: "storage", kind: "browser_storage_state", status: "committed", outputId: "storage" },
      { id: "f", identifier: "recovery-blocked", kind: "screenshot", status: "committed", outputId: "blocked",
        recoveryQuarantinedAt: "2026-10-08T00:00:00Z", recoveryQuarantineReason: "hash_mismatch" },
    ] });
    const user = userEvent.setup(); renderSection();
    await user.click((await screen.findAllByRole("button", { name: /details/i }))[0]!);
    expect(await screen.findByRole("link", { name: "Open evidence" })).toHaveAttribute("href", "/api/task-outputs/output%2Fa/content");
    expect(screen.getAllByRole("link", { name: "Open evidence" })).toHaveLength(1);
    expect(screen.getByText("Recovery quarantine: hash_mismatch")).toBeInTheDocument();
  });

  it("reconnects to durable browser evidence and answers native permission without run-wide choices", async () => {
    const user = userEvent.setup();
    const data = { job: { id: JOB, status: "running", workloadType: "browser_session" }, attempts: [], leases: [], events: [],
      artifacts: [{ id: "artifact-1", identifier: "screenshot-1", kind: "screenshot", status: "expired", sizeBytes: 42,
        expiresAt: "2026-01-02T00:00:00Z" }], runtimeDecisions: [{ id: "decision-1", title: "Open example", status: "created", kind: "permission" }] };
    mocked.getJob!.mockResolvedValue(data);
    decisions.detail.mockResolvedValue({ id: "decision-1", title: "Open example", kind: "permission", status: "shown", adapterType: "browser_runtime",
      sourceRevision: 3, nonce: "nonce-browser", summary: "Navigate to example", toolName: "browser.navigate", networkTarget: "https://example.com",
      allowRunEligible: true, expiresAt: "2099-01-01T00:00:00Z" });
    decisions.answer.mockResolvedValue({ status: "relayed" });
    renderSection(); await user.click((await screen.findAllByRole("button", { name: /details/i }))[0]!);
    expect(await screen.findByText("screenshot-1")).toBeInTheDocument();
    expect(screen.getByText("expired")).toBeInTheDocument();
    expect(screen.getByText(/2026-01-02/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Allow once" }));
    expect(decisions.answer).toHaveBeenCalledWith(CID, "decision-1", { kind: "permission", decision: "allow_once", expectedSourceRevision: 3, nonce: "nonce-browser" });
    expect(screen.queryByRole("button", { name: /equivalent actions/ })).not.toBeInTheDocument();
    const before = decisions.detail.mock.calls.length;
    await user.click(screen.getByRole("button", { name: /^Refresh$/ }));
    await waitFor(() => expect(decisions.detail.mock.calls.length).toBeGreaterThan(before));
  });
  it("renders job + worker status pills for each state", async () => {
    mocked.listJobs!.mockResolvedValue([
      { id: "j1", status: "queued", createdAt: "2026-01-01T00:00:00Z" },
      { id: "j2", status: "cancel_requested", createdAt: "2026-01-01T00:00:00Z" },
      { id: "j3", status: "failed", createdAt: "2026-01-01T00:00:00Z" },
    ]);
    mocked.listWorkers!.mockResolvedValue([
      { id: WORKER, status: "revoked", label: "worker-a", createdAt: "2026-01-01T00:00:00Z" },
    ]);
    renderSection();
    expect(await screen.findByText(/queued/i)).toBeInTheDocument();
    expect(await screen.findByText(/canceling/i)).toBeInTheDocument();
    expect(await screen.findByText(/failed/i)).toBeInTheDocument();
    expect(await screen.findByText(/revoked/i)).toBeInTheDocument();
  });

  it("expanding a job surfaces lease states (leased / stale)", async () => {
    const user = userEvent.setup();
    mocked.getJob!.mockResolvedValue({
      job: { id: JOB, status: "running" },
      attempts: [],
      leases: [
        { id: "l1", status: "active", createdAt: "2026-01-01T00:00:00Z" },
        { id: "l2", status: "expired", createdAt: "2026-01-01T00:00:00Z" },
      ],
      events: [],
    });
    renderSection();
    await screen.findByText(/queued/i);
    await user.click((await screen.findAllByRole("button", { name: /details/i }))[0]!);
    expect(await screen.findByText(/leased/i)).toBeInTheDocument();
    expect(await screen.findByText(/stale/i)).toBeInTheDocument();
  });

  it("shows a visible loading state while jobs load", () => {
    let resolve: ((v: unknown) => void) | undefined;
    mocked.listJobs!.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderSection();
    expect(screen.getByText(/loading jobs/i)).toBeInTheDocument();
    resolve?.([]);
  });

  it("shows an empty state when there are no jobs", async () => {
    mocked.listJobs!.mockResolvedValue([]);
    renderSection();
    expect(await screen.findByText(/no jobs/i)).toBeInTheDocument();
  });

  it("shows a visible read error (not a silent toast) when jobs fail to load", async () => {
    mocked.listJobs!.mockRejectedValue(new Error("boom"));
    renderSection();
    expect(await screen.findByText(/failed to load jobs/i)).toBeInTheDocument();
  });

  it("invokes cancelJob with (org, company, jobId, reason) on Cancel", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(/queued/i);
    await user.click((await screen.findAllByRole("button", { name: /^cancel$/i }))[0]!);
    await waitFor(() =>
      expect(mocked.cancelJob).toHaveBeenCalledWith(OID, CID, JOB, expect.any(String)),
    );
  });

  it("invokes drainJob with (org, company, jobId, reason) on Drain", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(/queued/i);
    await user.click((await screen.findAllByRole("button", { name: /^drain$/i }))[0]!);
    await waitFor(() =>
      expect(mocked.drainJob).toHaveBeenCalledWith(OID, CID, JOB, expect.any(String)),
    );
  });

  it("invokes revokeWorker with (org, workerId, reason) on Revoke", async () => {
    const user = userEvent.setup();
    mocked.listWorkers!.mockResolvedValue([
      { id: WORKER, status: "active", label: "worker-a", createdAt: "2026-01-01T00:00:00Z" },
    ]);
    renderSection();
    await user.click((await screen.findAllByRole("button", { name: /^revoke$/i }))[0]!);
    await waitFor(() =>
      expect(mocked.revokeWorker).toHaveBeenCalledWith(OID, WORKER, expect.any(String)),
    );
  });

  it("keeps a mutation error visible in the DOM (not toast-only)", async () => {
    const user = userEvent.setup();
    mocked.cancelJob!.mockRejectedValue(new Error("denied by policy"));
    renderSection();
    await screen.findByText(/queued/i);
    await user.click((await screen.findAllByRole("button", { name: /^cancel$/i }))[0]!);
    expect(await screen.findByText(/denied by policy/i)).toBeInTheDocument();
  });

  it("refetches on manual Refresh (no polling)", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(/queued/i);
    expect(mocked.listJobs).toHaveBeenCalledTimes(1);
    await user.click(await screen.findByRole("button", { name: /^refresh$/i }));
    await waitFor(() => expect(mocked.listJobs).toHaveBeenCalledTimes(2));
  });

  it("renders a guard and calls no API when there is no company/org", () => {
    mockCompany = { selectedCompanyId: null, selectedCompany: null };
    renderSection();
    expect(screen.getByText(/select a company/i)).toBeInTheDocument();
    expect(mocked.listJobs).not.toHaveBeenCalled();
  });

  it("Refresh also refetches an open job's detail, not just the lists", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText(/queued/i);
    await user.click((await screen.findAllByRole("button", { name: /details/i }))[0]!);
    await waitFor(() => expect(mocked.getJob).toHaveBeenCalledTimes(1));
    await user.click(await screen.findByRole("button", { name: /^refresh$/i }));
    // The open JobDetailPanel query must refetch too (its key is prefixed by the jobs key).
    await waitFor(() => expect(mocked.getJob).toHaveBeenCalledTimes(2));
  });

  it("clears a stale action error when a different action is fired", async () => {
    const user = userEvent.setup();
    mocked.cancelJob!.mockRejectedValue(new Error("denied by policy"));
    renderSection();
    await screen.findByText(/queued/i);
    await user.click((await screen.findAllByRole("button", { name: /^cancel$/i }))[0]!);
    expect(await screen.findByText(/denied by policy/i)).toBeInTheDocument();
    // Firing a DIFFERENT action clears the prior action's stale error banner.
    await user.click((await screen.findAllByRole("button", { name: /^drain$/i }))[0]!);
    await waitFor(() => expect(screen.queryByText(/denied by policy/i)).not.toBeInTheDocument());
  });
});

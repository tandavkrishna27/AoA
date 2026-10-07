import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApprovalMailbox } from "../approval-mailbox.js";
import { buildApprovalIntent } from "../approval.js";

const intent = buildApprovalIntent({ action: "navigate", title: "Open site", networkTarget: "https://example.com", riskClass: "browser_navigation" });

describe("in-guest browser approval mailbox", () => {
  it("binds a one-use decision to the emitted request and consumes its file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aoa-browser-approval-"));
    try {
      let decisionPath = "";
      const mailbox = createApprovalMailbox({ directory, timeoutMs: 1000, pollMs: 2,
        emit: async ({ requestId }) => {
          decisionPath = join(directory, `${requestId}.json`);
          await writeFile(decisionPath, JSON.stringify({ requestId, decision: "allow_once", expiresAt: new Date(Date.now() + 1000).toISOString() }));
        } });
      expect(await mailbox(intent)).toBe("allow_once");
      await expect(readFile(decisionPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each(["foreign_request", "expired", "unknown_field"])("refuses %s decision data", async (fault) => {
    const directory = await mkdtemp(join(tmpdir(), "aoa-browser-approval-"));
    try {
      const mailbox = createApprovalMailbox({ directory, timeoutMs: 1000, pollMs: 2,
        emit: async ({ requestId }) => {
          const body: Record<string, unknown> = { requestId, decision: "allow_once", expiresAt: new Date(Date.now() + 1000).toISOString() };
          if (fault === "foreign_request") body.requestId = "different-request";
          if (fault === "expired") body.expiresAt = new Date(0).toISOString();
          if (fault === "unknown_field") body.scope = "all_sites";
          await writeFile(join(directory, `${requestId}.json`), JSON.stringify(body));
        } });
      await expect(mailbox(intent)).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("expires when the control plane never supplies a decision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aoa-browser-approval-"));
    try {
      const mailbox = createApprovalMailbox({ directory, timeoutMs: 10, pollMs: 2, emit: async () => {} });
      expect(await mailbox(intent)).toBe("expired");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("cancellation releases a pending action without a decision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aoa-browser-approval-"));
    const controller = new AbortController();
    try {
      const mailbox = createApprovalMailbox({ directory, timeoutMs: 1000, pollMs: 2,
        signal: controller.signal, emit: async () => { controller.abort(); } });
      expect(await mailbox(intent)).toBe("cancelled");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("bounds an emission callback that never completes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aoa-browser-approval-"));
    try {
      const mailbox = createApprovalMailbox({ directory, timeoutMs: 10, pollMs: 2,
        emit: () => new Promise<void>(() => {}) });
      expect(await mailbox(intent)).toBe("expired");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects response bytes above its fixed read limit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aoa-browser-approval-"));
    try {
      const mailbox = createApprovalMailbox({ directory, timeoutMs: 1000, pollMs: 2,
        emit: async ({ requestId }) => { await writeFile(join(directory, `${requestId}.json`), "x".repeat(2049)); } });
      await expect(mailbox(intent)).rejects.toThrow("unsafe browser approval response");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

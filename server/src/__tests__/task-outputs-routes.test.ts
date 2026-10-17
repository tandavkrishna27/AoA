import express from "express";
import request from "supertest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzleOperatorStubs, makeTableProxy } from "./helpers/drizzle-mock.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";

const { mockService, mockBackfillService, mockLogActivity } = vi.hoisted(() => ({
  mockService: {
    listForIssue: vi.fn(),
    getById: vi.fn(),
    upsertForIssue: vi.fn(),
    updateMutable: vi.fn(),
  },
  mockBackfillService: {
    backfillIssueIfEmpty: vi.fn(),
  },
  mockLogActivity: vi.fn(),
}));

vi.mock("drizzle-orm", () => drizzleOperatorStubs());
vi.mock("@armyofagents/db", () => ({
  issues: makeTableProxy("issues"),
  taskOutputs: makeTableProxy("task_outputs"),
}));
vi.mock("../services/index.js", () => ({
  taskOutputService: () => mockService,
  taskOutputBackfillService: () => mockBackfillService,
  logActivity: mockLogActivity,
}));
vi.mock("../routes/issue-param-normalizer.js", () => ({
  registerIssueParamNormalizer: vi.fn(),
}));

import { taskOutputRoutes } from "../routes/task-outputs.js";

type MockRow = Record<string, unknown>;

const companyId = "company-1";
const issueId = "issue-1";
const outputId = "output-1";

function makeDb(selectRows: MockRow[][] = []) {
  let selectIdx = 0;
  const chain = () => {
    const obj: Record<string, unknown> = {};
    for (const method of ["from", "where"]) obj[method] = () => obj;
    obj.then = (resolve: (value: MockRow[]) => unknown) =>
      Promise.resolve(resolve(selectRows[selectIdx++] ?? []));
    return obj;
  };
  return { select: chain };
}

function makeApp(db: unknown, actor: Express.Request["actor"] = {
  type: "board",
  source: "local_implicit",
  userId: "board-user",
}, content?: { openContent: (...args: any[]) => Promise<any> }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", taskOutputRoutes(db as never, content));
  app.use((err: { status?: number; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message ?? "Internal Server Error" });
  });
  return app;
}

function outputRow(overrides: MockRow = {}) {
  return {
    id: outputId,
    companyId,
    issueId,
    projectId: "project-1",
    type: "preview_url",
    title: "Preview",
    url: "https://preview.example.test",
    status: "active",
    reviewState: "none",
    isPrimary: true,
    healthStatus: "ready",
    ...overrides,
  };
}

describe("taskOutputRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("downloads distributed bytes for an authorized board actor and records access", async () => {
    const { Readable } = await import("node:stream");
    const { createHash } = await import("node:crypto");
    const bytes = Buffer.from("founder artifact bytes");
    const openContent = vi.fn(async () => ({ stream: Readable.from([bytes]), sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), contentType: "text/plain",
      filename: "result.txt", artifactId: "artifact-row", jobId: "job-row", attempt: 1 }));
    const res = await request(makeApp(makeDb([[{ companyId }]]), undefined, { openContent }))
      .get(`/api/task-outputs/${outputId}/content`);
    expect(res.status).toBe(200);
    expect(res.text).toBe(bytes.toString());
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(openContent).toHaveBeenCalledWith(outputId, companyId);
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      companyId, actorType: "user", actorId: "board-user", action: "task_output.content_read",
    }));
  });

  it("downloads exact UTF-8 and binary bytes from local disk through the verified HTTP route", async () => {
    const root = await mkdtemp(join(tmpdir(), "aoa-task-output-download-"));
    const bytes = Buffer.from([0x66, 0x69, 0x6c, 0x65, 0x3a, 0x20, 0xe2, 0x9c, 0x93, 0x00, 0xff, 0x80]);
    const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
    const objectKey = "attempts/result.bin";
    const provider = createLocalDiskStorageProvider(root);
    try {
      await provider.putObject({ objectKey, body: bytes, contentType: "application/octet-stream", contentLength: bytes.length });
      const openContent = vi.fn(async () => {
        const object = await provider.getObject({ objectKey });
        return { stream: object.stream, sizeBytes: bytes.length, sha256: expectedSha256,
          contentType: "application/octet-stream", filename: "result.bin", artifactId: "artifact-row", jobId: "job-row", attempt: 1 };
      });
      const res = await request(makeApp(makeDb([[{ companyId }]]), undefined, { openContent }))
        .get(`/api/task-outputs/${outputId}/content`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(bytes);
      expect(res.headers["content-length"]).toBe(String(bytes.length));
      expect(createHash("sha256").update(res.body).digest("hex")).toBe(expectedSha256);
      expect(openContent).toHaveBeenCalledWith(outputId, companyId);
    } finally {
      const resolvedRoot = resolve(root);
      const resolvedTemp = resolve(tmpdir());
      if (!resolvedRoot.startsWith(`${resolvedTemp}${sep}`)) throw new Error("Refusing to remove a path outside the temporary directory");
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a corrupt local-disk artifact instead of completing the HTTP download", async () => {
    const root = await mkdtemp(join(tmpdir(), "aoa-task-output-download-"));
    const expectedBytes = Buffer.from("trusted artifact bytes");
    const corruptBytes = Buffer.from("corrupt artifact bytes");
    const objectKey = "attempts/result.txt";
    const provider = createLocalDiskStorageProvider(root);
    try {
      await provider.putObject({ objectKey, body: corruptBytes, contentType: "text/plain", contentLength: corruptBytes.length });
      const openContent = vi.fn(async () => {
        const object = await provider.getObject({ objectKey });
        return { stream: object.stream, sizeBytes: expectedBytes.length, sha256: createHash("sha256").update(expectedBytes).digest("hex"),
          contentType: "text/plain", filename: "result.txt", artifactId: "artifact-row", jobId: "job-row", attempt: 1 };
      });

      await expect(request(makeApp(makeDb([[{ companyId }]]), undefined, { openContent }))
        .get(`/api/task-outputs/${outputId}/content`)).rejects.toThrow(/aborted|socket hang up/);
      expect(openContent).toHaveBeenCalledWith(outputId, companyId);
    } finally {
      const resolvedRoot = resolve(root);
      const resolvedTemp = resolve(tmpdir());
      if (!resolvedRoot.startsWith(`${resolvedTemp}${sep}`)) throw new Error("Refusing to remove a path outside the temporary directory");
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["none", "agent", "mcp", "commander"])("denies %s content access before artifact lookup", async (type) => {
    const openContent = vi.fn();
    const res = await request(makeApp(makeDb(), { type, companyId } as never, { openContent }))
      .get(`/api/task-outputs/${outputId}/content`);
    expect(res.status).toBe(type === "none" ? 401 : 403);
    expect(openContent).not.toHaveBeenCalled();
  });

  it("returns unavailable when no tenant reader exists, with no owner fallback", async () => {
    const res = await request(makeApp(makeDb([[{ companyId }]]))).get(`/api/task-outputs/${outputId}/content`);
    expect(res.status).toBe(503);
  });

  it("handles a storage failure during audit without leaking provider errors", async () => {
    const { Readable } = await import("node:stream");
    const source = new Readable({ read() { this.destroy(new Error("private provider endpoint")); } });
    const openContent = vi.fn(async () => ({ stream: source, sizeBytes: 4, sha256: "0".repeat(64),
      contentType: "text/plain", filename: "result.txt", artifactId: "artifact", jobId: "job", attempt: 1 }));
    mockLogActivity.mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 20)));
    const res = await request(makeApp(makeDb([[{ companyId }]]), undefined, { openContent }))
      .get(`/api/task-outputs/${outputId}/content`);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Artifact integrity check failed" });
    expect(source.destroyed).toBe(true);
  });

  it("aborts mismatched body bytes instead of returning a complete download", async () => {
    const { Readable } = await import("node:stream");
    const bytes = Buffer.from("untrusted bytes");
    const source = Readable.from([bytes]);
    const openContent = vi.fn(async () => ({ stream: source, sizeBytes: bytes.length, sha256: "0".repeat(64),
      contentType: "text/plain", filename: "result.txt", artifactId: "artifact", jobId: "job", attempt: 1 }));
    await expect(request(makeApp(makeDb([[{ companyId }]]), undefined, { openContent }))
      .get(`/api/task-outputs/${outputId}/content`)).rejects.toThrow(/aborted|socket hang up/);
    expect(source.destroyed).toBe(true);
  });

  it("destroys provider streaming when the browser disconnects mid-download", async () => {
    const { Readable } = await import("node:stream");
    const { get } = await import("node:http");
    const source = new Readable({ read() { this.push(Buffer.alloc(16 * 1024)); } });
    const openContent = vi.fn(async () => ({ stream: source, sizeBytes: 5 * 1024 ** 3, sha256: "0".repeat(64),
      contentType: "application/octet-stream", filename: "result.bin", artifactId: "artifact", jobId: "job", attempt: 1 }));
    const server = makeApp(makeDb([[{ companyId }]]), undefined, { openContent }).listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address() as { port: number };
      await new Promise<void>((resolve, reject) => {
        const client = get(`http://127.0.0.1:${address.port}/api/task-outputs/${outputId}/content`, (res) => {
          res.on("error", () => {});
          res.once("data", () => { res.destroy(); resolve(); });
        });
        client.on("error", reject);
      });
      await vi.waitFor(() => expect(source.destroyed).toBe(true));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("destroys a late provider stream if the browser disconnected during content lookup", async () => {
    const { Readable } = await import("node:stream");
    const { get } = await import("node:http");
    const source = new Readable({ read() {} });
    let entered!: () => void;
    let finish!: () => void;
    const lookupStarted = new Promise<void>((resolve) => { entered = resolve; });
    const openContent = vi.fn(() => {
      entered();
      return new Promise((resolve) => { finish = () => resolve({ stream: source, sizeBytes: 4, sha256: "0".repeat(64),
        contentType: "text/plain", filename: "late.txt", artifactId: "artifact", jobId: "job", attempt: 1 }); });
    });
    const server = makeApp(makeDb([[{ companyId }]]), undefined, { openContent }).listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const responseClosed = new Promise<void>((resolve) => server.once("request", (_req, res) => res.once("close", resolve)));
      const address = server.address() as { port: number };
      const client = get(`http://127.0.0.1:${address.port}/api/task-outputs/${outputId}/content`);
      client.on("error", () => {});
      await lookupStarted;
      client.destroy();
      await responseClosed;
      finish();
      await vi.waitFor(() => expect(source.destroyed).toBe(true));
      expect(mockLogActivity).not.toHaveBeenCalled();
    } finally {
      source.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each([true, false])("verifies an empty-content digest before headers (valid=%s)", async (valid) => {
    const { Readable } = await import("node:stream");
    const { createHash } = await import("node:crypto");
    const source = Readable.from([]);
    const openContent = vi.fn(async () => ({ stream: source, sizeBytes: 0,
      sha256: valid ? createHash("sha256").digest("hex") : "0".repeat(64),
      contentType: "text/plain", filename: "empty.txt", artifactId: "artifact", jobId: "job", attempt: 1 }));
    const res = await request(makeApp(makeDb([[{ companyId }]]), undefined, { openContent }))
      .get(`/api/task-outputs/${outputId}/content`);
    expect(res.status).toBe(valid ? 200 : 502);
    if (valid) expect(res.headers["content-length"]).toBe("0");
    else expect(res.body).toEqual({ error: "Artifact integrity check failed" });
    expect(source.destroyed).toBe(true);
  });

  it("denies a board actor outside the output company before storage", async () => {
    const openContent = vi.fn();
    const res = await request(makeApp(makeDb([[{ companyId }]]), {
      type: "board", source: "session", userId: "outsider", companyIds: [],
    } as never, { openContent })).get(`/api/task-outputs/${outputId}/content`);
    expect(res.status).toBe(404);
    expect(openContent).not.toHaveBeenCalled();
  });

  it("lists outputs for a task after checking company access", async () => {
    const rows = [outputRow()];
    mockService.listForIssue.mockResolvedValue(rows);
    const app = makeApp(makeDb([[{ companyId }]]));

    const res = await request(app).get(`/api/issues/${issueId}/outputs`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    expect(mockBackfillService.backfillIssueIfEmpty).toHaveBeenCalledWith(companyId, issueId);
    expect(mockService.listForIssue).toHaveBeenCalledWith(companyId, issueId);
  });

  it("creates a task output and logs the mutation", async () => {
    const created = outputRow({ type: "pull_request", title: "PR #42" });
    mockService.upsertForIssue.mockResolvedValue(created);
    const app = makeApp(makeDb([[{ companyId }]]));

    const res = await request(app)
      .post(`/api/issues/${issueId}/outputs`)
      .send({
        type: "pull_request",
        provider: "github",
        externalId: "pr-42",
        title: "PR #42",
        url: "https://github.com/acme/repo/pull/42",
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: outputId, title: "PR #42" });
    expect(mockService.upsertForIssue).toHaveBeenCalledWith(companyId, issueId, expect.objectContaining({
      type: "pull_request",
      provider: "github",
      externalId: "pr-42",
    }));
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      companyId,
      action: "task_output.upserted",
      entityType: "task_output",
      entityId: outputId,
    }));
  });

  it("patches a mutable task output only after checking output company access", async () => {
    const updated = outputRow({ title: "Ready preview" });
    mockService.updateMutable.mockResolvedValue(updated);
    const app = makeApp(makeDb([[{ companyId }]]));

    const res = await request(app)
      .patch(`/api/task-outputs/${outputId}`)
      .send({ title: "Ready preview", reviewState: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Ready preview");
    expect(mockService.updateMutable).toHaveBeenCalledWith(companyId, outputId, {
      title: "Ready preview",
      reviewState: "approved",
    });
  });

  it("blocks agent access to another company's task output", async () => {
    const app = makeApp(makeDb([[{ companyId: "other-company" }]]), {
      type: "agent",
      companyId,
      agentId: "agent-1",
      runId: null,
    });

    const res = await request(app)
      .patch(`/api/task-outputs/${outputId}`)
      .send({ title: "Nope" });

    expect(res.status).toBe(403);
    expect(mockService.updateMutable).not.toHaveBeenCalled();
  });
});

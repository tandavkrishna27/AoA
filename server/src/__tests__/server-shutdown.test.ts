import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { createProcessShutdownHandler } from "../services/server-shutdown.js";

function makeLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

describe("process shutdown", () => {
  it("starts and observes the local drain before waiting for a blocked plugin shutdown", async () => {
    const order: string[] = [];
    const failure = new Error("local drain failed before plugins stopped");
    let releasePlugin!: () => void;
    const pluginBlocked = new Promise<void>((resolve) => { releasePlugin = resolve; });
    const logger = makeLogger();
    const exit = vi.fn();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const shutdown = createProcessShutdownHandler({
      getPluginSubsystem: () => ({ loader: { shutdownAll: async () => { order.push("plugins"); await pluginBlocked; } } }),
      localProcesses: {
        closeAdmission: () => { order.push("close-admission"); },
        drain: async () => { order.push("drain"); throw failure; },
      },
      stopAcceptingWork: () => { order.push("stop-work"); },
      logger,
      exit,
    });
    const pending = shutdown("SIGTERM");
    try {
      expect(order).toEqual(["close-admission", "stop-work", "drain", "plugins"]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      releasePlugin();
      await pending;
      expect(logger.error).toHaveBeenCalledWith({ err: failure }, "Tracked local process shutdown failed");
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      releasePlugin();
      await pending;
      process.off("unhandledRejection", unhandled);
    }
  });

  it("observes a real tracked child close before database teardown and exit", async () => {
    vi.resetModules();
    const processes = await import("@armyofagents/adapter-utils/server-utils");
    const runId = randomUUID();
    const handle = processes.spawnTrackedChild(runId, process.execPath, ["-e", "process.stdout.write('ready');setTimeout(() => {}, 60000)"], {
      cwd: tmpdir(), env: {}, graceSec: 1, shell: false,
    });
    let closed = false;
    handle.child.once("close", () => { closed = true; });
    try {
      await new Promise<void>((resolve, reject) => {
        handle.child.stdout!.once("data", () => resolve());
        handle.child.once("error", reject);
      });
      const databases = { close: vi.fn(async () => { expect(closed).toBe(true); }) };
      const exit = vi.fn(() => { expect(closed).toBe(true); });
      const shutdown = createProcessShutdownHandler({
        getPluginSubsystem: () => undefined,
        localProcesses: { closeAdmission: processes.closeTrackedProcessAdmission, drain: processes.drainTrackedProcesses },
        boundedDatabases: databases,
        logger: makeLogger(),
        exit,
      });
      await shutdown("SIGTERM");
      expect(databases.close).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledWith(0);
      expect(processes.runningProcesses.has(runId)).toBe(false);
    } finally {
      processes.requestTrackedProcessTermination(runId);
      await processes.waitForTrackedProcessExit(runId);
    }
  });

  it("closes local admission before awaiting cleanup and drains children before stopping databases", async () => {
    const order: string[] = [];
    let releaseDrain!: () => void;
    const draining = new Promise<void>((resolve) => { releaseDrain = resolve; });
    const shutdown = createProcessShutdownHandler({
      getPluginSubsystem: () => undefined,
      localProcesses: {
        closeAdmission: () => { order.push("close-admission"); },
        drain: async () => { order.push("drain"); await draining; order.push("children-closed"); },
      },
      stopAcceptingWork: () => { order.push("stop-work"); },
      boundedDatabases: { close: async () => { order.push("databases"); } },
      ownedEmbeddedPostgres: { stop: async () => { order.push("postgres"); } },
      logger: makeLogger(),
      exit: (code) => { order.push(`exit-${code}`); },
    });
    const pending = shutdown("SIGTERM");
    expect(order.slice(0, 2)).toEqual(["close-admission", "stop-work"]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(order).toEqual(["close-admission", "stop-work", "drain"]);
    releaseDrain();
    await pending;
    expect(order).toEqual(["close-admission", "stop-work", "drain", "children-closed", "databases", "postgres", "exit-0"]);
  });

  it("reports an unobserved child exit as failure while still stopping owned database resources", async () => {
    const failure = new Error("tracked children did not close");
    const logger = makeLogger();
    const databases = { close: vi.fn(async () => {}) };
    const postgres = { stop: vi.fn(async () => {}) };
    const exit = vi.fn();
    const shutdown = createProcessShutdownHandler({
      getPluginSubsystem: () => undefined,
      localProcesses: { closeAdmission: vi.fn(), drain: async () => { throw failure; } },
      boundedDatabases: databases,
      ownedEmbeddedPostgres: postgres,
      logger,
      exit,
    });
    await shutdown("SIGTERM");
    expect(logger.error).toHaveBeenCalledWith({ err: failure }, "Tracked local process shutdown failed");
    expect(databases.close).toHaveBeenCalledOnce();
    expect(postgres.stop).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("cleans up plugins and exits for external-Postgres deployments", async () => {
    const order: string[] = [];
    const shutdownAll = vi.fn(async () => {
      order.push("plugins");
    });
    const teardown = vi.fn(() => {
      order.push("host-cleanup");
    });
    const exit = vi.fn(() => {
      order.push("exit");
    });
    const shutdown = createProcessShutdownHandler({
      getPluginSubsystem: () => ({
        loader: { shutdownAll },
        hostServiceCleanup: { teardown },
      }),
      ownedEmbeddedPostgres: null,
      logger: makeLogger(),
      exit,
    });

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

    expect(order).toEqual(["plugins", "host-cleanup", "exit"]);
    expect(shutdownAll).toHaveBeenCalledOnce();
    expect(teardown).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it("cleans up plugins before stopping process-owned embedded Postgres", async () => {
    const order: string[] = [];
    const options = {
      getPluginSubsystem: () => ({
        loader: {
          shutdownAll: vi.fn(async () => {
            order.push("plugins");
          }),
        },
        hostServiceCleanup: {
          teardown: vi.fn(() => {
            order.push("host-cleanup");
          }),
        },
      }),
      ownedEmbeddedPostgres: {
        stop: vi.fn(async () => {
          order.push("postgres");
        }),
      },
      boundedDatabases: {
        close: vi.fn(async () => {
          order.push("bounded");
        }),
      },
      logger: makeLogger(),
      exit: vi.fn(() => {
        order.push("exit");
      }),
    };
    const shutdown = createProcessShutdownHandler(options);

    await shutdown("SIGTERM");

    expect(order).toEqual([
      "plugins",
      "host-cleanup",
      "bounded",
      "postgres",
      "exit",
    ]);
  });

  it("logs bounded database shutdown failures and continues stopping owned resources", async () => {
    const order: string[] = [];
    const logger = makeLogger();
    const boundedFailure = new Error("pool close failed");
    const options = {
      getPluginSubsystem: () => ({
        loader: {
          shutdownAll: vi.fn(async () => {
            order.push("plugins");
          }),
        },
        hostServiceCleanup: {
          teardown: vi.fn(() => {
            order.push("host-cleanup");
          }),
        },
      }),
      boundedDatabases: {
        close: vi.fn(async () => {
          order.push("bounded");
          throw boundedFailure;
        }),
      },
      ownedEmbeddedPostgres: {
        stop: vi.fn(async () => {
          order.push("postgres");
        }),
      },
      logger,
      exit: vi.fn(() => {
        order.push("exit");
      }),
    };
    const shutdown = createProcessShutdownHandler(options);

    await shutdown("SIGTERM");

    expect(order).toEqual([
      "plugins",
      "host-cleanup",
      "bounded",
      "postgres",
      "exit",
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      { err: boundedFailure },
      "Bounded distributed database shutdown failed",
    );
  });
});

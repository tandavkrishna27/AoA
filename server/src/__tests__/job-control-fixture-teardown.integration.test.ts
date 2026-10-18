import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { setupJobControlFixture } from "./helpers/job-control-fixture.js";

it.skipIf(process.platform !== "win32" || process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "job-control fixture awaits a normal Windows shutdown before deleting its cluster",
  async () => {
    const logs: string[] = [];
    const logger = vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      logs.push(values.map(String).join(" "));
    });
    let fixture: Awaited<ReturnType<typeof setupJobControlFixture>> | undefined;
    let teardownAttempted = false;
    try {
      fixture = await setupJobControlFixture("job-control-shutdown");
      const [location] = await fixture.admin<{ data_directory: string }[]>`SHOW data_directory`;
      const directory = location.data_directory;
      const identity = readFileSync(join(directory, "postmaster.pid"), "utf8").split(/\r?\n/);
      const port = Number(identity[3]);
      await fixture.admin`CREATE TABLE fixture_shutdown_io AS SELECT generate_series(1, 10000) AS value`;
      teardownAttempted = true;
      await Promise.all([fixture.teardown(), fixture.teardown()]);
      await vi.waitFor(() => {
        expect(logs.some((line) => line.includes("received fast shutdown request"))).toBe(true);
        expect(logs.some((line) => line.includes("database system is shut down"))).toBe(true);
      }, { timeout: 5000, interval: 10 });
      expect(existsSync(dirname(directory))).toBe(false);
      await new Promise<void>((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => server.close((error) => error ? reject(error) : resolve()));
      });
      await fixture.teardown();
    } finally {
      if (fixture && !teardownAttempted) await fixture.teardown();
      logger.mockRestore();
    }
  }, 180_000,
);

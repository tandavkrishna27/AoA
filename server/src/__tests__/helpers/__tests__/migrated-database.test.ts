import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, expect, it, vi } from "vitest";
import { startMigratedDatabase } from "../migrated-database.js";

const mocks = vi.hoisted(() => ({
  platform: "linux",
  pidPresent: false,
  pid: 4321,
  started: 1_700_000_000,
  port: 55465,
  dataDirectory: "",
  nativeEntry: "",
  mkdtemp: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  initialise: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  options: vi.fn(),
  execFile: vi.fn(),
  migrate: vi.fn(),
  adminEnd: vi.fn(),
  unsafe: vi.fn(),
  appClose: vi.fn(),
  operatorClose: vi.fn(),
  createConnection: vi.fn(),
  instances: [] as Array<{ stop(): Promise<void> }>,
}));

vi.mock("node:fs/promises", () => ({ mkdtemp: mocks.mkdtemp, readFile: mocks.readFile, rm: mocks.rm }));
vi.mock("node:os", async (original) => ({ ...await original<typeof import("node:os")>(), platform: () => mocks.platform }));
vi.mock("node:module", () => ({ createRequire: () => ({ resolve: () => mocks.nativeEntry }) }));
vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("embedded-postgres", () => ({
  default: class {
    initialise = mocks.initialise;
    start = mocks.start;
    stop = mocks.stop;
    constructor(options: unknown) { mocks.options(options); mocks.instances.push(this); }
  },
}));
vi.mock("postgres", () => ({ default: () => ({ end: mocks.adminEnd, unsafe: mocks.unsafe }) }));
vi.mock("@armyofagents/db", () => ({ applyPendingMigrations: mocks.migrate, createTenantAppDbConnection: mocks.createConnection }));
vi.mock("../../../db/rls-tenant.js", () => ({ provisionTenantAppRoleLoginSql: () => "fixture grant" }));
vi.mock("../embedded-pg-port.js", () => ({ allocateEmbeddedPgPort: async () => mocks.port }));

const root = resolve(tmpdir(), "aoa-fixture-cleanup-unit");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.instances.length = 0;
  mocks.platform = "linux";
  mocks.pidPresent = false;
  mocks.pid = 4321;
  mocks.started = 1_700_000_000;
  mocks.port = 55465;
  mocks.dataDirectory = join(root, "db");
  mocks.nativeEntry = join(root, "native-package", "dist", "index.js");
  mocks.mkdtemp.mockResolvedValue(root);
  mocks.initialise.mockResolvedValue(undefined);
  mocks.start.mockImplementation(async () => { mocks.pidPresent = true; });
  mocks.stop.mockResolvedValue(undefined);
  mocks.rm.mockResolvedValue(undefined);
  mocks.migrate.mockResolvedValue(undefined);
  mocks.adminEnd.mockResolvedValue(undefined);
  mocks.unsafe.mockResolvedValue(undefined);
  mocks.appClose.mockResolvedValue(undefined);
  mocks.operatorClose.mockResolvedValue(undefined);
  mocks.createConnection.mockReturnValueOnce({ db: {}, close: mocks.appClose }).mockReturnValueOnce({ db: {}, close: mocks.operatorClose });
  mocks.readFile.mockImplementation(async () => {
    if (!mocks.pidPresent) throw Object.assign(new Error("missing pid file"), { code: "ENOENT" });
    return `${mocks.pid}\n${mocks.dataDirectory}\n${mocks.started}\n${mocks.port}\n`;
  });
  mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
    mocks.pidPresent = false;
    callback(null, "server stopped", "");
  });
});

it("surfaces a stop failure and retains the fixture directory", async () => {
  const failure = new Error("controlled stop failure");
  const database = await startMigratedDatabase();
  mocks.stop.mockRejectedValue(failure);
  await expect(database.teardown()).rejects.toBeInstanceOf(AggregateError);
  expect(mocks.rm).not.toHaveBeenCalled();
});

it("attempts every close and stop, reports all failures and preserves evidence", async () => {
  const database = await startMigratedDatabase();
  mocks.operatorClose.mockRejectedValue(new Error("operator close"));
  mocks.appClose.mockRejectedValue(new Error("app close"));
  mocks.adminEnd.mockRejectedValue(new Error("admin close"));
  mocks.stop.mockRejectedValue(new Error("stop"));
  const failure = await database.teardown().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toHaveLength(4);
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(mocks.rm).not.toHaveBeenCalled();
});

it("owns deletion until every cleanup phase succeeds and is idempotent", async () => {
  const database = await startMigratedDatabase();
  await Promise.all([database.teardown(), database.teardown()]);
  expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining({ persistent: true }));
  expect(mocks.operatorClose).toHaveBeenCalledOnce();
  expect(mocks.appClose).toHaveBeenCalledOnce();
  expect(mocks.adminEnd).toHaveBeenCalledOnce();
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(mocks.rm).toHaveBeenCalledExactlyOnceWith(root, { recursive: true, force: true });
});

it("preserves both the setup and cleanup errors", async () => {
  const setup = new Error("migration failed");
  mocks.migrate.mockRejectedValue(setup);
  mocks.stop.mockRejectedValue(new Error("stop failed"));
  const failure = await startMigratedDatabase().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors[0]).toBe(setup);
  expect(mocks.rm).not.toHaveBeenCalled();
});

it("preserves the original setup error after successful cleanup", async () => {
  const setup = new Error("migration failed");
  mocks.migrate.mockRejectedValue(setup);
  await expect(startMigratedDatabase()).rejects.toBe(setup);
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(mocks.rm).toHaveBeenCalledOnce();
});

it("reports directory removal failures", async () => {
  const database = await startMigratedDatabase();
  mocks.rm.mockRejectedValue(new Error("directory locked"));
  await expect(database.teardown()).rejects.toBeInstanceOf(AggregateError);
});

it("uses and awaits the bundled controller for an owned fast Windows shutdown", async () => {
  mocks.platform = "win32";
  const database = await startMigratedDatabase();
  let complete!: () => void;
  mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
    complete = () => { mocks.pidPresent = false; callback(null, "server stopped", ""); };
  });
  let disposed = false;
  let disposalError: unknown;
  const disposal = database.teardown().then(() => { disposed = true; }, (error: unknown) => { disposalError = error; });
  await vi.waitFor(() => expect(mocks.execFile).toHaveBeenCalledOnce());
  expect(mocks.execFile).toHaveBeenCalledWith(
    join(root, "native-package", "native", "bin", "pg_ctl.exe"),
    ["stop", "-D", mocks.dataDirectory, "-m", "fast", "-w", "-t", "15"],
    expect.objectContaining({ windowsHide: true, timeout: 20_000 }),
    expect.any(Function),
  );
  expect(disposed).toBe(false);
  expect(mocks.rm).not.toHaveBeenCalled();
  complete();
  await disposal;
  expect(disposalError).toBeUndefined();
  expect(mocks.stop).not.toHaveBeenCalled();
  expect(mocks.rm).toHaveBeenCalledOnce();
});

it.each(["pid", "started", "port", "dataDirectory"] as const)("refuses a changed Windows %s ownership receipt", async (field) => {
  mocks.platform = "win32";
  const database = await startMigratedDatabase();
  if (field === "dataDirectory") mocks.dataDirectory = join(root, "foreign");
  else mocks[field] += 1;
  await expect(database.teardown()).rejects.toBeInstanceOf(AggregateError);
  expect(mocks.execFile).not.toHaveBeenCalled();
  expect(mocks.stop).not.toHaveBeenCalled();
  expect(mocks.rm).not.toHaveBeenCalled();
});

it("retains Windows evidence when the controller fails or times out", async () => {
  mocks.platform = "win32";
  const database = await startMigratedDatabase();
  mocks.execFile.mockImplementation((_command, _args, _options, callback) => callback(new Error("controller timed out"), "", ""));
  await expect(database.teardown()).rejects.toBeInstanceOf(AggregateError);
  expect(mocks.stop).not.toHaveBeenCalled();
  expect(mocks.rm).not.toHaveBeenCalled();
});

it("refuses deletion if a successful controller leaves a PID file", async () => {
  mocks.platform = "win32";
  const database = await startMigratedDatabase();
  mocks.execFile.mockImplementation((_command, _args, _options, callback) => callback(null, "", ""));
  await expect(database.teardown()).rejects.toBeInstanceOf(AggregateError);
  expect(mocks.rm).not.toHaveBeenCalled();
});

it("does not signal a Windows cluster when initialization failed before start", async () => {
  mocks.platform = "win32";
  const failure = new Error("initdb failed");
  mocks.initialise.mockRejectedValue(failure);
  await expect(startMigratedDatabase()).rejects.toBe(failure);
  expect(mocks.execFile).not.toHaveBeenCalled();
  expect(mocks.stop).not.toHaveBeenCalled();
  expect(mocks.rm).toHaveBeenCalledOnce();
});

it("retains an unqualified Windows startup instead of guessing process ownership", async () => {
  mocks.platform = "win32";
  mocks.start.mockRejectedValue(new Error("start failed before ownership capture"));
  await expect(startMigratedDatabase()).rejects.toBeInstanceOf(AggregateError);
  expect(mocks.execFile).not.toHaveBeenCalled();
  expect(mocks.stop).not.toHaveBeenCalled();
  expect(mocks.rm).not.toHaveBeenCalled();
});

it("refuses shutdown when the captured Windows PID file disappears", async () => {
  mocks.platform = "win32";
  const database = await startMigratedDatabase();
  mocks.pidPresent = false;
  await expect(database.teardown()).rejects.toBeInstanceOf(AggregateError);
  expect(mocks.execFile).not.toHaveBeenCalled();
  expect(mocks.rm).not.toHaveBeenCalled();
});

it("never re-signals a Windows PID when the dependency exit hook calls stop again", async () => {
  mocks.platform = "win32";
  const database = await startMigratedDatabase();
  await Promise.all([database.teardown(), database.teardown()]);
  mocks.pid = 9999;
  await mocks.instances[0].stop();
  expect(mocks.execFile).toHaveBeenCalledOnce();
  expect(mocks.stop).not.toHaveBeenCalled();
  expect(mocks.rm).toHaveBeenCalledOnce();
});

import { expect, it } from "vitest";
import { parseRestoreCommands } from "../backup-restore-commands.js";

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> { const result: T[] = []; for await (const item of source) result.push(item); return result; }
const boundary = "-- boundary";
async function* lines(values: string[]) { yield* values; }

it("keeps COPY rows out of SQL and preserves PostgreSQL text escapes", async () => {
  const commands = parseRestoreCommands(lines([
    "BEGIN;", boundary, "-- data", 'COPY "public"."items" ("value") FROM stdin;',
    "hello\\tworld", "\\N", boundary, "\\.", boundary, "COMMIT;", boundary,
  ]), boundary);
  const seen: unknown[] = [];
  for await (const command of commands) {
    seen.push(command.kind === "copy"
      ? { kind: command.kind, sql: command.sql, rows: await collect(command.rows) }
      : command);
  }
  expect(seen).toEqual([
    { kind: "sql", sql: "BEGIN;" },
    { kind: "copy", sql: '-- data\nCOPY "public"."items" ("value") FROM stdin;', rows: ["hello\\tworld\n", "\\N\n", `${boundary}\n`] },
    { kind: "sql", sql: "COMMIT;" },
  ]);
});

it("streams COPY rows lazily instead of buffering the table", async () => {
  let produced = 0;
  async function* source() {
    yield "COPY items (value) FROM stdin;";
    for (let n = 0; n < 10000; n++) { produced++; yield String(n); }
    yield "\\."; yield boundary;
  }
  for await (const command of parseRestoreCommands(source(), boundary)) {
    expect(command.kind).toBe("copy"); expect(produced).toBe(0);
    if (command.kind === "copy") {
      let count = 0;
      for await (const row of command.rows) { expect(row).toBe(`${count++}\n`); }
      expect(count).toBe(10000);
    }
  }
});

it("rejects a COPY block without its terminator", async () => {
  await expect((async () => {
    for await (const command of parseRestoreCommands(lines(["COPY items FROM stdin;", "one"]), boundary)) {
      if (command.kind === "copy") await collect(command.rows);
    }
  })()).rejects.toThrow("COPY terminator");
});

it("rejects a consumer that skips COPY data", async () => {
  await expect((async () => {
    for await (const _ of parseRestoreCommands(lines(["COPY items FROM stdin;", "one", "\\."]), boundary)) { /* deliberately skip */ }
  })()).rejects.toThrow("COPY data must be consumed");
});

it("does not interpret COPY-like SQL function body lines as data headers", async () => {
  const sql = "CREATE FUNCTION example() RETURNS void AS $$\nCOPY items FROM stdin;\n$$ LANGUAGE sql;";
  const commands = await collect(parseRestoreCommands(lines([...sql.split("\n"), boundary]), boundary));
  expect(commands).toEqual([{ kind: "sql", sql }]);
});

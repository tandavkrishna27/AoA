export type RestoreCommand =
  | { kind: "sql"; sql: string }
  | { kind: "copy"; sql: string; rows: AsyncIterable<string> };

export async function* parseRestoreCommands(
  lines: AsyncIterable<string>, boundary: string,
): AsyncGenerator<RestoreCommand> {
  const iterator = lines[Symbol.asyncIterator]();
  let pending: string[] = [];
  try {
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
      const line = next.value;
      if (/^COPY\s.+\sFROM stdin;$/i.test(line)
        && pending.every(value => !value.trim() || value.trimStart().startsWith("--"))) {
        const sql = [...pending, line].join("\n").trim();
        pending = [];
        let consumed = false;
        async function* rows() {
          for (let row = await iterator.next(); !row.done; row = await iterator.next()) {
            if (row.value === "\\.") { consumed = true; return; }
            yield `${row.value}\n`;
          }
          throw new Error("Missing COPY terminator in backup");
        }
        yield { kind: "copy", sql, rows: rows() };
        if (!consumed) throw new Error("COPY data must be consumed before continuing restore");
      } else if (line === boundary) {
        const sql = pending.join("\n").trim();
        pending = [];
        if (sql) yield { kind: "sql", sql };
      } else {
        pending.push(line);
      }
    }
    const sql = pending.join("\n").trim();
    if (sql) yield { kind: "sql", sql };
  } finally {
    await iterator.return?.();
  }
}

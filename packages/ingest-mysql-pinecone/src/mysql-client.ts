import mysql from "mysql2/promise";
import type { MysqlRow } from "./render.js";

/** The slice of `mysql2` this package calls — small enough for tests to fake without a live server. */
export interface MysqlClient {
  query(sql: string): Promise<MysqlRow[]>;
  end(): Promise<void>;
}

export interface TableColumns {
  table: string;
  columns: { name: string; type: string }[];
}

/** Connects with a `mysql://user:pass@host:port/db` URL. Read-only use: this package only ever SELECTs. */
export async function createMysqlClient(url: string): Promise<MysqlClient> {
  const connection = await mysql.createConnection({
    uri: url,
    // DATE/DATETIME as the literal strings MySQL stores, not JS Dates —
    // avoids silent timezone shifts in both the rendered text and metadata.
    dateStrings: true,
    // DECIMAL/BIGINT come back as strings rather than lossy JS numbers.
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  return {
    async query(sql) {
      const [rows] = await connection.query(sql);
      if (!Array.isArray(rows)) throw new Error("Expected a SELECT returning rows");
      return rows as MysqlRow[];
    },
    async end() {
      await connection.end();
    },
  };
}

/**
 * Every table and column across all non-system databases on the server, as
 * `database.table` — backs the CLI's `--inspect`, for writing a config.
 * Spans databases because sources can query several on one server (e.g.
 * `desk.projects` and `skylight.cards`) through a single connection.
 */
export async function describeTables(client: MysqlClient): Promise<TableColumns[]> {
  const rows = await client.query(
    "SELECT TABLE_SCHEMA AS s, TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS ty FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys') ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION",
  );
  const tables = new Map<string, TableColumns>();
  for (const row of rows) {
    const table = `${String(row.s)}.${String(row.t)}`;
    const entry = tables.get(table) ?? { table, columns: [] };
    entry.columns.push({ name: String(row.c), type: String(row.ty) });
    tables.set(table, entry);
  }
  return [...tables.values()];
}

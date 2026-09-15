/**
 * SQLite bootstrap shared by all company brains.
 * The brain's own db.ts adds drizzle + its domain schema on top — the package
 * stays drizzle-free so consumer typing stays exact.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

/** Open (and create) the brain database. Parent dir is made for Fly volumes / local ./data. */
export function openSqlite(path: string): Database {
  mkdirSync(path.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  return sqlite;
}

/** Canonical outreach events table. Idempotent — brains that ship it via a
 * drizzle migration already get a no-op here. */
export function ensureEventsTable(sqlite: Database): void {
  sqlite.exec(`
    create table if not exists events (
      id integer primary key autoincrement,
      kind text not null check (kind in ('visit','scroll','click','dwell','mcp_connect','mcp_tool')),
      detail text,
      created_at text not null default (datetime('now'))
    );
    create index if not exists events_kind_idx on events (kind);
    create index if not exists events_created_idx on events (created_at);
  `);
}

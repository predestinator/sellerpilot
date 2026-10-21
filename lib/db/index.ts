/**
 * SQLite access (better-sqlite3, synchronous, WAL). One connection per process,
 * kept on globalThis so Next.js dev hot-reloads don't open a new handle each time.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config';
import { SCHEMA_SQL } from './schema';

type DB = Database.Database;
const g = globalThis as unknown as { __spDb?: DB };

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

export function db(): DB {
  return (g.__spDb ??= openDb(config().app.dbPath));
}

/** Test hook: close and forget the connection (a fresh :memory: db on next use). */
export function resetDb() {
  g.__spDb?.close();
  g.__spDb = undefined;
}

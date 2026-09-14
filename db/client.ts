import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "agenttasker.db");

function migrateAtomically(sqlite: Database.Database, migrationsFolder: string) {
  const migrations = readMigrationFiles({ migrationsFolder });
  sqlite.exec(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )`);
  // Drizzle's synchronous migrator reads the last migration before acquiring its
  // deferred transaction. Next build workers can therefore race on a fresh DB.
  // BEGIN IMMEDIATE serializes that read and every following schema write.
  sqlite.transaction(() => {
    const last = sqlite.prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1")
      .get() as { created_at?: number } | undefined;
    for (const migration of migrations) {
      if (last?.created_at !== undefined && Number(last.created_at) >= migration.folderMillis) continue;
      for (const statement of migration.sql) sqlite.exec(statement);
      sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
        .run(migration.hash, migration.folderMillis);
    }
  }).immediate();
}

function initDatabase() {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");

  const migrationsFolder = path.join(process.cwd(), "db", "migrations");
  if (fs.existsSync(migrationsFolder)) {
    migrateAtomically(sqlite, migrationsFolder);
  }

  const db = drizzle(sqlite, { schema });

  return { db, sqlite };
}

const globalForDb = globalThis as unknown as {
  _dbInstance?: ReturnType<typeof initDatabase>;
};

const instance = globalForDb._dbInstance ?? initDatabase();

globalForDb._dbInstance = instance;

export const db = instance.db;
export const sqlite = instance.sqlite;
export * from "./schema";

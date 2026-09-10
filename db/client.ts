import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "agenttasker.db");

function initDatabase() {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");

  const db = drizzle(sqlite, { schema });

  const migrationsFolder = path.join(process.cwd(), "db", "migrations");
  if (fs.existsSync(migrationsFolder)) {
    try {
      migrate(db, { migrationsFolder });
    } catch (err) {
      console.error("[Database] Migration execution failed:", err);
    }
  }

  return { db, sqlite };
}

const globalForDb = globalThis as unknown as {
  _dbInstance?: ReturnType<typeof initDatabase>;
};

const instance = globalForDb._dbInstance ?? initDatabase();

if (process.env.NODE_ENV !== "production") {
  globalForDb._dbInstance = instance;
}

export const db = instance.db;
export const sqlite = instance.sqlite;
export * from "./schema";

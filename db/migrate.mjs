import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), "agenttasker.db");
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

console.log("[Migration] Running migrations on:", dbPath);
migrate(db, { migrationsFolder: path.join(process.cwd(), "db", "migrations") });
console.log("[Migration] Migrations applied successfully!");

sqlite.close();

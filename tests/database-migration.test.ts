import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

test("fresh SQLite migrations are serialized across concurrent application processes", { timeout: 30_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "agenttasker-migration-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const databasePath = path.join(root, "concurrent.db");
  const children = Array.from({ length: 4 }, () => new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--eval", "import('./db/client.ts')"], {
      cwd: process.cwd(),
      windowsHide: true,
      env: { ...process.env, DATABASE_PATH: databasePath },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stderr }));
  }));
  const results = await Promise.all(children);
  assert.deepEqual(results.map((result) => result.code), [0, 0, 0, 0], results.map((result) => result.stderr).join("\n"));
});

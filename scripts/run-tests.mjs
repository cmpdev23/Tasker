import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const files = fs.readdirSync("tests").filter(name => name.endsWith(".test.ts")).map(name => `tests/${name}`);
files.push("backend/tasks/task.service.test.cjs");
files.push("backend/sequences/sequence.service.test.cjs");
// Protect the user's database even if a new test imports a backend singleton
// before setting up its own fixture. Individual test processes may further isolate.
const temporaryRoot = fs.realpathSync(os.tmpdir());
const suiteRoot = fs.mkdtempSync(path.join(temporaryRoot, "agenttasker-suite-"));
try {
  // Several suites exercise real Windows process trees and singleton runtimes.
  // Run test files serially so their termination checks cannot interfere.
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", ...files], {
    stdio: "inherit", windowsHide: true,
    env: { ...process.env, DATABASE_PATH: path.join(suiteRoot, "test.db"), AGENTTASKER_DATA_DIR: path.join(suiteRoot, "runtime") },
  });
  process.exitCode = result.status ?? 1;
} finally {
  assert.equal(path.dirname(path.resolve(suiteRoot)), temporaryRoot);
  assert.ok(path.basename(suiteRoot).startsWith("agenttasker-suite-"));
  fs.rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

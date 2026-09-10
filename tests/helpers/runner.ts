import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TaskInput } from "../../src/types/tasks";

/** One fixture per test-file process: the production DB client is a singleton. */
export async function isolatedRunner() {
  assert.equal((globalThis as { _dbInstance?: unknown })._dbInstance, undefined,
    "Set the temporary DATABASE_PATH before importing any backend module");
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agenttasker-runner-test-")));
  const databasePath = path.join(root, "test.db");
  const removeFixture = () => {
    // Never remove a caller-supplied location or an ancestor of the generated fixture.
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(root), temporaryRoot);
    assert.ok(path.basename(root).startsWith("agenttasker-runner-test-"));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    delete process.env.DATABASE_PATH;
    delete process.env.AGENTTASKER_DATA_DIR;
  };
  process.env.DATABASE_PATH = databasePath;
  process.env.AGENTTASKER_DATA_DIR = path.join(root, "runtime");
  let connection: (typeof import("../../db/client"))["sqlite"] | undefined;
  try {
  const { db, sqlite } = await import("../../db/client");
  connection = sqlite;
  assert.equal(path.resolve(sqlite.name), databasePath);
  const { projectRepository } = await import("../../backend/projects/project.repository");
  const { taskService } = await import("../../backend/tasks/task.service");
  const { runRepository } = await import("../../backend/runs/run.repository");
  const { runService } = await import("../../backend/runs/run.service");
  const { evaluateSchedules } = await import("../../backend/scheduler/scheduler.service");

  return {
    root, databasePath, db, sqlite, runRepository, runService, taskService, evaluateSchedules,
    async project() {
      const id = randomUUID();
      const repositoryPath = path.join(root, id);
      // These services only need real .tasker files; no Git or Codex process is involved.
      fs.mkdirSync(path.join(repositoryPath, ".tasker", "tasks"), { recursive: true });
      return projectRepository.createProject({ name: id, slug: id, repositoryPath });
    },
    async task(projectId: string, schedule: TaskInput["schedule"], overrides: Partial<TaskInput> = {}) {
      return taskService.create(projectId, {
        name: `Task ${randomUUID()}`, instructions: "Deterministic test instructions.",
        enabled: true, expectChanges: false, schedule, ...overrides,
      });
    },
    reset() {
      sqlite.exec("DELETE FROM run_events; DELETE FROM runs; DELETE FROM scheduler_state; DELETE FROM runner_lock; DELETE FROM projects;");
    },
    close() {
      sqlite.close();
      removeFixture();
    },
    child(operation: "claim" | "evaluate" | "read", ...args: string[]): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", path.resolve("tests/helpers/runner.ts"), operation, ...args], {
          cwd: process.cwd(),
          // Supply only test paths and OS plumbing, never credentials or dotenv files.
          env: { NODE_ENV: "test", DATABASE_PATH: databasePath, AGENTTASKER_DATA_DIR: path.join(root, "runtime"),
            ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
          stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
        });
        let output = "";
        let errors = "";
        const timeout = setTimeout(() => { child.kill(); reject(new Error("Runner test child timed out")); }, 20_000);
        child.stdout.on("data", chunk => { output += chunk; });
        child.stderr.on("data", chunk => { errors += chunk; });
        child.on("error", error => { clearTimeout(timeout); reject(error); });
        child.on("close", code => {
          clearTimeout(timeout);
          if (code !== 0) return reject(new Error(`Runner test child exited ${code}: ${errors}`));
          try { resolve(JSON.parse(output)); } catch (error) { reject(error); }
        });
      });
    },
  };
  } catch (error) {
    connection?.close();
    removeFixture();
    throw error;
  }
}

// A separate process gives concurrency and persistence tests independent DB connections.
async function childMain() {
  const operation = process.argv[2];
  if (!["claim", "evaluate", "read"].includes(operation)) return;
  const databasePath = process.env.DATABASE_PATH;
  assert.ok(databasePath && path.basename(databasePath) === "test.db");
  assert.ok(path.basename(path.dirname(databasePath)).startsWith("agenttasker-runner-test-"));
  const { sqlite } = await import("../../db/client");
  try {
    const { runRepository } = await import("../../backend/runs/run.repository");
    let result: unknown;
    if (operation === "claim") result = runRepository.claim()?.id ?? null;
    if (operation === "evaluate") {
      const { evaluateSchedules } = await import("../../backend/scheduler/scheduler.service");
      result = await evaluateSchedules(new Date(process.argv[3]));
    }
    if (operation === "read") result = {
      run: runRepository.get(process.argv[3], process.argv[4]),
      events: runRepository.events(process.argv[4], Number(process.argv[5] ?? 0)),
    };
    process.stdout.write(JSON.stringify(result));
  } finally { sqlite.close(); }
}

void childMain().catch(error => { console.error(error); process.exitCode = 1; });

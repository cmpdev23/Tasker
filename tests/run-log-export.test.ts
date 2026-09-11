import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test, type TestContext } from "node:test";
import { isolatedRunner } from "./helpers/runner";
import type { Run, RunEvent } from "../db/schema";

let database: Awaited<ReturnType<typeof isolatedRunner>>;
let formatRunLog: typeof import("../backend/runs/run-log-export").formatRunLog;
let formatDuration: typeof import("../backend/runs/run-log-export").formatDuration;
let saveRunLogs: typeof import("../backend/runs/run-log-export").saveRunLogs;
let runRepository: typeof import("../backend/runs/run.repository").runRepository;
let projectService: typeof import("../backend/projects/project.service").projectService;
let logsRouteHandler: typeof import("../src/app/api/projects/[id]/runs/[runId]/logs/route").POST;
before(async () => {
  database = await isolatedRunner();
  ({ formatRunLog, formatDuration, saveRunLogs } = await import("../backend/runs/run-log-export"));
  ({ runRepository } = await import("../backend/runs/run.repository"));
  ({ projectService } = await import("../backend/projects/project.service"));
  ({ POST: logsRouteHandler } = await import("../src/app/api/projects/[id]/runs/[runId]/logs/route"));
});
beforeEach(() => database.reset());
after(() => database?.close());

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agenttasker-log-export-test-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("agenttasker-log-export-test-"));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return root;
}

test("formatDuration formats seconds, minutes and hours clearly", () => {
  assert.equal(formatDuration(45000), "45s");
  assert.equal(formatDuration(60000), "1m");
  assert.equal(formatDuration(125000), "2m 5s");
  assert.equal(formatDuration(3661000), "1h 1m");
  assert.equal(formatDuration(-1), "—");
});

test("formatRunLog formats comprehensive text log including metadata, config, diff, and events", () => {
  const dummyRun: Run = {
    id: "run-uuid-1234",
    projectId: "proj-1",
    taskId: "task-seo-gen",
    taskName: "SEO Page Generator",
    status: "SUCCESS",
    scheduledAt: null,
    queuedAt: "2026-09-11T12:00:00.000Z",
    startedAt: "2026-09-11T12:00:05.000Z",
    completedAt: "2026-09-11T12:01:05.000Z",
    baseRemote: "origin",
    baseBranch: "main",
    baseCommit: "abc111",
    runBranch: "tasker/run-1234",
    worktreePath: "/tmp/worktree/run-1234",
    codexPid: null,
    terminationVerified: true,
    exitCode: 0,
    error: null,
    result: "Successfully created SEO page",
    commitHash: "def222",
    diff: " M pages/seo.tsx\n+export default function Page() {}",
    resolvedConfig: JSON.stringify({ model: "gpt-5-codex", sandbox: "read-only" }),
    cancelRequested: false,
    createdAt: "2026-09-11T12:00:00.000Z",
  };

  const dummyEvents: RunEvent[] = [
    {
      id: 1,
      runId: "run-uuid-1234",
      timestamp: "2026-09-11T12:00:05.000Z",
      type: "status",
      message: "Preparing isolated worktree",
      rawPayload: null,
    },
    {
      id: 2,
      runId: "run-uuid-1234",
      timestamp: "2026-09-11T12:00:10.000Z",
      type: "codex",
      message: "Codex tool called",
      rawPayload: JSON.stringify({ tool: "readFile", path: "src/index.ts" }),
    },
  ];

  const formatted = formatRunLog(dummyRun, dummyEvents);

  assert.ok(formatted.includes("AGENTTASKER RUN LOG"));
  assert.ok(formatted.includes("Run ID:           run-uuid-1234"));
  assert.ok(formatted.includes("Task ID:          task-seo-gen"));
  assert.ok(formatted.includes("Task Name:        SEO Page Generator"));
  assert.ok(formatted.includes("Status:           SUCCESS"));
  assert.ok(formatted.includes("Exit Code:        0"));
  assert.ok(formatted.includes("Duration:         1m"));
  assert.ok(formatted.includes("Base Remote:      origin"));
  assert.ok(formatted.includes("Base Branch:      main"));
  assert.ok(formatted.includes("Commit Hash:      def222"));
  assert.ok(formatted.includes("RESULT SUMMARY"));
  assert.ok(formatted.includes("Successfully created SEO page"));
  assert.ok(formatted.includes("RESOLVED CONFIGURATION"));
  assert.ok(formatted.includes('"model": "gpt-5-codex"'));
  assert.ok(formatted.includes("GIT CHANGES / DIFF"));
  assert.ok(formatted.includes("M pages/seo.tsx"));
  assert.ok(formatted.includes("EVENT LOG (2 events)"));
  assert.ok(formatted.includes("[2026-09-11T12:00:05.000Z] [status] Preparing isolated worktree"));
  assert.ok(formatted.includes("[2026-09-11T12:00:10.000Z] [codex] Codex tool called"));
  assert.ok(formatted.includes('"tool": "readFile"'));
});

test("saveRunLogs creates .tasker/logs directory and writes log file", async (t) => {
  const repoDir = await fixture(t);
  const project = await projectService.createProject({
    name: "Export Test Project",
    repositoryPath: repoDir,
    defaultBranch: "main",
  });

  const run = runRepository.create(project.id, "my-audit-task", "Audit Task");
  runRepository.event(run.id, "status", "Running test task");
  runRepository.event(run.id, "stdout", "Test output line 1");

  const result = await saveRunLogs(project.id, run.id);

  assert.equal(result.success, true);
  assert.equal(result.filename, `my-audit-task_${run.id}.txt`);
  assert.equal(result.filePath, `.tasker/logs/my-audit-task_${run.id}.txt`);
  assert.ok(result.byteCount > 0);
  assert.equal(result.eventCount, 3); // initial queued event + 2 added events

  // Check file existence and contents on disk
  const content = await fs.readFile(result.absolutePath, "utf8");
  assert.ok(content.includes(`Run ID:           ${run.id}`));
  assert.ok(content.includes("Running test task"));
  assert.ok(content.includes("Test output line 1"));
});

test("logs API route handles valid local requests and saves logs", async (t) => {
  const repoDir = await fixture(t);
  const project = await projectService.createProject({
    name: "API Test Project",
    repositoryPath: repoDir,
    defaultBranch: "main",
  });

  const run = runRepository.create(project.id, "api-task", "API Task");
  runRepository.event(run.id, "info", "Testing API export");

  const request = new Request(`http://localhost:5000/api/projects/${project.id}/runs/${run.id}/logs`, {
    method: "POST",
    headers: {
      host: "localhost:5000",
      origin: "http://localhost:5000",
      "sec-fetch-site": "same-origin",
    },
  });

  const response = await logsRouteHandler(request, {
    params: Promise.resolve({ id: project.id, runId: run.id }),
  });

  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.success, true);
  assert.equal(json.filename, `api-task_${run.id}.txt`);
  assert.equal(json.filePath, `.tasker/logs/api-task_${run.id}.txt`);

  // Verify file was written
  const exists = await fs.stat(path.join(repoDir, ".tasker", "logs", `api-task_${run.id}.txt`));
  assert.ok(exists.isFile());
});

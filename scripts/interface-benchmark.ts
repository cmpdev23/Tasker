// Disposable UI fixture and HTTP measurements; never starts Codex or uses the user's DB.
// node --import tsx scripts/interface-benchmark.ts
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

async function main() {
  fs.mkdirSync(".test-artifacts", { recursive: true });
  const baselineArgument = process.argv.find(argument => argument === "--baseline" || argument.startsWith("--baseline="));
  const baseline = Boolean(baselineArgument);
  const baselineRef = baselineArgument?.split("=").slice(1).join("=") || "HEAD";
  const appPort = baseline ? 5059 : 5057;
  const proxyPort = baseline ? 5058 : 5056;
  const root = fs.mkdtempSync(path.resolve(".test-artifacts/interface-"));
  let appRoot = process.cwd();
  if (baseline) {
    appRoot = path.join(root, "baseline");
    fs.mkdirSync(appRoot);
    // Only source/configuration is copied. No database, dotenv, runtime or logs.
    for (const entry of ["src", "backend", "db", "shared", "public", "package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs"]) {
      fs.cpSync(entry, path.join(appRoot, entry), { recursive: true, filter: source => !path.basename(source).startsWith(".env") });
    }
    for (const file of ["src/modules/projects/project-settings-form.tsx", "src/modules/tasks/project-tasks-view.tsx", "src/modules/tasks/use-task-overview.ts", "src/modules/sequences/project-sequences-view.tsx", "src/modules/sequences/use-sequence-overview.ts"]) {
      fs.writeFileSync(path.join(appRoot, file), execFileSync("git", ["-c", `safe.directory=${process.cwd().replaceAll("\\", "/")}`, "show", `${baselineRef}:${file}`], { windowsHide: true }));
    }
    fs.symlinkSync(path.resolve("node_modules"), path.join(appRoot, "node_modules"), "junction");
    fs.writeFileSync(path.join(appRoot, "next.config.ts"), `export default { distDir: '.next', serverExternalPackages: ['better-sqlite3'], turbopack: { root: ${JSON.stringify(process.cwd())} } };\n`);
  }
  process.env.DATABASE_PATH = path.join(root, "test.db");
  process.env.AGENTTASKER_DATA_DIR = path.join(root, "runtime");
  process.env.AGENTTASKER_BUILD_DIR = ".test-artifacts/next-interface";
  const { sqlite, db, runs, sequenceStepRuns, runnerLock } = await import("../db/client");
  const { projectRepository } = await import("../backend/projects/project.repository");
  const { taskerService } = await import("../backend/tasker/tasker.service");
  const { taskService } = await import("../backend/tasks/task.service");
  const { sequenceService } = await import("../backend/sequences/sequence.service");
  // This live process owns the disposable runner lock, so UI launches only enqueue.
  db.insert(runnerLock).values({ id: 1, ownerPid: process.pid, token: randomUUID() }).run();
  for (const count of [0, 50, 200]) {
    const repo = path.join(root, `repo-${count}`);
    execFileSync("git", ["init", "-b", "main", repo], { windowsHide: true, stdio: "ignore" });
    const project = await projectRepository.createProject({ name: `Interface ${count}`, slug: `interface-${count}`, repositoryPath: repo });
    await taskerService.initTasker({ repoPath: repo, projectName: project.name, baseBranch: "main" });
    const task = await taskService.create(project.id, { name: "Task fixture", enabled: false, expectChanges: false, instructions: "Disposable UI fixture.", schedule: { type: "manual", timezone: "UTC" } });
    let sequence = await sequenceService.create(project.id, { name: "Sequence fixture" });
    for (let i = 0; i < 5; i++) sequence = await sequenceService.createStep(project.id, sequence.id, { name: `Step ${i + 1}`, instructions: "Disposable UI fixture.", expectChanges: false });
    for (const kind of ["TASK", "SEQUENCE"]) for (let i = 0; i < count; i++) {
      const id = randomUUID();
      const date = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
      db.insert(runs).values({ id, projectId: project.id, kind, taskId: kind === "TASK" ? task.id : sequence.id, taskName: kind === "TASK" ? task.name : sequence.name, sequenceId: kind === "SEQUENCE" ? sequence.id : null, status: "SUCCESS", queuedAt: date, createdAt: date, startedAt: date, completedAt: date, result: JSON.stringify({ status: "SUCCESS", summary: "Fixture completed.", blocking_error: null }) }).run();
      if (kind === "SEQUENCE") for (const [position, step] of sequence.steps.entries()) db.insert(sequenceStepRuns).values({ id: randomUUID(), runId: id, sequenceId: sequence.id, stepId: step.id, stepName: step.name, position, status: "SUCCESS", startedAt: date, completedAt: date }).run();
    }
  }
  const server = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "dev", appRoot, "--hostname", "127.0.0.1", "--port", String(appPort)], { env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const log = fs.createWriteStream(path.join(root, "server.log"));
  server.stdout.pipe(log); server.stderr.pipe(log);
  const measurements: Array<{ endpoint: string; bytes: number; ms: number; at: number; status: number }> = [];
  let captureUntil = 0;
  const proxy = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    if (url === "/__benchmark/start" && req.method === "POST") {
      measurements.length = 0; captureUntil = Date.now() + 60_000;
      res.end(JSON.stringify({ captureUntil })); return;
    }
    if (url === "/__benchmark/results") {
      res.end(JSON.stringify({ captureUntil, measurements })); return;
    }
    const started = performance.now();
    const outgoing = http.request({ hostname: "127.0.0.1", port: appPort, path: url, method: req.method, headers: req.headers }, (incoming) => {
      res.writeHead(incoming.statusCode ?? 502, incoming.headers);
      let bytes = 0;
      incoming.on("data", chunk => { bytes += chunk.length; });
      incoming.on("end", () => {
        if (Date.now() <= captureUntil && url.startsWith("/api/")) measurements.push({ endpoint: url, bytes, ms: performance.now() - started, at: Date.now(), status: incoming.statusCode ?? 502 });
      });
      incoming.pipe(res);
    });
    outgoing.on("error", () => { res.writeHead(502); res.end("Fixture server starting"); });
    req.pipe(outgoing);
  });
  proxy.on("upgrade", (req, socket, head) => {
    const upstream = net.connect(appPort, "127.0.0.1", () => {
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n`);
      upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  proxy.listen(proxyPort, "127.0.0.1", () => console.log(JSON.stringify({ root, url: `http://127.0.0.1:${proxyPort}`, projects: [0, 50, 200].map(count => `/interface-${count}`) })));
  process.on("SIGINT", () => { server.kill(); proxy.close(); sqlite.close(); });
}
void main();

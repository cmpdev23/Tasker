import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

// Usage: node scripts/real-run-browser-smoke.mjs <path-to-playwright-module>
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || "playwright");
const fixture = JSON.parse(fs.readFileSync(".test-artifacts/smoke.json", "utf8"));
const origin = "http://127.0.0.1:5055";
const api = async (url, method = "GET", body) => {
  const response = await fetch(origin + url, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${method} ${url}: ${JSON.stringify(value)}`);
  return value;
};
const existing = (await api("/api/projects")).find(project => project.repositoryPath === fixture.repo);
const project = existing || await api("/api/projects", "POST", { name: "Real Codex smoke", repositoryPath: fixture.repo });
const base = `/api/projects/${project.id}`;
if (!existing) await api(base + "/init-tasker", "POST", { baseBranch: "main" });
if (!(await api(base + "/runs")).runs.length) {
  for (const task of (await api(base + "/tasks")).tasks) await api(`${base}/tasks/${task.id}`, "DELETE");
}
const { main } = await api(base + "/agents");
await api(base + "/agents", "PUT", { main: { ...main, model: "gpt-5.6-sol", model_reasoning_effort: "medium", agents: { ...main.agents, enabled: false } } });
await api(base + "/instructions", "PUT", { instructions: "This is a disposable test repository. Work only here. The remote-marker.txt file must exist before creating the requested file. Never change README.md or remote-marker.txt. Do not run Git commands. Do not access external services or secret files." });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
page.on("response", async response => { if (response.status() >= 400 && response.url().includes("/api/")) console.log("API failure", response.status(), await response.text()); });
try {
  await page.goto(`${origin}/${project.slug}`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Créer une tâche", exact: true }).click();
  await page.getByLabel("Nom de la tâche", { exact: true }).fill("Smoke task");
  await page.getByLabel("Instructions Markdown", { exact: true }).fill("Create a file named codex-smoke.txt containing exactly: AgentTasker real run verified\\n. Confirm remote-marker.txt exists and leave it unchanged. Make no other changes. Return SUCCESS only after verifying the file. This small file creation is the entire task.");
  await page.getByRole("button", { name: "Enregistrer la tâche", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Modifier Smoke task", exact: true }).click();
  await page.getByLabel("Nom de la tâche", { exact: true }).fill("Real Codex verification");
  await page.getByRole("button", { name: "Enregistrer la tâche", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Modifier Real Codex verification", exact: true }).waitFor();
  const { tasks } = await api(base + "/tasks");
  assert.equal(tasks[0].id, "smoke-task");
  assert.equal(tasks[0].name, "Real Codex verification");
  await page.getByRole("button", { name: "Créer une tâche", exact: true }).click();
  await page.getByLabel("Nom de la tâche", { exact: true }).fill("Delete fixture");
  await page.getByLabel("Instructions Markdown", { exact: true }).fill("Never execute this task.");
  await page.getByRole("button", { name: "Enregistrer la tâche", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Supprimer Delete fixture", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Supprimer/, exact: false }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal((await api(base + "/tasks")).tasks.length, 1);
  const git = args => execFileSync("git", args, { cwd: fixture.repo, encoding: "utf8", windowsHide: true }).trim();
  const before = { status: git(["status", "--porcelain=v1", "--untracked-files=all"]), head: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]) };
  await page.screenshot({ path: ".test-artifacts/tasks.png", fullPage: true });
  const enqueued = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/tasks/smoke-task/runs"));
  await page.getByRole("button", { name: "Exécuter", exact: true }).click();
  const initial = (await (await enqueued).json()).run;
  assert.equal(initial.status, "QUEUED");
  fs.writeFileSync(".test-artifacts/smoke.json", JSON.stringify({ ...fixture, project, runId: initial.id, before }, null, 2));
  console.log(`Real run queued: ${initial.id}`);
  let run = initial;
  let live = false;
  let events = [];
  const deadline = Date.now() + 8 * 60_000;
  let lastStatus;
  while (Date.now() < deadline) {
    const data = await api(`${base}/runs/${run.id}`);
    run = data.run; events = data.events;
    if (run.status !== lastStatus) { console.log(`${run.status}: ${events.length} events`); lastStatus = run.status; }
    if (run.status === "RUNNING" && events.some(event => event.type === "codex")) {
      live = true;
      await page.screenshot({ path: ".test-artifacts/run-live.png", fullPage: true });
    }
    if (["SUCCESS", "FAILED", "CANCELLED"].includes(run.status)) break;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  await new Promise(resolve => setTimeout(resolve, 1800));
  await page.screenshot({ path: ".test-artifacts/run-final.png", fullPage: true });
  const report = { run, live, eventCount: events.length, pageErrors, before, after: { status: git(["status", "--porcelain=v1", "--untracked-files=all"]), head: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]) } };
  fs.writeFileSync(".test-artifacts/real-run-report.json", JSON.stringify(report, null, 2));
  assert.equal(run.status, "SUCCESS", run.error || "Run did not succeed");
  assert.equal(run.baseCommit, fixture.baseCommit);
  assert.equal(JSON.parse(run.resolvedConfig).codex.model, "gpt-5.6-sol");
  assert.ok(run.commitHash);
  assert.ok(live, "Observed live structured events while Codex ran");
  assert.deepEqual(report.before, report.after);
  assert.equal(git(["show", `${run.runBranch}:codex-smoke.txt`]), "AgentTasker real run verified");
  assert.equal(fs.existsSync(path.join(fixture.repo, "codex-smoke.txt")), false);
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ passed: true, runId: run.id, status: run.status, commit: run.commitHash, live, events: events.length, primaryCheckoutUnchanged: true }));
} finally { await browser.close(); }

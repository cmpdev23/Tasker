import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.argv[2] || "playwright");
const fixture = JSON.parse(fs.readFileSync(".test-artifacts/smoke.json", "utf8"));
const base = `http://127.0.0.1:5055/api/projects/${fixture.project.id}`;
const verifySuccess = process.argv.includes("--verify-success");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
try {
  await page.goto(`http://127.0.0.1:5055/${fixture.project.slug}`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Tasks", exact: true }).click();
  const enqueued = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/tasks/smoke-task/runs"));
  await page.getByRole("button", { name: "Exécuter", exact: true }).click();
  let run = (await (await enqueued).json()).run;
  const deadline = Date.now() + (verifySuccess ? 8 * 60_000 : 90_000);
  while (Date.now() < deadline) {
    run = (await (await fetch(`${base}/runs/${run.id}`)).json()).run;
    if (run.status === "RUNNING" && run.codexPid) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.equal(run.status, "RUNNING");
  assert.ok(run.codexPid);
  if (!verifySuccess) await page.getByRole("button", { name: "Annuler l’exécution", exact: true }).click();
  while (Date.now() < deadline) {
    run = (await (await fetch(`${base}/runs/${run.id}`)).json()).run;
    if (["SUCCESS", "FAILED", "CANCELLED"].includes(run.status)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(run.status, verifySuccess ? "SUCCESS" : "CANCELLED", run.error);
  assert.equal(run.terminationVerified, true);
  if (!verifySuccess) assert.ok(fs.existsSync(run.worktreePath), "Cancelled worktree preserved");
  const detail = await (await fetch(`${base}/runs/${run.id}`)).json();
  if (!verifySuccess) assert.ok(detail.events.some(event => event.type === "termination"));
  await new Promise(resolve => setTimeout(resolve, 2000));
  await page.screenshot({ path: verifySuccess ? ".test-artifacts/run-reverified.png" : ".test-artifacts/run-cancelled.png", fullPage: true });
  fs.writeFileSync(verifySuccess ? ".test-artifacts/reverified-report.json" : ".test-artifacts/cancellation-report.json", JSON.stringify({ passed: true, run, events: detail.events.length }, null, 2));
  console.log(JSON.stringify({ passed: true, status: run.status, runId: run.id, terminationVerified: true, worktreePreserved: fs.existsSync(run.worktreePath) }));
} finally { await browser.close(); }

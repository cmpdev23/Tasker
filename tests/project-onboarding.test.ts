import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

let root = "";
let repository = "";
let dataDirectory = "";
let localDataEnvironment: Record<string, string> = {};
let databaseConnection: (typeof import("../db/client"))["sqlite"] | undefined;

function runGit(args: string[]): void {
  const result = spawnSync("git", args, { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [path.resolve("bin/agenttasker.mjs"), "init", ...args], {
    cwd: repository,
    encoding: "utf8",
    windowsHide: true,
    env: {
      NODE_ENV: "test",
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...localDataEnvironment,
    },
  });
}

before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agenttasker-onboarding-test-")));
  repository = path.join(root, "sample-crm");
  if (process.platform === "win32") {
    process.env.LOCALAPPDATA = root;
    localDataEnvironment = { LOCALAPPDATA: root };
    dataDirectory = path.join(root, "AgentTasker");
  } else if (process.platform === "darwin") {
    process.env.HOME = root;
    localDataEnvironment = { HOME: root };
    dataDirectory = path.join(root, "Library", "Application Support", "AgentTasker");
  } else {
    process.env.XDG_DATA_HOME = root;
    localDataEnvironment = { XDG_DATA_HOME: root, HOME: root };
    dataDirectory = path.join(root, "agenttasker");
  }
  fs.mkdirSync(repository);
  runGit(["init", "-b", "main", repository]);
  process.env.DATABASE_PATH = path.join(root, "agenttasker.db");
});

after(() => {
  if (!root) return;
  databaseConnection?.close();
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  assert.equal(path.dirname(root), temporaryRoot);
  assert.ok(path.basename(root).startsWith("agenttasker-onboarding-test-"));
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  delete process.env.DATABASE_PATH;
});

test("CLI initializes, installs, ignores logs and registers a repository idempotently", async () => {
  const first = runCli("--yes", "--name", "Sample CRM");
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Git repository detected/);
  assert.match(first.stdout, new RegExp(`Repository root: ${repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
  assert.match(first.stdout, /Project registration queued/);

  for (const relativePath of [
    ".tasker/project.toml",
    ".tasker/instructions.md",
    ".tasker/LESSONS.md",
    ".tasker/agents/main.toml",
    ".tasker/tasks",
    ".tasker/sequences",
    ".agents/skills/agenttasker-project/SKILL.md",
    ".agents/skills/agenttasker-project/init.md",
  ]) assert.ok(fs.existsSync(path.join(repository, relativePath)), relativePath);
  assert.match(
    fs.readFileSync(path.join(repository, ".agents/skills/agenttasker-project/init.md"), "utf8"),
    /configurer correctement AgentTasker pour ce\s+projet/,
  );
  assert.match(fs.readFileSync(path.join(repository, ".tasker", "project.toml"), "utf8"), /name = "Sample CRM"/);
  assert.match(fs.readFileSync(path.join(repository, ".tasker", "instructions.md"), "utf8"), /\.tasker\/LESSONS\.md/);
  assert.match(fs.readFileSync(path.join(repository, ".tasker", "LESSONS.md"), "utf8"), /mémoire opérationnelle versionnée/i);
  assert.match(fs.readFileSync(path.join(repository, ".gitignore"), "utf8"), /^\/\.tasker\/logs\/$/m);

  fs.writeFileSync(path.join(repository, ".tasker", "instructions.md"), "# Custom instructions\n", "utf8");
  fs.writeFileSync(path.join(repository, ".tasker", "LESSONS.md"), "# Custom lessons\n", "utf8");
  const second = runCli("--yes", "--name", "Ignored replacement");
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(path.join(repository, ".tasker", "instructions.md"), "utf8"), "# Custom instructions\n");
  assert.equal(fs.readFileSync(path.join(repository, ".tasker", "LESSONS.md"), "utf8"), "# Custom lessons\n");
  assert.equal((fs.readFileSync(path.join(repository, ".gitignore"), "utf8").match(/\/\.tasker\/logs\//g) ?? []).length, 1);
  assert.equal(fs.readdirSync(path.join(dataDirectory, "project-registrations")).filter((name) => name.endsWith(".json")).length, 1);

  const imported: Array<{ repositoryPath: string; projectName: string; baseBranch: string }> = [];
  const { importPendingProjectRegistrations } = await import("../backend/projects/project-registration.service");
  await importPendingProjectRegistrations(async (registration) => { imported.push(registration); });
  assert.equal(imported.length, 1);
  assert.equal(imported[0].projectName, "Sample CRM", "project.toml remains the authoritative name");
  assert.equal(fs.realpathSync(imported[0].repositoryPath), fs.realpathSync(repository));
  assert.equal(imported[0].baseBranch, "main");

  const third = runCli("--yes");
  assert.equal(third.status, 0, third.stderr);
  assert.equal(fs.readdirSync(path.join(dataDirectory, "project-registrations")).filter((name) => name.endsWith(".json")).length, 1,
    "repeated initialization keeps one pending registration per repository");
  await assert.rejects(
    importPendingProjectRegistrations(async () => { throw new Error("temporary database failure"); }),
    /temporary database failure/,
  );
  assert.equal(fs.readdirSync(path.join(dataDirectory, "project-registrations")).filter((name) => name.endsWith(".json")).length, 1,
    "application failures keep the request retryable");
  const retried: typeof imported = [];
  await importPendingProjectRegistrations(async (registration) => { retried.push(registration); });
  assert.equal(retried.length, 1);

  const fourth = runCli("--yes");
  assert.equal(fourth.status, 0, fourth.stderr);
  const { projectService } = await import("../backend/projects/project.service");
  ({ sqlite: databaseConnection } = await import("../db/client"));
  const registered = await projectService.listProjects();
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, "Sample CRM");
  assert.equal(registered[0].defaultBranch, "main");
  assert.equal(fs.realpathSync(registered[0].repositoryPath!), fs.realpathSync(repository));

  const fifth = runCli("--yes");
  assert.equal(fifth.status, 0, fifth.stderr);
  assert.equal((await projectService.listProjects()).length, 1, "registration does not duplicate a local Project");
  await projectService.updateProject(registered[0].id, { archived: true });
  assert.equal((await projectService.listProjects()).length, 0);
  const sixth = runCli("--yes");
  assert.equal(sixth.status, 0, sixth.stderr);
  assert.equal((await projectService.listProjects()).length, 1, "registration reactivates an archived Project");
});

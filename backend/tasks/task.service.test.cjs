/* eslint-disable @typescript-eslint/no-require-imports */
// Run with: node --test backend/tasks/task.service.test.cjs
// Use the installed TS compiler without adding a test runtime dependency.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};
const { TaskService } = require("./task.service.ts");
const { validateTaskInput, parseTaskConfig, serializeTaskConfig } = require("./task-config.ts");
const { readString, sectionContent } = require("./toml.ts");
const { ValidationError, NotFoundError, ConflictError } = require("../errors.ts");

const input = (changes = {}) => ({
  name: "Créer une tâche", instructions: "# Instructions\r\n\r\nReview the repository.\n",
  enabled: true, expectChanges: false, schedule: { type: "manual", timezone: "America/Toronto" },
  ...changes,
});

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "agenttasker-tasks-test-"));
  const repository = path.join(root, "repo");
  fs.mkdirSync(path.join(repository, ".tasker"), { recursive: true });
  const service = new TaskService(async (id) => {
    if (id !== "project") throw new NotFoundError("Unknown project.");
    return { repositoryPath: repository };
  });
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith("agenttasker-tasks-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { service, repository, root, tasks: path.join(repository, ".tasker", "tasks") };
}

test("filesystem CRUD, stable IDs, collisions, Markdown preservation and fresh reads", async (t) => {
  const { service, tasks } = fixture(t);
  assert.deepEqual(await service.list("project"), []);
  assert.equal(fs.existsSync(tasks), false, "list must not create storage");
  const first = await service.create("project", input());
  const second = await service.create("project", input());
  assert.equal(first.id, "creer-une-tache");
  assert.equal(second.id, "creer-une-tache-2");
  assert.deepEqual(await service.get("project", first.id), first);
  const updated = await service.update("project", first.id, input({ name: "New name", enabled: false, expectChanges: true }));
  assert.equal(updated.id, first.id);
  assert.deepEqual(await service.get("project", first.id), updated);
  const markdown = path.join(tasks, first.id, "instructions.md");
  fs.writeFileSync(markdown, "An external edit\n");
  assert.equal((await service.get("project", first.id)).instructions, "An external edit\n");
  assert.equal((await service.list("project")).length, 2);
  await service.delete("project", first.id);
  assert.deepEqual(await service.get("project", second.id), second);
  await assert.rejects(service.get("project", first.id), NotFoundError);
  await assert.rejects(service.update("project", first.id, input()), NotFoundError);
  await assert.rejects(service.delete("project", first.id), NotFoundError);
});

test("all schedules round-trip and shared helpers still parse Git configuration", () => {
  for (const schedule of [
    { type: "manual", timezone: "UTC" },
    { type: "once", timezone: "America/Toronto", startsAt: "2026-09-10T07:00:00-04:00" },
    { type: "daily", timezone: "UTC", time: "00:00", startsAt: "2026-09-10T12:00Z" },
    { type: "weekly", timezone: "America/Toronto", time: "23:59", days: ["friday", "monday"], startsAt: "2026-09-10T12:00Z" },
  ]) {
    const task = { id: "audit", ...validateTaskInput(input({ schedule, name: 'Audit "special" \\ config' })) };
    assert.deepEqual(parseTaskConfig(serializeTaskConfig(task), task.id, task.instructions), task);
    if (task.schedule.startsAt) assert.match(task.schedule.startsAt, /Z$/);
  }
  const git = sectionContent('version = 1\n[git]\nbase_branch = "main"\nremote = \'upstream\'\n[next]\nremote = "wrong"\n', "git");
  assert.equal(readString(git, "base_branch"), "main");
  assert.equal(readString(git, "remote"), "upstream");
});

test("strict input validation rejects invalid schedules, dates, fields and types", () => {
  for (const invalid of [null, [], {}, input({ id: "injected" }), input({ enabled: "true" }),
    input({ expectChanges: 1 }), input({ name: " " }), input({ instructions: "" }),
    input({ schedule: { type: "cron", timezone: "UTC" } }),
    input({ schedule: { type: "manual", timezone: "Not/A_Zone" } }),
    input({ schedule: { type: "manual", timezone: "UTC", time: "07:00" } }),
    input({ schedule: { type: "once", timezone: "UTC" } }),
    input({ schedule: { type: "once", timezone: "UTC", startsAt: "2026-09-10T07:00" } }),
    input({ schedule: { type: "once", timezone: "UTC", startsAt: "2026-02-30T07:00Z" } }),
    input({ schedule: { type: "once", timezone: "UTC", startsAt: "2026-01-01T24:00Z" } }),
    input({ schedule: { type: "daily", timezone: "UTC", time: "7:00" } }),
    input({ schedule: { type: "weekly", timezone: "UTC", time: "07:00", days: [] } }),
    input({ schedule: { type: "weekly", timezone: "UTC", time: "07:00", days: ["Monday"] } }),
    input({ schedule: { type: "weekly", timezone: "UTC", time: "07:00", days: ["monday", "monday"] } }),
  ]) assert.throws(() => validateTaskInput(invalid), ValidationError);
});

test("malformed or redirected TOML is rejected, including duplicate and unknown fields", () => {
  const task = { id: "audit", ...input() };
  const content = serializeTaskConfig(task);
  for (const bad of [
    content.replace('instructions = "instructions.md"', 'instructions = "../../outside.md"'),
    content.replace('id = "audit"', 'id = "different"'),
    content.replace("version = 1", "version = 2"),
    content.replace("version = 1", "version = 01"),
    content.replace("enabled = true", 'enabled = "true"'),
    content.replace("enabled = true", "enabled = true\nenabled = false"),
    content + '\n[schedule]\ntype = "once"\n',
    content + '\nunknown = "value"\n',
    content + '\nnot TOML\n',
  ]) assert.throws(() => parseTaskConfig(bad, "audit", task.instructions), ValidationError);
  assert.deepEqual(parseTaskConfig(content.replace('[schedule]', '[schedule] # comment'), "audit", task.instructions), task);
  const weekly = { ...task, schedule: { type: "weekly", timezone: "UTC", time: "07:00", days: ["monday"] } };
  const commented = serializeTaskConfig(weekly).replace('days = ["monday"]', 'days = ["monday",] # ["tuesday"]');
  assert.deepEqual(parseTaskConfig(commented, "audit", task.instructions), weekly);
});

test("path traversal and Windows special filenames never reach task storage", async (t) => {
  const { service } = fixture(t);
  for (const id of ["../outside", "..\\outside", "/absolute", "C:\\outside", "a/b", "a%2fb", "con", "nul", "a.", "a:stream", "a\0b", "A", "a".repeat(101)]) {
    await assert.rejects(service.get("project", id), ValidationError);
    await assert.rejects(service.update("project", id, input()), ValidationError);
    await assert.rejects(service.delete("project", id), ValidationError);
  }
  const reserved = await service.create("project", input({ name: "CON" }));
  assert.equal(reserved.id, "task-con");
  await assert.rejects(service.list("missing"), NotFoundError);
});

for (const level of ["repository", ".tasker", "tasks", "task"]) {
  test(`rejects ${level} symlinks/junctions on reads and mutations`, async (t) => {
    const { service, repository, root, tasks } = fixture(t);
    const task = await service.create("project", input());
    const target = level === "repository" ? repository : level === ".tasker" ? path.join(repository, ".tasker") : level === "tasks" ? tasks : path.join(tasks, task.id);
    const external = path.join(root, "external");
    fs.renameSync(target, external);
    fs.symlinkSync(external, target, process.platform === "win32" ? "junction" : "dir");
    const externalFiles = fs.readdirSync(external);
    await assert.rejects(service.list("project"), ValidationError);
    await assert.rejects(service.get("project", task.id), ValidationError);
    await assert.rejects(service.update("project", task.id, input()), ValidationError);
    await assert.rejects(service.delete("project", task.id), ValidationError);
    if (level !== "task") await assert.rejects(service.create("project", input()), ValidationError);
    assert.deepEqual(fs.readdirSync(external), externalFiles);
  });
}

test("hard-linked task files are rejected without modifying their outside targets", async (t) => {
  const { service, root, tasks } = fixture(t);
  const task = await service.create("project", input());
  const outside = path.join(root, "outside.md");
  fs.writeFileSync(outside, "Do not change");
  const markdown = path.join(tasks, task.id, "instructions.md");
  fs.unlinkSync(markdown);
  fs.linkSync(outside, markdown);
  await assert.rejects(service.get("project", task.id), ValidationError);
  await assert.rejects(service.update("project", task.id, input()), ValidationError);
  await assert.rejects(service.delete("project", task.id), ValidationError);
  assert.equal(fs.readFileSync(outside, "utf8"), "Do not change");
});

test("symbolic task files and dangling task links cannot redirect storage", async (t) => {
  const { service, root, tasks } = fixture(t);
  const task = await service.create("project", input());
  const outside = path.join(root, "outside.md");
  fs.writeFileSync(outside, "Keep outside content");
  const markdown = path.join(tasks, task.id, "instructions.md");
  fs.unlinkSync(markdown);
  try { fs.symlinkSync(outside, markdown, "file"); }
  catch (error) {
    if (error.code === "EPERM") { t.skip("File symlinks require Windows developer mode or privileges."); return; }
    throw error;
  }
  await assert.rejects(service.get("project", task.id), ValidationError);
  await assert.rejects(service.update("project", task.id, input()), ValidationError);
  await assert.rejects(service.delete("project", task.id), ValidationError);
  assert.equal(fs.readFileSync(outside, "utf8"), "Keep outside content");
  fs.unlinkSync(markdown);
  fs.symlinkSync(path.join(root, "missing"), markdown, "file");
  await assert.rejects(service.get("project", task.id), ValidationError);
});

test("oversized files and invalid UTF-8 fail visibly", async (t) => {
  const { service, tasks } = fixture(t);
  const task = await service.create("project", input());
  const markdown = path.join(tasks, task.id, "instructions.md");
  fs.writeFileSync(markdown, Buffer.alloc(1024 * 1024 + 1, 65));
  await assert.rejects(service.get("project", task.id), ValidationError);
  fs.writeFileSync(markdown, Buffer.from([0xc0, 0xaf]));
  await assert.rejects(service.get("project", task.id), ValidationError);
});

test("Agents still round-trip their main and subagent configurations after helper extraction", async (t) => {
  const { repository } = fixture(t);
  const projectModule = require.resolve("../projects/project.service.ts");
  const previousModule = require.cache[projectModule];
  require.cache[projectModule] = { id: projectModule, filename: projectModule, loaded: true,
    exports: { projectService: { getProjectById: async () => ({ repositoryPath: repository }) } } };
  t.after(() => {
    if (previousModule) require.cache[projectModule] = previousModule;
    else delete require.cache[projectModule];
  });
  const { AgentsService, DEFAULT_MAIN_CODEX_CONFIG } = require("../tasker/agents.service.ts");
  const agents = new AgentsService();
  const main = { ...structuredClone(DEFAULT_MAIN_CODEX_CONFIG), model: "test-model" };
  await agents.updateMainAgent("project", main);
  assert.deepEqual((await agents.getAgents("project")).main, main);
  const agent = await agents.createSubagent("project", {
    name: "Reviewer", description: "Check the work", developer_instructions: "Review carefully.\nReport issues.",
    model: "test-model", model_reasoning_effort: "high", sandbox_mode: "read-only",
  });
  assert.deepEqual((await agents.getAgents("project")).subagents, [agent]);
});

test("deletion refuses extra files and incomplete configuration fails visibly", async (t) => {
  const { service, tasks } = fixture(t);
  const task = await service.create("project", input());
  const directory = path.join(tasks, task.id);
  fs.writeFileSync(path.join(directory, "user-notes.md"), "Keep this");
  await assert.rejects(service.delete("project", task.id), ConflictError);
  assert.deepEqual(await service.get("project", task.id), task);
  fs.unlinkSync(path.join(directory, "instructions.md"));
  await assert.rejects(service.list("project"), ValidationError);
});

test("failed second replacement restores instructions and removes staged files", async (t) => {
  const { service, tasks } = fixture(t);
  const task = await service.create("project", input());
  const originalRename = fs.renameSync;
  fs.renameSync = (source, destination) => {
    if (path.basename(destination) === "task.toml") throw new Error("Injected rename failure");
    return originalRename(source, destination);
  };
  try {
    await assert.rejects(service.update("project", task.id, input({ instructions: "Changed" })), /Injected rename failure/);
  } finally { fs.renameSync = originalRename; }
  assert.deepEqual(await service.get("project", task.id), task);
  assert.deepEqual(fs.readdirSync(path.join(tasks, task.id)).sort(), ["instructions.md", "task.toml"]);
});

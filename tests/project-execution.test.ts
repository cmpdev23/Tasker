import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import {
  parseProjectExecutionSettings,
  updateProjectExecutionToml,
  validateProjectExecutionSettings,
} from "../backend/tasker/project-execution";
import {
  projectPreparationCommands,
  projectValidationCommands,
  runProjectCommand,
  type ProjectCommandEvent,
} from "../backend/runs/project-command-runner";
import {
  DEFAULT_PROJECT_EXECUTION_SETTINGS,
  type ProjectExecutionSettings,
} from "../src/types/project-execution";

const configured: ProjectExecutionSettings = {
  defaultTimeoutMinutes: 240,
  packageManager: "npm",
  pythonMinVersion: "3.11",
  installDependencies: true,
  installTimeoutMinutes: 12,
  validationScripts: ["lint", "typecheck", "build"],
  validationTimeoutMinutes: 25,
};

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agenttasker-command-test-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("agenttasker-command-test-"));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return root;
}

test("execution settings default safely and round-trip without replacing unrelated TOML", () => {
  assert.deepEqual(parseProjectExecutionSettings('version = 1\n[git]\nbase_branch = "main"\n'), DEFAULT_PROJECT_EXECUTION_SETTINGS);
  const original = 'version = 1\r\n[git]\r\nbase_branch = "main"\r\n\r\n[execution]\r\n# retained\r\nfuture_key = "kept"\r\n';
  const updated = updateProjectExecutionToml(original, configured);
  assert.ok(updated.includes('base_branch = "main"'));
  assert.ok(updated.includes('# retained\r\nfuture_key = "kept"'));
  assert.ok(updated.includes('validation_scripts = ["lint", "typecheck", "build"]'));
  assert.ok(updated.includes('python_min_version = "3.11"'));
  assert.deepEqual(parseProjectExecutionSettings(updated), configured);
});

test("execution settings reject ambiguous, malformed, unsafe, and unbounded values", () => {
  for (const source of [
    '[execution]\ninstall_dependencies = "yes"\n',
    '[execution]\ndefault_timeout_minutes = -1\n',
    '[execution]\nvalidation_scripts = "build"\n',
    '[execution]\npackage_manager = "deno"\n',
    '[execution]\npackage_manager = "npm"\npackage_manager = "bun"\n',
    '[execution]\npython_min_version = "latest"\n',
    '[execution]\n[execution]\n',
  ]) assert.throws(() => parseProjectExecutionSettings(source));
  assert.throws(() => validateProjectExecutionSettings({ ...configured, validationScripts: ["build && publish"] }));
  assert.throws(() => validateProjectExecutionSettings({ ...configured, pythonMinVersion: "3.11; rm" }));
  assert.throws(() => validateProjectExecutionSettings({ ...configured, validationScripts: ["build", "build"] }));
  assert.throws(() => updateProjectExecutionToml('[execution]\npackage_manager = "npm"\npackage_manager = "bun"\n', configured));
});

test("package-manager commands are deterministic and use package script names only", () => {
  assert.deepEqual(projectPreparationCommands(configured)[0]?.args, ["ci"]);
  assert.deepEqual(projectPreparationCommands({ ...configured, packageManager: "pnpm" })[0]?.args,
    ["install", "--frozen-lockfile"]);
  assert.deepEqual(projectPreparationCommands({ ...configured, packageManager: "yarn" })[0]?.args,
    ["install", "--immutable"]);
  assert.deepEqual(projectPreparationCommands({ ...configured, packageManager: "bun" })[0]?.args,
    ["install", "--frozen-lockfile"]);
  assert.deepEqual(projectValidationCommands(configured).map((command) => command.args),
    [["run", "lint"], ["run", "typecheck"], ["run", "build"]]);
  assert.deepEqual(projectPreparationCommands({ ...configured, installDependencies: false }), []);
});

test("project command runner captures output and verifies process termination", { timeout: 20_000 }, async t => {
  const root = await fixture(t);
  const script = path.join(root, "command.cjs");
  await fs.writeFile(script, "process.stdout.write('prepared'); process.stderr.write('diagnostic');");
  const events: ProjectCommandEvent[] = [];
  const result = await runProjectCommand({
    name: "fixture",
    executable: "npm",
    args: [],
    timeoutMs: 10_000,
  }, { cwd: root, onEvent: (event) => events.push(event) }, {
    executable: process.execPath,
    prefixArgs: [script],
  });
  assert.equal(result.exitCode, 0, result.error ?? undefined);
  assert.equal(result.error, null);
  assert.equal(result.terminationVerified, true);
  assert.equal(events.flatMap((event) => event.type === "stdout" ? [event.text] : []).join(""), "prepared");
  assert.equal(events.flatMap((event) => event.type === "stderr" ? [event.text] : []).join(""), "diagnostic");
});

test("project command runner treats persistence sink failure as a controlled failed command", { timeout: 20_000 }, async t => {
  const root = await fixture(t);
  const script = path.join(root, "long-command.cjs");
  await fs.writeFile(script, "process.stdout.write('event'); setInterval(() => {}, 1000);");
  const result = await runProjectCommand({
    name: "fixture",
    executable: "npm",
    args: [],
    timeoutMs: 10_000,
  }, { cwd: root, onEvent: () => { throw new Error("database unavailable"); } }, {
    executable: process.execPath,
    prefixArgs: [script],
  });
  assert.match(result.error ?? "", /event sink failed: database unavailable/);
  assert.equal(result.terminationVerified, true);
});

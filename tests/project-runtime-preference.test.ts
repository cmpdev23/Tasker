import assert from "node:assert/strict";
import { test } from "node:test";
import { projectService } from "../backend/projects/project.service";
import {
  normalizePythonExecutablePreference,
  projectRuntimePreferenceService,
} from "../backend/runs/project-runtime-preference.service";
import { ValidationError } from "../backend/errors";
import { projectEnvironmentVariableService } from "../backend/runs/project-environment-variable.service";
import { db } from "../db/client";
import { projectEnvironmentVariables } from "../db/schema";
import { eq } from "drizzle-orm";

test("local Python preferences stay in SQLite and can return to auto-detection", async () => {
  const project = await projectService.createProject({ name: `Runtime preference ${crypto.randomUUID()}` });
  try {
    assert.deepEqual(await projectRuntimePreferenceService.get(project.id), { pythonExecutable: null });
    const saved = await projectRuntimePreferenceService.set(project.id, process.execPath);
    assert.equal(saved.pythonExecutable, normalizePythonExecutablePreference(process.execPath));
    assert.deepEqual(await projectRuntimePreferenceService.get(project.id), saved);
    assert.deepEqual(await projectRuntimePreferenceService.set(project.id, null), { pythonExecutable: null });
    assert.deepEqual(await projectRuntimePreferenceService.get(project.id), { pythonExecutable: null });
  } finally {
    await projectService.deleteProject(project.id);
  }
});

test("local Python preferences reject relative and missing paths", () => {
  assert.throws(() => normalizePythonExecutablePreference("python.exe"), ValidationError);
  assert.throws(() => normalizePythonExecutablePreference(`${process.execPath}.missing`), ValidationError);
});

test("project environment values are encrypted, masked, retained, and deleted locally", async () => {
  const project = await projectService.createProject({ name: `Environment ${crypto.randomUUID()}` });
  const secret = `serp-fixture-${crypto.randomUUID()}`;
  try {
    assert.deepEqual(projectEnvironmentVariableService.setAll(project.id, [
      { name: "SERPAPI_API_KEY", value: secret },
    ]), [{ name: "SERPAPI_API_KEY", configured: true }]);
    assert.deepEqual(projectEnvironmentVariableService.resolve(project.id), { SERPAPI_API_KEY: secret });
    const stored = db.select().from(projectEnvironmentVariables)
      .where(eq(projectEnvironmentVariables.projectId, project.id)).get();
    assert.ok(stored);
    assert.notEqual(stored.encryptedValue, secret);
    assert.ok(!stored.encryptedValue.includes(secret));

    projectEnvironmentVariableService.setAll(project.id, [{ name: "SERPAPI_API_KEY" }]);
    assert.deepEqual(projectEnvironmentVariableService.resolve(project.id), { SERPAPI_API_KEY: secret });
    assert.deepEqual(projectEnvironmentVariableService.setAll(project.id, []), []);
    assert.deepEqual(projectEnvironmentVariableService.resolve(project.id), {});
  } finally {
    await projectService.deleteProject(project.id);
  }
});

test("project environment validation rejects duplicates and runner-controlled names", () => {
  assert.throws(() => projectEnvironmentVariableService.setAll("missing", [
    { name: "TOKEN", value: "one" },
    { name: "token", value: "two" },
  ]), ValidationError);
  assert.throws(() => projectEnvironmentVariableService.setAll("missing", [
    { name: "PATH", value: "unsafe" },
  ]), ValidationError);
  assert.throws(() => projectEnvironmentVariableService.setAll("missing", [
    { name: "NEW_SECRET" },
  ]), ValidationError);
});

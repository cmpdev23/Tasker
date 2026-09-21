import assert from "node:assert/strict";
import { test } from "node:test";
import { projectService } from "../backend/projects/project.service";
import {
  normalizePythonExecutablePreference,
  projectRuntimePreferenceService,
} from "../backend/runs/project-runtime-preference.service";
import { ValidationError } from "../backend/errors";

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

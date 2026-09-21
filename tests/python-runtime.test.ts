import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { detectPythonRuntime, pythonVersionAtLeast, withPythonRuntimeEnvironment } from "../backend/runs/python-runtime";

test("Python runtime selection prefers a matching launcher result and preserves diagnostics", () => {
  const executable = path.join(process.cwd(), "fixtures", "python.exe");
  const preferred = process.platform === "win32" ? "py -3.11" : "python";
  const runtime = detectPythonRuntime("3.11", (probe) => {
    if (probe.label === preferred) return { stdout: JSON.stringify({ executable, version: "3.11.9",
      prefix: path.dirname(executable), basePrefix: path.dirname(executable) }) };
    if (probe.label === "python3") return { stdout: JSON.stringify({ executable: path.join(process.cwd(), "python312"), version: "3.12.2",
      prefix: process.cwd(), basePrefix: process.cwd() }) };
    return null;
  });
  assert.equal(runtime.available, true);
  assert.equal(runtime.version, "3.11.9");
  assert.equal(runtime.executable, executable);
  assert.deepEqual(runtime.candidates.map((candidate) => candidate.version), ["3.11.9", "3.12.2"]);
  assert.match(runtime.detail ?? "", new RegExp(preferred.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Python version requirements reject older candidates and the environment only prepends the selected directory", () => {
  const executable = path.join(process.cwd(), "fixtures", "python.exe");
  const unavailable = detectPythonRuntime("3.11", () => ({ stdout: JSON.stringify({ executable, version: "3.10.12",
    prefix: path.dirname(executable), basePrefix: path.dirname(executable) }) }));
  assert.equal(unavailable.available, false);
  assert.match(unavailable.detail ?? "", /none satisfies 3\.11\+/);
  assert.equal(pythonVersionAtLeast("3.12.0", "3.11"), true);
  assert.equal(pythonVersionAtLeast("3.10.99", "3.11"), false);
  const environment = withPythonRuntimeEnvironment({ PATH: "base", KEEP: "present" } as unknown as NodeJS.ProcessEnv, {
    available: true, executable, detail: null, minimumVersion: "3.11", version: "3.11.9", candidates: [], attempts: [],
    prefix: path.dirname(executable), basePrefix: path.dirname(executable), source: "auto",
    readableRoots: [path.dirname(executable)], sandbox: { checked: false, available: false, detail: "Not checked" },
  });
  assert.equal(environment.KEEP, "present");
  assert.equal(environment.PYTHON, executable);
  assert.equal(environment.PYTHONDONTWRITEBYTECODE, "1");
  assert.equal(environment.PATH?.split(path.delimiter)[0], path.dirname(executable));
});

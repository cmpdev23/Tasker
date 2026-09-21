import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runProjectCommand } from "../backend/runs/project-command-runner";

test("project commands choose their own mode regardless of the AgentTasker server environment", { timeout: 30_000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agenttasker-command-env-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("agenttasker-command-env-"));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const script = path.join(root, "check.cjs");
  await fs.writeFile(script, `
    const assert = require('node:assert/strict');
    for (const name of ['NODE_ENV', '__NEXT_PROCESSED_ENV', '__NEXT_PRIVATE_ORIGIN', 'NEXT_RUNTIME', 'TURBOPACK', 'GIT_DIR']) {
      assert.equal(process.env[name], undefined, name + ' leaked from the host');
    }
    assert.equal(process.env.NEXT_PUBLIC_FIXTURE, 'public-fixture');
    assert.equal(process.env.AGENTTASKER_FIXTURE_CREDENTIAL, 'fake-credential');
    assert.equal(process.env.NODE_OPTIONS, '--max-old-space-size=512');
    assert.equal(process.env.GIT_AUTHOR_NAME, 'Fixture Author');
    assert.equal(process.env.SERPAPI_API_KEY, 'fake-project-secret');
    // Frameworks must select their mode from their command, including custom script names.
    process.env.NODE_ENV = process.argv[2] === 'test:unit' ? 'test' : 'production';
    process.stdout.write(process.env.NODE_ENV);
  `);
  const assigned = {
    NODE_ENV: "development", __NEXT_PROCESSED_ENV: "true", __NEXT_PRIVATE_ORIGIN: "http://localhost:5000",
    NEXT_RUNTIME: "nodejs", TURBOPACK: "1", GIT_DIR: "wrong-checkout",
    NEXT_PUBLIC_FIXTURE: "public-fixture", AGENTTASKER_FIXTURE_CREDENTIAL: "fake-credential",
    NODE_OPTIONS: "--max-old-space-size=512", GIT_AUTHOR_NAME: "Fixture Author",
  };
  const previous = new Map(Object.keys(assigned).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, assigned);
    for (const serverMode of ["development", "production", "test"]) {
      Object.assign(process.env, { NODE_ENV: serverMode });
      for (const command of ["install", "build:site", "test:unit"]) {
        let output = "";
        let errors = "";
        const result = await runProjectCommand({ name: command, executable: "npm", args: [command], timeoutMs: 10_000 }, {
          cwd: root, environment: { SERPAPI_API_KEY: "fake-project-secret" }, onEvent(event) {
            if (event.type === "stdout") output += event.text;
            if (event.type === "stderr") errors += event.text;
          },
        }, { executable: process.execPath, prefixArgs: [script] });
        assert.equal(result.exitCode, 0, `${serverMode}/${command}: ${errors}`);
        assert.equal(result.error, null);
        assert.equal(result.terminationVerified, true);
        assert.equal(output, command === "test:unit" ? "test" : "production");
        assert.equal(process.env.NODE_ENV, serverMode, "The server environment must remain unchanged");
        assert.equal(process.env.__NEXT_PROCESSED_ENV, "true");
      }
    }
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

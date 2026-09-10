import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCodex, buildCodexExecArgs, CODEX_RUN_OUTPUT_SCHEMA, type CodexRunEvent } from "../backend/codex/codex-runner";
import type { MainCodexAgentConfig } from "../src/types/codex-agents";

const config: MainCodexAgentConfig = {
  model: 'chosen-model-with-"quote', model_reasoning_effort: "high", model_reasoning_summary: "auto",
  model_verbosity: "medium", sandbox_mode: "read-only", approval_policy: "on-request",
  sandbox_workspace_write: { network_access: false },
  agents: { enabled: false, interrupt_message: false, max_concurrent_threads_per_session: 2,
    default_subagent_model: "subagent-model", default_subagent_reasoning_effort: "low" },
};

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agenttasker-codex-test-"));
  const worktree = path.join(root, "worktree");
  await fs.mkdir(worktree);
  t.after(async () => {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith("agenttasker-codex-test-"));
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const schema = path.join(root, "result.schema.json");
  await fs.writeFile(schema, JSON.stringify(CODEX_RUN_OUTPUT_SCHEMA));
  return { root, worktree, schema };
}

async function stub(root: string, body: string) {
  const file = path.join(root, "stub.cjs");
  await fs.writeFile(file, body);
  return { executable: process.execPath, prefixArgs: [file] };
}

test("argv honors main configuration without approval or sandbox shortcuts", () => {
  const args = buildCodexExecArgs(config, path.resolve("worktree"));
  assert.ok(args.includes('approval_policy="on-request"'));
  assert.ok(args.includes('sandbox_mode="read-only"'));
  assert.ok(args.includes("sandbox_workspace_write.network_access=false"));
  assert.ok(args.includes(`model=${JSON.stringify(config.model)}`));
  assert.ok(args.includes("agents.enabled=false"));
  assert.ok(!args.some(arg => /bypass|full-auto|approve-for-me/.test(arg)));
  assert.equal(args.at(-1), "-");
});

test("stdin remains private and stdout, stderr, UTF-8 JSON, final structured result are captured", async t => {
  const { root, worktree, schema } = await fixture(t);
  const launch = await stub(root, `
    let prompt = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => prompt += chunk);
    process.stdin.on('end', () => {
      if (prompt !== 'private prompt é' || process.argv.includes(prompt)) process.exit(3);
      process.stderr.write('diagnostic');
      process.stdout.write('non JSON diagnostic\\n');
      const result = {status:'SUCCESS',summary:'terminé',blocking_error:null};
      const bytes = Buffer.from(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(result)}}));
      for (const byte of bytes) process.stdout.write(Buffer.from([byte]));
    });`);
  const events: CodexRunEvent[] = [];
  const result = await runCodex({ worktreePath: worktree, prompt: "private prompt é", config,
    timeoutMs: 10000, outputSchemaPath: schema, onEvent: event => events.push(event) }, launch);
  assert.equal(result.exitCode, 0);
  assert.equal(result.error, null);
  assert.equal(result.terminationVerified, true);
  assert.equal(result.agentResult?.summary, "terminé");
  assert.ok(events.some(event => event.type === "started" && event.pid === result.pid));
  assert.equal(events.flatMap(e => e.type === "stderr" ? [e.text] : []).join(""), "diagnostic");
  assert.ok(events.some(e => e.type === "codex"));
  assert.ok(!JSON.stringify(events).includes("private prompt"));
});

test("semantic failure and invalid final outputs fail despite exit zero", async t => {
  const { root, worktree, schema } = await fixture(t);
  for (const final of [JSON.stringify({ status: "FAILURE", summary: "blocked", blocking_error: "No access" }),
    JSON.stringify({ status: "SUCCESS", summary: "done", blocking_error: "Validation blocked" }), "all done"]) {
    const launch = await stub(root, `process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify(final)}}})));`);
    const result = await runCodex({ worktreePath: worktree, prompt: "test", config, timeoutMs: 10000, outputSchemaPath: schema }, launch);
    assert.equal(result.exitCode, 0);
    assert.ok(result.error);
  }
});

test("pre-abort does not spawn and missing executable yields a controlled error", async t => {
  const { root, worktree } = await fixture(t);
  const controller = new AbortController(); controller.abort();
  const result = await runCodex({ worktreePath: worktree, prompt: "test", config, timeoutMs: 1000, signal: controller.signal });
  assert.equal(result.cancelled, true);
  assert.equal(result.pid, null);
  const missing = await runCodex({ worktreePath: worktree, prompt: "test", config, timeoutMs: 1000 }, { executable: path.join(root, "missing.exe") });
  assert.ok(missing.error);
  assert.notEqual(missing.exitCode, 0);
});

for (const kind of ["cancelled", "timeout"]) {
  test(`${kind} stops an actual child process tree with graceful then force events`, { timeout: 45000 }, async t => {
    const { root, worktree } = await fixture(t);
    const launch = await stub(root, `
      const {spawn} = require('node:child_process');
      const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"], {stdio:'ignore',windowsHide:true});
      process.stdout.write(JSON.stringify({type:'test-child',pid:child.pid})+'\\n');
      process.on('SIGTERM',()=>{}); process.stdin.resume(); setInterval(()=>{},1000);`);
    const controller = new AbortController();
    const events: CodexRunEvent[] = [];
    let descendant: number | undefined;
    const result = await runCodex({ worktreePath: worktree, prompt: "test", config,
      timeoutMs: kind === "timeout" ? 700 : 20000, terminationGraceMs: 50, signal: controller.signal,
      onEvent: event => {
        events.push(event);
        const raw = event.type === "codex" ? event.event as { type?: string; pid?: number } : null;
        if (raw?.type === "test-child") {
          descendant = raw.pid;
          if (kind === "cancelled") controller.abort();
        }
      } }, launch);
    assert.equal(result[kind === "timeout" ? "timedOut" : "cancelled"], true);
    assert.ok(descendant);
    assert.throws(() => process.kill(descendant!, 0), { code: "ESRCH" });
    assert.deepEqual(events.filter(e => e.type === "termination").map(e => e.phase), ["graceful", "force"]);
    assert.equal(result.error, null);
    assert.equal(result.terminationVerified, true);
  });
}

test("exit zero with a surviving detached background child fails termination verification", { timeout: 20000 }, async t => {
  const { root, worktree, schema } = await fixture(t);
  const stopFile = path.join(root, "stop-child");
  const finishedFile = path.join(root, "child-finished");
  // The test owns cleanup via a unique sentinel, never by blindly killing an orphan PID.
  const childScript = `
    const fs = require('node:fs');
    const stopFile = ${JSON.stringify(stopFile)};
    const finishedFile = ${JSON.stringify(finishedFile)};
    const finish = () => { fs.writeFileSync(finishedFile, 'finished'); process.exit(0); };
    setInterval(() => { if (fs.existsSync(stopFile)) finish(); }, 25);
    setTimeout(finish, 15000);
  `;
  const launch = await stub(root, `
    const {spawn} = require('node:child_process');
    process.stdin.resume();
    process.stdin.on('end', () => {
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], {
        stdio:'ignore', windowsHide:true,
        // POSIX children remain in the dedicated Codex group; Windows detachment is explicit.
        detached:process.platform === 'win32'
      });
      child.unref();
      console.log(JSON.stringify({type:'test-child',pid:child.pid}));
      console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({status:'SUCCESS',summary:'done',blocking_error:null})}}));
    });
  `);
  const events: CodexRunEvent[] = [];
  let childPid: number | undefined;
  try {
    const result = await runCodex({ worktreePath: worktree, prompt: "test", config,
      timeoutMs: 10000, outputSchemaPath: schema, onEvent: event => {
        events.push(event);
        const raw = event.type === "codex" ? event.event as { type?: string; pid?: number } : null;
        if (raw?.type === "test-child") childPid = raw.pid;
      } }, launch);
    assert.equal(result.exitCode, 0);
    assert.equal(result.agentResult?.status, "SUCCESS");
    assert.ok(childPid);
    assert.doesNotThrow(() => process.kill(childPid!, 0), "Regression requires a real surviving child");
    assert.equal(result.terminationVerified, false);
    assert.match(result.error ?? "", /termination could not be verified/);
    assert.equal(result.cancelled, false);
    assert.equal(result.timedOut, false);
    assert.ok(!events.some(event => event.type === "termination"), "Normal exit verification must not signal orphan processes");
  } finally {
    await fs.writeFile(stopFile, "stop");
    if (childPid) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try { await fs.stat(finishedFile); break; } catch { /* Wait for test-owned child cleanup. */ }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await fs.stat(finishedFile);
    }
  }
});

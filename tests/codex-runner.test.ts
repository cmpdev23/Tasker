import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { APP_SERVER_NOTIFICATION_OPT_OUTS, runCodex, buildCodexAppServerArgs, buildCodexPermissionProfile, buildCodexSandboxPolicy, CODEX_RUN_OUTPUT_SCHEMA, verifyExitedProcessTree, type CodexRunEvent } from "../backend/codex/codex-runner";
import { probePythonSandbox } from "../backend/codex/codex-sandbox-preflight";
import type { MainCodexAgentConfig } from "../src/types/codex-agents";
import type { PythonRuntimeStatus } from "../src/types/project-execution";

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

test("app-server argv and per-turn sandbox honor configuration without bypass shortcuts", () => {
  const args = buildCodexAppServerArgs(config);
  assert.equal(args[0], "app-server");
  assert.ok(args.includes("agents.enabled=false"));
  assert.ok(!args.some(arg => /bypass|full-auto|approve-for-me/.test(arg)));
  assert.ok(APP_SERVER_NOTIFICATION_OPT_OUTS.includes("item/agentMessage/delta"));
  assert.ok(APP_SERVER_NOTIFICATION_OPT_OUTS.includes("item/commandExecution/outputDelta"));
  assert.deepEqual(buildCodexSandboxPolicy(config, path.resolve("worktree")), { type: "readOnly", networkAccess: false });
  const profile = buildCodexPermissionProfile(config, [path.resolve("python")]);
  assert.equal(profile?.id, "agenttasker-run");
  assert.ok(profile?.configOverrides.some((value) => value.includes(JSON.stringify(path.resolve("python")))));
  assert.ok(profile?.configOverrides.some((value) => value.includes("network = { enabled = false }")));

  const workspaceProfile = buildCodexPermissionProfile({
    ...config,
    sandbox_mode: "workspace-write",
    sandbox_workspace_write: { network_access: true },
  }, [path.resolve("python")]);
  assert.ok(workspaceProfile?.configOverrides.some((value) => value.includes("network = { enabled = true }")));
});

test("Python preflight executes the selected interpreter through the read-only permission profile", async t => {
  const { root, worktree } = await fixture(t);
  const launch = await stub(root, `
    const rl = require('node:readline').createInterface({input:process.stdin});
    const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
    rl.on('line', line => {
      const message = JSON.parse(line);
      if (message.id === 1) send({id:1,result:{}});
      if (message.method === 'command/exec') {
        if (message.params.permissionProfile !== 'agenttasker-run') process.exit(4);
        send({id:2,result:{exitCode:0,stdout:JSON.stringify({executable:'C:\\\\Python\\\\python.exe',version:'3.12.3'}),stderr:''}});
      }
    });`);
  const runtime: PythonRuntimeStatus = {
    available: true, executable: path.join(root, "python.exe"), detail: "Python 3.12.3", minimumVersion: "3.11",
    version: "3.12.3", prefix: root, basePrefix: root, source: "explicit", readableRoots: [root], candidates: [],
    attempts: ["configured interpreter"], sandbox: { checked: false, available: false, detail: "Not checked" },
  };
  const result = await probePythonSandbox(runtime, worktree, config, launch);
  assert.deepEqual(result, { checked: true, available: true,
    detail: "Python 3.12.3 is executable inside the Codex sandbox with read-only runtime access." });
});

test("stdin remains private and protocol events, stderr, UTF-8 JSON, final structured result are captured", async t => {
  const { root, worktree, schema } = await fixture(t);
  const launch = await stub(root, `
    const rl = require('node:readline').createInterface({input:process.stdin});
    const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
    rl.on('line', line => {
      const message = JSON.parse(line);
      if (message.id === 1) {
        const optOuts = message.params?.capabilities?.optOutNotificationMethods;
        if (!Array.isArray(optOuts) || !optOuts.includes('item/agentMessage/delta')) process.exit(5);
        send({id:1,result:{}});
      }
      if (message.method === 'thread/start') send({id:2,result:{thread:{id:'thread-1'}}});
      if (message.method === 'turn/start') {
        const prompt = message.params.input[0].text;
        if (prompt !== 'private prompt é' || process.argv.includes(prompt)) process.exit(3);
        if (process.env.SERPAPI_API_KEY !== 'fake-project-secret' || process.argv.includes('fake-project-secret')) process.exit(4);
        process.stderr.write('diagnostic');
        send({id:3,result:{turn:{id:'turn-1',status:'inProgress'}}});
        send({method:'turn/started',params:{turn:{id:'turn-1'}}});
        const result = {status:'SUCCESS',summary:'terminé',blocking_error:null};
        send({method:'item/agentMessage/delta',params:{itemId:'item-1',delta:'fragment inutile'}});
        send({method:'thread/tokenUsage/updated',params:{threadId:'thread-1',tokenUsage:{total:42}}});
        send({method:'item/completed',params:{item:{id:'item-1',type:'agentMessage',phase:'final_answer',text:JSON.stringify(result)}}});
        send({method:'turn/completed',params:{turn:{id:'turn-1',status:'completed'}}});
      }
    });
    process.stdin.on('end', () => process.exit(0));`);
  const events: CodexRunEvent[] = [];
  const result = await runCodex({ worktreePath: worktree, prompt: "private prompt é", config,
    timeoutMs: 10000, outputSchemaPath: schema, environment: { SERPAPI_API_KEY: "fake-project-secret" },
    onEvent: event => events.push(event) }, launch);
  assert.equal(result.exitCode, 0);
  assert.equal(result.error, null);
  assert.equal(result.terminationVerified, true);
  assert.equal(result.agentResult?.summary, "terminé");
  assert.ok(events.some(event => event.type === "started" && event.pid === result.pid));
  assert.equal(events.flatMap(e => e.type === "stderr" ? [e.text] : []).join(""), "diagnostic");
  assert.equal(events.filter(event => event.type === "stdout").length, 0, "JSON-RPC transport lines must not be duplicated as stdout");
  assert.ok(events.some(e => e.type === "codex"));
  assert.ok(!events.some(event => event.type === "codex" &&
    ["item/agentMessage/delta", "thread/tokenUsage/updated"].includes((event.event as { type?: string }).type ?? "")));
  assert.ok(!JSON.stringify(events).includes("private prompt"));
});

test("a transient Codex reconnection notice does not fail a completed turn", async t => {
  const { root, worktree, schema } = await fixture(t);
  const launch = await stub(root, `
    const rl = require('node:readline').createInterface({input:process.stdin});
    const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
    rl.on('line', line => {
      const message = JSON.parse(line);
      if (message.id === 1) send({id:1,result:{}});
      if (message.method === 'thread/start') send({id:2,result:{thread:{id:'thread-1'}}});
      if (message.method === 'turn/start') {
        send({id:3,result:{turn:{id:'turn-1',status:'inProgress'}}});
        send({method:'error',params:{error:{message:'Reconnecting... 1/5'}}});
        send({method:'item/completed',params:{item:{id:'item-1',type:'agentMessage',phase:'final_answer',
          text:JSON.stringify({status:'SUCCESS',summary:'completed after reconnect',blocking_error:null})}}});
        send({method:'turn/completed',params:{turn:{id:'turn-1',status:'completed'}}});
      }
    });
    process.stdin.on('end', () => process.exit(0));`);
  const events: CodexRunEvent[] = [];
  const result = await runCodex({ worktreePath: worktree, prompt: "test", config, timeoutMs: 10_000,
    outputSchemaPath: schema, onEvent: (event) => events.push(event) }, launch);
  assert.equal(result.exitCode, 0);
  assert.equal(result.error, null);
  assert.equal(result.agentResult?.summary, "completed after reconnect");
  assert.ok(events.some((event) => event.type === "codex" &&
    (event.event as { type?: string }).type === "connection.reconnecting"));
});

test("a terminal Codex error interrupts its process before the Run fails", { timeout: 15_000 }, async t => {
  const { root, worktree, schema } = await fixture(t);
  const launch = await stub(root, `
    const rl = require('node:readline').createInterface({input:process.stdin});
    const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
    process.on('SIGTERM', () => process.exit(0));
    rl.on('line', line => {
      const message = JSON.parse(line);
      if (message.id === 1) send({id:1,result:{}});
      if (message.method === 'thread/start') send({id:2,result:{thread:{id:'thread-1'}}});
      if (message.method === 'turn/start') {
        send({id:3,result:{turn:{id:'turn-1',status:'inProgress'}}});
        send({method:'error',params:{error:{message:'Codex transport failed.'}}});
      }
    });
    setInterval(() => {}, 1_000);`);
  const events: CodexRunEvent[] = [];
  const result = await runCodex({ worktreePath: worktree, prompt: "test", config, timeoutMs: 10_000,
    terminationGraceMs: 50, outputSchemaPath: schema, onEvent: (event) => events.push(event) }, launch);
  assert.equal(result.error, "Codex transport failed.");
  assert.equal(result.terminationVerified, true);
  assert.ok(events.some((event) => event.type === "termination" && event.reason === "error"));
});

test("process-tree verification retries transient inspection failures without certifying persistent ones", async () => {
  let attempts = 0;
  await verifyExitedProcessTree(1234, async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("Windows process snapshot temporarily unavailable.");
  });
  assert.equal(attempts, 3);

  attempts = 0;
  await assert.rejects(() => verifyExitedProcessTree(1234, async () => {
    attempts += 1;
    throw new Error("Windows process snapshot unavailable.");
  }), /snapshot unavailable/);
  assert.equal(attempts, 3);
});

test("large image results are accepted without persisting base64 payloads", async t => {
  const { root, worktree, schema } = await fixture(t);
  const imageCharacters = 2_500_000;
  const launch = await stub(root, `
    const rl = require('node:readline').createInterface({input:process.stdin});
    const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
    rl.on('line', line => {
      const message = JSON.parse(line);
      if (message.id === 1) send({id:1,result:{}});
      if (message.method === 'thread/start') send({id:2,result:{thread:{id:'thread-1'}}});
      if (message.method === 'turn/start') {
        send({id:3,result:{turn:{id:'turn-1',status:'inProgress'}}});
        send({method:'item/started',params:{item:{id:'image-1',type:'imageGeneration',status:'inProgress',result:''}}});
        send({method:'item/completed',params:{item:{id:'image-1',type:'imageGeneration',status:'completed',
          revisedPrompt:'cover',result:'A'.repeat(${imageCharacters}),savedPath:'/tmp/generated.png'}}});
        send({method:'custom/largeEvent',params:{detail:'B'.repeat(300000)}});
        send({method:'item/completed',params:{item:{id:'item-1',type:'agentMessage',phase:'final_answer',
          text:JSON.stringify({status:'SUCCESS',summary:'image saved',blocking_error:null})}}});
        send({method:'turn/completed',params:{turn:{id:'turn-1',status:'completed'}}});
      }
    });
    process.stdin.on('end', () => process.exit(0));`);
  const events: CodexRunEvent[] = [];
  const result = await runCodex({ worktreePath: worktree, prompt: "generate image", config,
    timeoutMs: 10000, outputSchemaPath: schema, onEvent: event => events.push(event) }, launch);

  assert.equal(result.exitCode, 0);
  assert.equal(result.error, null);
  assert.equal(result.agentResult?.summary, "image saved");
  const completed = events.find(event => event.type === "codex" &&
    (event.event as { type?: string }).type === "item.completed" &&
    (event.event as { item?: { id?: string } }).item?.id === "image-1");
  assert.ok(completed?.type === "codex");
  const image = (completed.event as { item: Record<string, unknown> }).item;
  assert.equal(image.type, "image_generation");
  assert.equal(image.saved_path, "/tmp/generated.png");
  assert.equal(image.result_omitted, true);
  assert.equal(image.result_encoding, "base64");
  assert.equal(image.result_character_count, imageCharacters);
  assert.equal("result" in image, false);
  assert.ok(JSON.stringify(events).length < 200_000, "persisted events must stay bounded");
  const largeEvent = events.find(event => event.type === "codex" &&
    (event.event as { type?: string }).type === "custom/largeEvent");
  assert.match(JSON.stringify(largeEvent), /AgentTasker omitted \d+ characters/);
});

test("semantic failure and invalid final outputs fail despite exit zero", async t => {
  const { root, worktree, schema } = await fixture(t);
  for (const final of [JSON.stringify({ status: "FAILURE", summary: "blocked", blocking_error: "No access" }),
    JSON.stringify({ status: "SUCCESS", summary: "done", blocking_error: "Validation blocked" }), "all done"]) {
    const launch = await stub(root, `
      const rl = require('node:readline').createInterface({input:process.stdin});
      const send = value => console.log(JSON.stringify(value));
      rl.on('line', line => {
        const message = JSON.parse(line);
        if (message.id === 1) send({id:1,result:{}});
        if (message.method === 'thread/start') send({id:2,result:{thread:{id:'thread-1'}}});
        if (message.method === 'turn/start') {
          send({id:3,result:{turn:{id:'turn-1',status:'inProgress'}}});
          send({method:'item/completed',params:{item:{id:'item-1',type:'agentMessage',phase:'final_answer',text:${JSON.stringify(final)}}}});
          send({method:'turn/completed',params:{turn:{id:'turn-1',status:'completed'}}});
        }
      });
      process.stdin.on('end', () => process.exit(0));`);
    const result = await runCodex({ worktreePath: worktree, prompt: "test", config, timeoutMs: 10000, outputSchemaPath: schema }, launch);
    assert.equal(result.exitCode, 0);
    assert.ok(result.error);
  }
});

test("an unstructured final answer receives one schema-only repair turn in the same thread", async t => {
  const { root, worktree, schema } = await fixture(t);
  const launch = await stub(root, `
    const rl = require('node:readline').createInterface({input:process.stdin});
    const send = value => console.log(JSON.stringify(value));
    let turns = 0;
    rl.on('line', line => {
      const message = JSON.parse(line);
      if (message.id === 1) send({id:1,result:{}});
      if (message.method === 'thread/start') send({id:2,result:{thread:{id:'thread-1'}}});
      if (message.method === 'turn/start') {
        turns += 1;
        if (turns === 2 && !/previous final answer did not satisfy/i.test(message.params.input[0].text)) process.exit(9);
        send({id:message.id,result:{turn:{id:'turn-'+turns,status:'inProgress'}}});
        const text = turns === 1 ? 'Completed research, but omitted the JSON envelope.' :
          JSON.stringify({status:'SUCCESS',summary:'Recovered structured result',blocking_error:null});
        send({method:'item/completed',params:{item:{id:'item-'+turns,type:'agentMessage',phase:'final_answer',text}}});
        send({method:'turn/completed',params:{turn:{id:'turn-'+turns,status:'completed'}}});
      }
    });
    process.stdin.on('end', () => process.exit(0));`);
  const events: CodexRunEvent[] = [];
  const result = await runCodex({ worktreePath: worktree, prompt: "test", config, timeoutMs: 10_000,
    outputSchemaPath: schema, onEvent: event => events.push(event) }, launch);

  assert.equal(result.exitCode, 0);
  assert.equal(result.error, null);
  assert.equal(result.agentResult?.summary, "Recovered structured result");
  assert.equal(events.filter((event) => event.type === "codex" &&
    (event.event as { type?: string }).type === "result.repair").length, 1);
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
      process.stdout.write(JSON.stringify({method:'test-child',params:{pid:child.pid}})+'\\n');
      const rl = require('node:readline').createInterface({input:process.stdin});
      rl.on('line', line => { const message = JSON.parse(line); if (message.id === 1) console.log(JSON.stringify({id:1,result:{}})); });
      process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`);
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
    const rl = require('node:readline').createInterface({input:process.stdin});
    const send = value => console.log(JSON.stringify(value));
    rl.on('line', line => {
      const message = JSON.parse(line);
      if (message.id === 1) send({id:1,result:{}});
      if (message.method === 'thread/start') send({id:2,result:{thread:{id:'thread-1'}}});
      if (message.method === 'turn/start') {
        const child = spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], {
          stdio:'ignore', windowsHide:true,
          detached:process.platform === 'win32'
        });
        child.unref();
        send({id:3,result:{turn:{id:'turn-1',status:'inProgress'}}});
        send({method:'test-child',params:{pid:child.pid}});
        send({method:'item/completed',params:{item:{id:'item-1',type:'agentMessage',phase:'final_answer',text:JSON.stringify({status:'SUCCESS',summary:'done',blocking_error:null})}}});
        send({method:'turn/completed',params:{turn:{id:'turn-1',status:'completed'}}});
      }
    });
    process.stdin.on('end', () => process.exit(0));
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

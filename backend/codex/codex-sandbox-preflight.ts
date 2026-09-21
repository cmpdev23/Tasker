import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolveCodexExecutable } from "./codex-executable";
import { buildCodexAppServerArgs, buildCodexPermissionProfile, buildCodexSandboxPolicy } from "./codex-runner";
import { runGitEnvironment } from "../git/git-environment";
import { withPythonRuntimeEnvironment } from "../runs/python-runtime";
import type { MainCodexAgentConfig } from "../../src/types/codex-agents";
import type { PythonRuntimeStatus, PythonSandboxStatus } from "../../src/types/project-execution";

const SANDBOX_PROBE = "import json,sys; print(json.dumps({'executable':sys.executable,'version':'.'.join(map(str,sys.version_info[:3]))}))";

function actionableFailure(detail: string): string {
  if (process.platform === "win32" && /CreateProcessAsUserW failed:\s*(?:-1073283067|5)\b/i.test(detail)) {
    return `${detail} Windows refused to start this interpreter under the restricted Codex account. ` +
      "Choose a system-wide Python installation readable by local users, or repair the Codex Windows sandbox. " +
      "Using danger-full-access bypasses this isolation and is not recommended as the default.";
  }
  return detail;
}

export async function probePythonSandbox(
  runtime: PythonRuntimeStatus,
  cwd: string,
  config: MainCodexAgentConfig,
  launch?: { executable: string; prefixArgs?: string[] },
): Promise<PythonSandboxStatus> {
  if (!runtime.available || !runtime.executable) {
    return { checked: false, available: false, detail: "No host Python runtime is available to test in the Codex sandbox." };
  }
  return new Promise((resolve) => {
    const permissionProfile = buildCodexPermissionProfile(config, runtime.readableRoots);
    const args = buildCodexAppServerArgs(config, permissionProfile);
    const child = spawn(launch?.executable ?? resolveCodexExecutable(), [...(launch?.prefixArgs ?? []), ...args], {
      cwd,
      env: withPythonRuntimeEnvironment(runGitEnvironment(), runtime),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });
    let settled = false;
    let stderr = "";
    const finish = (status: PythonSandboxStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      lines.close();
      child.stdin.end();
      child.kill();
      resolve(status);
    };
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const timeout = setTimeout(() => finish({
      checked: true,
      available: false,
      detail: "Codex sandbox Python preflight timed out.",
    }), 15_000);
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 2_000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish({ checked: true, available: false,
      detail: `Codex sandbox preflight could not start: ${error.message}` }));
    child.on("close", (code) => {
      if (!settled) finish({ checked: true, available: false,
        detail: `Codex sandbox preflight exited with code ${code ?? "unknown"}.${stderr.trim() ? ` ${stderr.trim()}` : ""}` });
    });
    lines.on("line", (line) => {
      let message: { id?: number; result?: { exitCode?: number; stdout?: string; stderr?: string }; error?: { message?: string } };
      try { message = JSON.parse(line) as typeof message; } catch { return; }
      if (message.error?.message) {
        finish({ checked: true, available: false, detail: actionableFailure(message.error.message) });
      } else if (message.id === 1) {
        send({ method: "initialized", params: {} });
        send({ method: "command/exec", id: 2, params: {
          command: [runtime.executable, "-I", "-c", SANDBOX_PROBE],
          cwd,
          ...(permissionProfile
            ? { permissionProfile: permissionProfile.id }
            : { sandboxPolicy: buildCodexSandboxPolicy(config, cwd) }),
          timeoutMs: 10_000,
        } });
      } else if (message.id === 2 && message.result) {
        let validOutput = false;
        try {
          const parsed = JSON.parse(message.result.stdout?.trim() ?? "") as { executable?: unknown; version?: unknown };
          validOutput = typeof parsed.executable === "string" && typeof parsed.version === "string";
        } catch { /* A successful Python probe must still return the expected JSON. */ }
        const ok = message.result.exitCode === 0 && validOutput;
        const failure = message.result.stderr?.trim() || (message.result.exitCode === 0
          ? "the interpreter returned an unexpected probe result"
          : `exit ${message.result.exitCode ?? "unknown"}`);
        finish({
          checked: true,
          available: ok,
          detail: ok
            ? `Python ${runtime.version ?? ""} is executable inside the Codex sandbox with read-only runtime access.`.trim()
            : actionableFailure(`Python is visible to AgentTasker but failed inside the Codex sandbox: ${failure}`),
        });
      }
    });
    send({ method: "initialize", id: 1, params: {
      clientInfo: { name: "agenttasker", title: "AgentTasker", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    } });
  });
}

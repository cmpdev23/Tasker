import type { ExecutableStatus } from "../../src/types/project-execution";

export const REQUIRED_NODE_MAJOR = 24;

export function nodeMajor(version = process.versions.node): number | null {
  const match = /^(\d+)\./.exec(version);
  return match ? Number(match[1]) : null;
}

export function isRequiredNodeRuntime(version = process.versions.node): boolean {
  return nodeMajor(version) === REQUIRED_NODE_MAJOR;
}

export function nodeRuntimeStatus(): ExecutableStatus {
  const version = process.version;
  return isRequiredNodeRuntime()
    ? { available: true, executable: process.execPath, detail: version }
    : {
      available: false,
      executable: process.execPath,
      detail: `Node.js ${REQUIRED_NODE_MAJOR} is required; AgentTasker is running ${version}.`,
    };
}

export function assertRequiredNodeRuntime(): void {
  const runtime = nodeRuntimeStatus();
  if (!runtime.available) throw new Error(runtime.detail ?? `Node.js ${REQUIRED_NODE_MAJOR} is required.`);
}

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;

export type PackageManager = (typeof PACKAGE_MANAGERS)[number];
export type ProjectProcessEnvironment = Record<string, string>;

export interface ProjectExecutionSettings {
  defaultTimeoutMinutes: number;
  packageManager: PackageManager;
  /** Optional portable minimum version, resolved against this machine at Run start. */
  pythonMinVersion: string | null;
  installDependencies: boolean;
  installTimeoutMinutes: number;
  validationScripts: string[];
  validationTimeoutMinutes: number;
}

/** Machine-local execution preferences. These values never belong in `.tasker/`. */
export interface ProjectLocalExecutionSettings {
  pythonExecutable: string | null;
  /** Values are intentionally omitted from every API response. */
  environmentVariables: ProjectEnvironmentVariableMetadata[];
}

export interface ProjectEnvironmentVariableMetadata {
  name: string;
  configured: true;
}

export interface ProjectEnvironmentVariableInput {
  name: string;
  /** Omit to retain an already configured value with the same name. */
  value?: string;
}

export interface ExecutableStatus {
  available: boolean;
  executable: string | null;
  detail: string | null;
}

export interface ProjectExecutionRuntimeStatus {
  node: ExecutableStatus;
  packageManager: ExecutableStatus;
  python: PythonRuntimeStatus;
}

export interface PythonRuntimeCandidate {
  command: string;
  executable: string;
  version: string;
  prefix: string;
  basePrefix: string;
  source: "auto" | "explicit";
}

export interface PythonSandboxStatus {
  checked: boolean;
  available: boolean;
  detail: string;
}

/** Diagnostic data contains only executable paths and versions, never environment values. */
export interface PythonRuntimeStatus extends ExecutableStatus {
  minimumVersion: string | null;
  version: string | null;
  prefix: string | null;
  basePrefix: string | null;
  source: "auto" | "explicit" | null;
  readableRoots: string[];
  candidates: PythonRuntimeCandidate[];
  attempts: string[];
  sandbox: PythonSandboxStatus;
}

export const DEFAULT_PROJECT_EXECUTION_SETTINGS: ProjectExecutionSettings = {
  defaultTimeoutMinutes: 180,
  packageManager: "npm",
  pythonMinVersion: null,
  installDependencies: false,
  installTimeoutMinutes: 15,
  validationScripts: [],
  validationTimeoutMinutes: 20,
};

export const DEFAULT_PROJECT_LOCAL_EXECUTION_SETTINGS: ProjectLocalExecutionSettings = {
  pythonExecutable: null,
  environmentVariables: [],
};

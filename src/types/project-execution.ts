export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;

export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

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
}

/** Diagnostic data contains only executable paths and versions, never environment values. */
export interface PythonRuntimeStatus extends ExecutableStatus {
  minimumVersion: string | null;
  version: string | null;
  candidates: PythonRuntimeCandidate[];
  attempts: string[];
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

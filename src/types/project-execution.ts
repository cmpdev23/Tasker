export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;

export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export interface ProjectExecutionSettings {
  defaultTimeoutMinutes: number;
  packageManager: PackageManager;
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
}

export const DEFAULT_PROJECT_EXECUTION_SETTINGS: ProjectExecutionSettings = {
  defaultTimeoutMinutes: 180,
  packageManager: "npm",
  installDependencies: false,
  installTimeoutMinutes: 15,
  validationScripts: [],
  validationTimeoutMinutes: 20,
};

const ROUTING_VARIABLES = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
]);

/** Resolve Git's target from the run cwd while retaining SSH, askpass and commit identity. */
export function runGitEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    const normalized = key.toUpperCase();
    if (ROUTING_VARIABLES.has(normalized) || /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(normalized)) {
      delete env[key];
    }
  }
  return env;
}

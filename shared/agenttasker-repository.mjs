import fs from "node:fs";
import path from "node:path";

export const PROJECT_INSTRUCTIONS_TEMPLATE = "# Instructions du projet\n";

export const MAIN_AGENT_TEMPLATE = `# Codex defaults managed by AgentTasker for this repository.
# Keys intentionally mirror Codex config.toml.
model_reasoning_effort = "high"
model_reasoning_summary = "auto"
model_verbosity = "medium"
sandbox_mode = "workspace-write"
approval_policy = "never"

[sandbox_workspace_write]
network_access = false

[agents]
enabled = true
interrupt_message = true
`;

function quoteToml(value) {
  return JSON.stringify(String(value).replace(/\r\n/g, "\n"));
}

export function projectTomlTemplate({ projectName, baseBranch, packageManager = "npm" }) {
  return `version = 1
name = ${quoteToml(projectName)}

[git]
base_branch = ${quoteToml(baseBranch)}
remote = "origin"
push = false
create_pull_request = false
pull_request_draft = true

[execution]
default_timeout_minutes = 180
package_manager = ${quoteToml(packageManager)}
install_dependencies = false
install_timeout_minutes = 15
validation_scripts = []
validation_timeout_minutes = 20
`;
}

function assertSafePath(root, relativeParts) {
  let current = root;
  for (const part of relativeParts) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to initialize through symbolic link: ${current}`);
    }
  }
}

function writeMissingFile(filePath, content, created) {
  if (fs.existsSync(filePath)) {
    const info = fs.lstatSync(filePath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular file: ${filePath}`);
    return;
  }
  fs.writeFileSync(filePath, content, { encoding: "utf8", flag: "wx" });
  created.push(filePath);
}

export function initializeAgentTaskerRepository(input) {
  const repositoryPath = fs.realpathSync(path.resolve(input.repositoryPath));
  if (!fs.statSync(repositoryPath).isDirectory()) throw new Error("Repository path must be a directory.");
  const projectName = String(input.projectName || "").trim();
  const baseBranch = String(input.baseBranch || "").trim();
  if (!projectName) throw new Error("Project name is required.");
  if (!baseBranch) throw new Error("Base branch is required.");

  assertSafePath(repositoryPath, [".tasker"]);
  const taskerDirectory = path.join(repositoryPath, ".tasker");
  const existed = fs.existsSync(taskerDirectory);
  if (existed && input.allowExisting === false) throw new Error("TASKER_ALREADY_EXISTS");
  if (existed && !fs.statSync(taskerDirectory).isDirectory()) {
    throw new Error(`Expected .tasker to be a directory: ${taskerDirectory}`);
  }

  const created = [];
  if (!existed) {
    fs.mkdirSync(taskerDirectory);
    created.push(taskerDirectory);
  }
  for (const directory of ["agents", "tasks", "sequences"]) {
    assertSafePath(taskerDirectory, [directory]);
    const target = path.join(taskerDirectory, directory);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target);
      created.push(target);
    } else if (!fs.statSync(target).isDirectory()) {
      throw new Error(`Expected a directory: ${target}`);
    }
  }

  assertSafePath(taskerDirectory, ["project.toml"]);
  assertSafePath(taskerDirectory, ["instructions.md"]);
  assertSafePath(taskerDirectory, ["agents", "main.toml"]);
  writeMissingFile(path.join(taskerDirectory, "project.toml"), projectTomlTemplate({
    projectName,
    baseBranch,
    packageManager: input.packageManager,
  }), created);
  writeMissingFile(path.join(taskerDirectory, "instructions.md"), PROJECT_INSTRUCTIONS_TEMPLATE, created);
  writeMissingFile(path.join(taskerDirectory, "agents", "main.toml"), MAIN_AGENT_TEMPLATE, created);

  return { repositoryPath, taskerDirectory, existed, created };
}

export function ensureTaskerLogsIgnored(repositoryPath) {
  const root = fs.realpathSync(path.resolve(repositoryPath));
  assertSafePath(root, [".gitignore"]);
  const gitignorePath = path.join(root, ".gitignore");
  const ignoreRule = "/.tasker/logs/";
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${ignoreRule}\n`, { encoding: "utf8", flag: "wx" });
    return { changed: true, filePath: gitignorePath };
  }
  const info = fs.lstatSync(gitignorePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular .gitignore: ${gitignorePath}`);
  const content = fs.readFileSync(gitignorePath, "utf8");
  const covered = content.split(/\r?\n/).some((line) => {
    const rule = line.trim();
    return rule === ignoreRule || rule === ".tasker/logs/" || rule === "/.tasker/logs/*" || rule === ".tasker/logs/*";
  });
  if (covered) return { changed: false, filePath: gitignorePath };
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const separator = content.length > 0 && !content.endsWith("\n") ? newline : "";
  fs.appendFileSync(gitignorePath, `${separator}${ignoreRule}${newline}`, "utf8");
  return { changed: true, filePath: gitignorePath };
}

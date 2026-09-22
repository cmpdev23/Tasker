#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import {
  initializeAgentTaskerRepository,
  ensureTaskerLogsIgnored,
} from "../shared/agenttasker-repository.mjs";
import { queueProjectRegistration } from "../shared/agenttasker-local-data.mjs";
import {
  SKILL_NAME,
  SKILL_RELATIVE_PATH,
  assertNoSymlinkPath,
  assertSkillDirectory,
  readVersion,
  replaceDirectory,
  treeDigest,
} from "../.agents/skills/agenttasker-project/scripts/sync-lib.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const colorEnabled = output.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => colorEnabled ? `\u001b[${code}m${text}\u001b[0m` : text;
const cyan = (text) => paint("36", text);
const green = (text) => paint("32", text);
const yellow = (text) => paint("33", text);
const dim = (text) => paint("2", text);

function usage() {
  console.log(`AgentTasker CLI

Usage:
  agenttasker init [repository] [options]
  agenttasker sequence sync [repository] (--id <sequence-id> | --all) [options]

Options:
  --name <name>            Project name (defaults to the repository folder)
  --base-branch <branch>   Base branch (detected from Git when omitted)
  --yes, -y                Accept safe defaults without prompts
  --no-skill               Do not install the bundled AgentTasker skill
  --force-skill            Replace a different installed AgentTasker skill
  --no-register            Do not register the project in the local app
  --help, -h               Show this help

Sequence sync options:
  --id <sequence-id>        Migrate one Sequence checkpoint
  --all                     Migrate every eligible Sequence checkpoint
  --dry-run                 Inspect eligibility without writing Git state
  --database <path>         Local AgentTasker SQLite database (or DATABASE_PATH)

From an AgentTasker source checkout, run npm link once. Then execute
agenttasker init from the Git repository you want to configure.`);
}

function parseArguments(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") return { help: true };
  const command = argv[0];
  if (command === "sequence") return parseSequenceArguments(argv.slice(1));
  if (command !== "init") throw new Error(`Unknown command: ${command}`);
  const options = { command, repository: ".", name: "", baseBranch: "", yes: false, skill: true, forceSkill: false, register: true };
  let repositorySet = false;
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--name") {
      const next = argv[++index];
      if (!next || next.startsWith("-")) throw new Error("--name requires a value.");
      options.name = next;
    } else if (value === "--base-branch") {
      const next = argv[++index];
      if (!next || next.startsWith("-")) throw new Error("--base-branch requires a value.");
      options.baseBranch = next;
    }
    else if (value === "--yes" || value === "-y") options.yes = true;
    else if (value === "--no-skill") options.skill = false;
    else if (value === "--force-skill") options.forceSkill = true;
    else if (value === "--no-register") options.register = false;
    else if (value === "--help" || value === "-h") return { help: true };
    else if (value.startsWith("-")) throw new Error(`Unknown option: ${value}`);
    else if (!repositorySet) {
      options.repository = value;
      repositorySet = true;
    } else throw new Error(`Unexpected argument: ${value}`);
  }
  if (options.forceSkill) options.skill = true;
  return options;
}

function parseSequenceArguments(argv) {
  if (argv[0] !== "sync") throw new Error(`Unknown sequence command: ${argv[0] || ""}`);
  const options = { command: "sequence-sync", repository: ".", sequenceId: "", all: false, dryRun: false, database: "" };
  let repositorySet = false;
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--id") {
      const next = argv[++index];
      if (!next || next.startsWith("-")) throw new Error("--id requires a Sequence identifier.");
      options.sequenceId = next;
    } else if (value === "--all") options.all = true;
    else if (value === "--dry-run") options.dryRun = true;
    else if (value === "--database") {
      const next = argv[++index];
      if (!next || next.startsWith("-")) throw new Error("--database requires a path.");
      options.database = next;
    } else if (value === "--help" || value === "-h") return { help: true };
    else if (value.startsWith("-")) throw new Error(`Unknown option: ${value}`);
    else if (!repositorySet) { options.repository = value; repositorySet = true; }
    else throw new Error(`Unexpected argument: ${value}`);
  }
  if (Boolean(options.sequenceId) === options.all) throw new Error("Use exactly one of --id <sequence-id> or --all.");
  return options;
}

function gitEnvironment() {
  const environment = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) {
    delete environment[key];
  }
  return environment;
}

function git(repository, args, optional = false) {
  const result = spawnSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    windowsHide: true,
    env: gitEnvironment(),
  });
  if (result.status !== 0 && !optional) {
    throw new Error((result.stderr || `git ${args[0]} failed`).trim());
  }
  return result.status === 0 ? result.stdout.trim() : "";
}

function repositoryRoot(requestedPath) {
  const candidate = path.resolve(requestedPath);
  const root = git(candidate, ["rev-parse", "--show-toplevel"]);
  return fs.realpathSync(path.resolve(root));
}

function detectBaseBranch(repository) {
  const remoteHead = git(repository, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], true);
  if (remoteHead.startsWith("origin/")) return remoteHead.slice("origin/".length);
  const current = git(repository, ["branch", "--show-current"], true);
  if (current) return current;
  const branches = git(repository, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"], true).split(/\r?\n/).filter(Boolean);
  if (branches.includes("main")) return "main";
  if (branches.includes("master")) return "master";
  return branches[0] || "main";
}

function detectPackageManager(repository) {
  if (fs.existsSync(path.join(repository, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(repository, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(repository, "bun.lock")) || fs.existsSync(path.join(repository, "bun.lockb"))) return "bun";
  return "npm";
}

function existingProjectName(repository) {
  const configPath = path.join(repository, ".tasker", "project.toml");
  if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) return "";
  const topLevel = fs.readFileSync(configPath, "utf8").split(/^\s*\[/m, 1)[0];
  const match = topLevel.match(/^\s*name\s*=\s*("(?:\\.|[^"\\])*")\s*$/m);
  if (!match) return "";
  try { return JSON.parse(match[1]); } catch { return ""; }
}

function installBundledSkill(repository, force) {
  const source = path.join(appRoot, ".agents", "skills", SKILL_NAME);
  assertSkillDirectory(source);
  assertNoSymlinkPath(repository, [".agents", "skills", SKILL_NAME]);
  const destination = path.join(repository, SKILL_RELATIVE_PATH);
  if (path.resolve(source) === path.resolve(destination)) {
    return { status: "current", version: readVersion(source), destination };
  }
  if (fs.existsSync(destination)) {
    if (treeDigest(source) === treeDigest(destination)) {
      return { status: "current", version: readVersion(source), destination };
    }
    if (!force) return { status: "different", version: readVersion(destination), destination };
  }
  replaceDirectory(source, destination);
  return { status: "installed", version: readVersion(source), destination };
}

async function askText(reader, label, defaultValue) {
  const answer = (await reader.question(`${label} ${dim(`[${defaultValue}]`)}: `)).trim();
  return answer || defaultValue;
}

async function askYesNo(reader, label, defaultValue) {
  const hint = defaultValue ? "Y/n" : "y/N";
  const answer = (await reader.question(`${label} ${dim(`[${hint}]`)}: `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes" || answer === "o" || answer === "oui";
}

function line(symbol, message, color = green) {
  console.log(`${color(symbol)} ${message}`);
}

async function init(options) {
  console.log(cyan("╭────────────────────────────────────╮"));
  console.log(cyan("│          AgentTasker Setup         │"));
  console.log(cyan("│   Automate the work. Keep control. │"));
  console.log(cyan("╰────────────────────────────────────╯"));
  console.log();

  const repository = repositoryRoot(options.repository);
  const detectedName = existingProjectName(repository) || path.basename(repository);
  const detectedBranch = detectBaseBranch(repository);
  line("✓", "Git repository detected");
  line("✓", `Repository root: ${repository}`);

  let projectName = options.name.trim() || detectedName;
  let baseBranch = options.baseBranch.trim() || detectedBranch;
  let installSkill = options.skill;
  let confirmed = true;
  let reader;
  if (!options.yes) {
    if (!input.isTTY || !output.isTTY) throw new Error("Interactive input is unavailable. Use --yes with --name when needed.");
    reader = createInterface({ input, output });
    try {
      projectName = options.name.trim() || await askText(reader, "Project name", detectedName);
      baseBranch = options.baseBranch.trim() || await askText(reader, "Base branch", detectedBranch);
      if (options.skill) installSkill = await askYesNo(reader, "Install the AgentTasker project skill?", true);
      confirmed = await askYesNo(reader, "Initialize and register this repository?", true);
    } finally {
      reader.close();
    }
  }
  if (!confirmed) {
    console.log(yellow("Initialization cancelled. No files were changed."));
    return;
  }
  if (!projectName) throw new Error("Project name cannot be empty.");
  if (!baseBranch) throw new Error("Base branch cannot be empty.");
  git(repository, ["check-ref-format", "--branch", baseBranch]);

  const initialized = initializeAgentTaskerRepository({
    repositoryPath: repository,
    projectName,
    baseBranch,
    packageManager: detectPackageManager(repository),
    allowExisting: true,
  });
  line("✓", initialized.created.length ? `Initialized .tasker/ (${initialized.created.length} item${initialized.created.length === 1 ? "" : "s"} created)` : ".tasker/ is already complete");

  if (installSkill) {
    const skill = installBundledSkill(repository, options.forceSkill);
    if (skill.status === "different") {
      line("!", `A different ${SKILL_NAME} skill already exists; preserved it. Use --force-skill to replace it.`, yellow);
    } else {
      line("✓", `${SKILL_NAME} ${skill.version} ${skill.status === "installed" ? "installed" : "is current"}`);
    }
  } else {
    line("–", "Skill installation skipped", dim);
  }

  const ignored = ensureTaskerLogsIgnored(repository);
  line("✓", ignored.changed ? "Added /.tasker/logs/ to .gitignore" : "/.tasker/logs/ is already ignored");

  if (options.register) {
    queueProjectRegistration({ repositoryPath: repository, projectName, baseBranch });
    line("✓", "Project registration queued for the local AgentTasker app");
  } else {
    line("–", "Local app registration skipped", dim);
  }

  console.log();
  console.log(green("Ready."), "Open or refresh AgentTasker; the project will appear automatically.");
}

function sequenceSync(options) {
  const repository = repositoryRoot(options.repository);
  const database = options.database ? path.resolve(options.database) : process.env.DATABASE_PATH || path.join(appRoot, "agenttasker.db");
  if (!fs.existsSync(database)) {
    throw new Error(`Local AgentTasker database not found: ${database}. Pass --database <path> or set DATABASE_PATH.`);
  }
  const script = path.join(appRoot, "scripts", "sequence-sync.ts");
  const args = ["--import", "tsx", script, "--repository", repository];
  if (options.all) args.push("--all");
  else args.push("--id", options.sequenceId);
  if (options.dryRun) args.push("--dry-run");
  const result = spawnSync(process.execPath, args, {
    cwd: appRoot,
    encoding: "utf8",
    windowsHide: true,
    env: { ...gitEnvironment(), DATABASE_PATH: database },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) throw new Error((result.stderr || "Sequence checkpoint migration failed.").trim());
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) usage();
  else if (options.command === "sequence-sync") sequenceSync(options);
  else await init(options);
} catch (error) {
  console.error(`\n${paint("31", "AgentTasker command failed:")} ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

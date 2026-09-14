#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SKILL_RELATIVE_PATH,
  assertNoSymlinkPath,
  assertSkillDirectory,
  gitRoot,
  gitStatus,
  readVersion,
  replaceDirectory,
  runGit,
  treeDigest,
} from "./sync-lib.mjs";

const DEFAULT_REPOSITORY = "https://github.com/cmpdev23/Tasker.git";
const DEFAULT_REF = "main";

function usage() {
  console.log("Usage: node update-from-git.mjs [--apply] [--force] [--repo <git-url>] [--ref <git-ref>]\n\nWithout --apply, checks whether a newer/different canonical skill is available.\n--apply replaces the local skill after a successful fetch.\n--force permits replacement when the local skill has uncommitted changes.");
}

function argumentsFrom(argv) {
  const options = { apply: false, force: false, repo: DEFAULT_REPOSITORY, ref: DEFAULT_REF };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") options.apply = true;
    else if (value === "--force") options.force = true;
    else if (value === "--repo") options.repo = argv[++index] ?? "";
    else if (value === "--ref") options.ref = argv[++index] ?? "";
    else if (value === "--help" || value === "-h") return { help: true };
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.repo || !options.ref) throw new Error("--repo and --ref cannot be empty.");
  if (options.force && !options.apply) throw new Error("--force is only meaningful with --apply.");
  return options;
}

let temporary = "";

function main() {
  const options = argumentsFrom(process.argv.slice(2));
  if (options.help) {
    usage();
    return 0;
  }

  const current = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assertSkillDirectory(current);
  const repository = gitRoot(current);
  const expected = path.join(repository, SKILL_RELATIVE_PATH);
  if (path.resolve(current) !== path.resolve(expected)) {
    throw new Error(`This updater is for a repository-local skill at ${expected}.`);
  }
  assertNoSymlinkPath(repository, [".agents", "skills", path.basename(current)]);

  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "agenttasker-skill-"));
  const checkout = path.join(temporary, "source");
  runGit(["-c", "core.autocrlf=false", "clone", "--depth", "1", "--branch", options.ref, "--filter=blob:none", options.repo, checkout]);
  const canonical = path.join(checkout, SKILL_RELATIVE_PATH);
  assertSkillDirectory(canonical);

  const localVersion = readVersion(current);
  const remoteVersion = readVersion(canonical);
  if (treeDigest(current) === treeDigest(canonical)) {
    console.log(`AgentTasker skill ${localVersion} is current (${options.ref}).`);
    return 0;
  }

  console.log(`AgentTasker skill differs: local ${localVersion}, source ${remoteVersion} (${options.ref}).`);
  if (!options.apply) {
    console.log("Run again with --apply to install the fetched version.");
    return 2;
  }

  const dirty = gitStatus(repository, SKILL_RELATIVE_PATH);
  if (dirty && !options.force) {
    throw new Error(`The local skill has uncommitted changes:\n${dirty}\nCommit or restore them, or rerun with --apply --force.`);
  }
  replaceDirectory(canonical, current);
  console.log(`Updated AgentTasker skill to ${remoteVersion}. Review git diff before committing.`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`AgentTasker skill update failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (temporary && fs.existsSync(temporary)) {
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

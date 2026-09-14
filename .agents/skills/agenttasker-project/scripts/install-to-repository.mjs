#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SKILL_NAME,
  SKILL_RELATIVE_PATH,
  assertNoSymlinkPath,
  assertSkillDirectory,
  gitRoot,
  readVersion,
  replaceDirectory,
  treeDigest,
} from "./sync-lib.mjs";

function usage() {
  console.log(`Usage: node install-to-repository.mjs --target <repository> [--force]\n\nInstalls ${SKILL_NAME} into <repository>/${SKILL_RELATIVE_PATH}.`);
}

function argumentsFrom(argv) {
  const options = { target: "", force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--target") options.target = argv[++index] ?? "";
    else if (value === "--force") options.force = true;
    else if (value === "--help" || value === "-h") return { help: true };
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.target) throw new Error("--target is required.");
  return options;
}

try {
  const options = argumentsFrom(process.argv.slice(2));
  if (options.help) {
    usage();
    process.exit(0);
  }

  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assertSkillDirectory(source);
  const requestedTarget = path.resolve(options.target);
  const repository = gitRoot(requestedTarget);
  if (fs.realpathSync(requestedTarget) !== fs.realpathSync(repository)) {
    throw new Error(`--target must be the Git repository root: ${repository}`);
  }
  assertNoSymlinkPath(repository, [".agents", "skills", SKILL_NAME]);
  const destination = path.join(repository, SKILL_RELATIVE_PATH);

  if (path.resolve(source) === path.resolve(destination)) {
    console.log(`${SKILL_NAME} is already the canonical skill in this repository.`);
    process.exit(0);
  }
  if (fs.existsSync(destination)) {
    if (treeDigest(source) === treeDigest(destination)) {
      console.log(`${SKILL_NAME} ${readVersion(source)} is already installed and current.`);
      process.exit(0);
    }
    if (!options.force) {
      throw new Error(`A different skill already exists at ${destination}. Review it, then rerun with --force to replace it.`);
    }
  }

  replaceDirectory(source, destination);
  console.log(`Installed ${SKILL_NAME} ${readVersion(source)} at ${destination}`);
  console.log(`Review and commit ${SKILL_RELATIVE_PATH} in the target repository.`);
} catch (error) {
  console.error(`AgentTasker skill installation failed: ${error instanceof Error ? error.message : String(error)}`);
  usage();
  process.exit(1);
}

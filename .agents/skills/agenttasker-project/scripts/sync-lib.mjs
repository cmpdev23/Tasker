import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

export const SKILL_NAME = "agenttasker-project";
export const SKILL_RELATIVE_PATH = path.join(".agents", "skills", SKILL_NAME);

function entries(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function assertDirectory(directory, label) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`${label} is not a directory: ${directory}`);
  }
}

export function assertSkillDirectory(directory) {
  assertDirectory(directory, "Skill source");
  const skillFile = path.join(directory, "SKILL.md");
  if (!fs.existsSync(skillFile) || !fs.statSync(skillFile).isFile()) {
    throw new Error(`Missing SKILL.md in ${directory}`);
  }
}

export function assertNoSymlinkPath(root, relativeParts) {
  let current = root;
  for (const part of relativeParts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to write through symbolic link: ${current}`);
    }
  }
}

export function treeDigest(directory) {
  assertSkillDirectory(directory);
  const hash = crypto.createHash("sha256");
  const visit = (current, prefix) => {
    for (const entry of entries(current)) {
      const relative = path.posix.join(prefix, entry.name);
      hash.update(`${entry.isDirectory() ? "d" : "f"}:${relative}\0`);
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Skill directories may not contain symbolic links: ${fullPath}`);
      }
      if (entry.isDirectory()) visit(fullPath, relative);
      else if (entry.isFile()) hash.update(fs.readFileSync(fullPath));
      else throw new Error(`Unsupported skill entry: ${fullPath}`);
    }
  };
  visit(directory, "");
  return hash.digest("hex");
}

export function readVersion(directory) {
  const versionPath = path.join(directory, "VERSION");
  return fs.existsSync(versionPath) ? fs.readFileSync(versionPath, "utf8").trim() : "unknown";
}

export function gitRoot(directory) {
  const result = spawnSync("git", ["-C", directory, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Target must be inside a Git repository: ${(result.stderr || "git rev-parse failed").trim()}`);
  }
  return path.resolve(result.stdout.trim());
}

export function gitStatus(repository, relativePath) {
  const result = spawnSync("git", ["-C", repository, "status", "--porcelain", "--", relativePath], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || "git status failed").trim());
  }
  return result.stdout.trim();
}

export function replaceDirectory(source, destination) {
  assertSkillDirectory(source);
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true });
  const nonce = `${process.pid}-${Date.now()}`;
  const staged = path.join(parent, `.${SKILL_NAME}.stage-${nonce}`);
  const backup = path.join(parent, `.${SKILL_NAME}.backup-${nonce}`);
  fs.cpSync(source, staged, { recursive: true, errorOnExist: true, force: false });
  let movedExisting = false;
  try {
    if (fs.existsSync(destination)) {
      fs.renameSync(destination, backup);
      movedExisting = true;
    }
    fs.renameSync(staged, destination);
    if (movedExisting) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(destination) && movedExisting && fs.existsSync(backup)) {
      fs.renameSync(backup, destination);
    }
    throw error;
  } finally {
    if (fs.existsSync(staged)) fs.rmSync(staged, { recursive: true, force: true });
  }
}

export function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(detail || `git ${args[0]} failed with exit code ${result.status}`);
  }
  return result;
}

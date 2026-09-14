import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PROJECT_REGISTRATION_VERSION = 1;

export function agentTaskerDataDirectory(options = {}) {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? os.homedir();
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA?.trim();
    return path.join(localAppData || path.join(homeDirectory, "AppData", "Local"), "AgentTasker");
  }
  if (platform === "darwin") {
    return path.join(homeDirectory, "Library", "Application Support", "AgentTasker");
  }
  const xdgDataHome = environment.XDG_DATA_HOME?.trim();
  return path.join(xdgDataHome || path.join(homeDirectory, ".local", "share"), "agenttasker");
}

export function projectRegistrationDirectory(options = {}) {
  return path.join(agentTaskerDataDirectory(options), "project-registrations");
}

export function queueProjectRegistration(input, options = {}) {
  if (!input || typeof input !== "object") throw new Error("Project registration is required.");
  const repositoryPath = fs.realpathSync(path.resolve(String(input.repositoryPath || "")));
  const projectName = String(input.projectName || "").trim();
  const baseBranch = String(input.baseBranch || "").trim();
  if (!fs.statSync(repositoryPath).isDirectory()) throw new Error("Repository path must be a directory.");
  if (!projectName) throw new Error("Project name is required.");
  if (!baseBranch) throw new Error("Base branch is required.");

  const directory = projectRegistrationDirectory(options);
  fs.mkdirSync(directory, { recursive: true });
  const identity = process.platform === "win32" ? repositoryPath.toLowerCase() : repositoryPath;
  const fileName = `${crypto.createHash("sha256").update(identity).digest("hex")}.json`;
  const target = path.join(directory, fileName);
  const temporary = path.join(directory, `.${fileName}.${process.pid}.${Date.now()}.tmp`);
  const payload = `${JSON.stringify({
    version: PROJECT_REGISTRATION_VERSION,
    repositoryPath,
    projectName,
    baseBranch,
    requestedAt: new Date().toISOString(),
  }, null, 2)}\n`;

  try {
    fs.writeFileSync(temporary, payload, { encoding: "utf8", flag: "wx" });
    if (fs.existsSync(target)) fs.unlinkSync(target);
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return target;
}

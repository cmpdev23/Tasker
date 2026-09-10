import fs from "node:fs";
import path from "node:path";

/** Shared by model discovery and executions; never launch a .cmd shim via a shell. */
export function resolveCodexExecutable(): string {
  if (process.platform !== "win32") return "codex";
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return "codex";
  const directory = path.join(localAppData, "OpenAI", "Codex", "bin");
  if (!fs.existsSync(directory)) return "codex";
  const direct = path.join(directory, "codex.exe");
  if (fs.existsSync(direct)) return direct;
  const candidates = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name, "codex.exe"))
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => ({ candidate, modifiedAt: fs.statSync(candidate).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  return candidates[0]?.candidate ?? "codex";
}

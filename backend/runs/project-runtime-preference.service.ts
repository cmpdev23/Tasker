import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { projectRuntimePreferences } from "../../db/schema";
import { ValidationError } from "../errors";
import type { ProjectLocalExecutionSettings } from "../../src/types/project-execution";

export function normalizePythonExecutablePreference(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError("The local Python executable must be an absolute file path or empty for auto-detection.");
  }
  const requested = value.trim();
  if (!path.isAbsolute(requested)) {
    throw new ValidationError("The local Python executable path must be absolute.");
  }
  let resolved: string;
  try {
    resolved = fs.realpathSync(path.resolve(requested));
    if (!fs.statSync(resolved).isFile()) throw new Error("not a file");
  } catch {
    throw new ValidationError("The selected local Python executable does not exist or is not a file.");
  }
  return resolved;
}

export class ProjectRuntimePreferenceService {
  async get(projectId: string): Promise<ProjectLocalExecutionSettings> {
    const preference = db.select().from(projectRuntimePreferences)
      .where(eq(projectRuntimePreferences.projectId, projectId)).get();
    return { pythonExecutable: preference?.pythonExecutable ?? null };
  }

  async set(projectId: string, pythonExecutable: string | null): Promise<ProjectLocalExecutionSettings> {
    const normalized = normalizePythonExecutablePreference(pythonExecutable);
    if (normalized === null) {
      db.delete(projectRuntimePreferences).where(eq(projectRuntimePreferences.projectId, projectId)).run();
      return { pythonExecutable: null };
    }
    db.insert(projectRuntimePreferences).values({
      projectId,
      pythonExecutable: normalized,
      updatedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: projectRuntimePreferences.projectId,
      set: { pythonExecutable: normalized, updatedAt: new Date().toISOString() },
    }).run();
    return { pythonExecutable: normalized };
  }
}

export const projectRuntimePreferenceService = new ProjectRuntimePreferenceService();

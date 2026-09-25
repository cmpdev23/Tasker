import type { ProjectLocalExecutionSettings } from "@/types/project-execution";

export interface EnvironmentVariableDraft {
  id: string;
  name: string;
  value: string;
  configured: boolean;
}

export function environmentDraft(entries: ProjectLocalExecutionSettings["environmentVariables"] = []): EnvironmentVariableDraft[] {
  return entries.map(entry => ({ id: crypto.randomUUID(), name: entry.name, value: "", configured: entry.configured }));
}

export function environmentPayload(entries: EnvironmentVariableDraft[]) {
  return entries.map(entry => ({ name: entry.name, ...(!entry.configured || entry.value !== "" ? { value: entry.value } : {}) }));
}

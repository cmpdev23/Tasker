import type { TaskDefinition } from "@/types/tasks";

export function requireTask(task: TaskDefinition | undefined): TaskDefinition {
  if (!task?.id || typeof task.name !== "string" || typeof task.instructions !== "string" ||
      typeof task.enabled !== "boolean" || typeof task.expectChanges !== "boolean" ||
      !["manual", "once", "hourly", "daily", "weekly"].includes(task.schedule?.type) ||
      typeof task.schedule?.timezone !== "string") {
    throw new Error("Réponse de la tâche invalide. Vérifiez la liste avant de réessayer.");
  }
  return task;
}

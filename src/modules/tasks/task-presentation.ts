import type { Run } from "@db/schema";
import type { TaskDefinition } from "@/types/tasks";

export function taskState(task: Pick<TaskDefinition, "enabled">, last: Pick<Run, "status"> | undefined) {
  switch (last?.status) {
    case "QUEUED":
      return {
        label: "Waiting",
        dotClass: "bg-warning",
        title: "Run en attente dans la file.",
      };
    case "PREPARING":
      return {
        label: "Preparing",
        dotClass: "bg-info",
        title: "Préparation du worktree et des dépendances.",
      };
    case "RUNNING":
      return {
        label: "Running",
        dotClass: "bg-info",
        title: "Codex exécute la tâche.",
      };
    case "VALIDATING":
      return {
        label: "Validating",
        dotClass: "bg-info",
        title: "Les validations du projet sont en cours.",
      };
    case "CLEANING_UP":
      return {
        label: "Cleaning",
        dotClass: "bg-info",
        title: "Finalisation de l’exécution en cours.",
      };
  }
  if (!task.enabled)
    return {
      label: "Disabled",
      dotClass: "bg-muted-foreground",
      title: "La tâche est désactivée.",
    };
  switch (last?.status) {
    case "SUCCESS":
      return {
        label: "Ready",
        dotClass: "bg-success",
        title: "La dernière exécution a réussi.",
      };
    case "FAILED":
      return {
        label: "Failed",
        dotClass: "bg-destructive",
        title: "La dernière exécution a échoué.",
      };
    case "CANCELLED":
      return {
        label: "Cancelled",
        dotClass: "bg-muted-foreground",
        title: "La dernière exécution a été annulée.",
      };
    default:
      return {
        label: "Pending",
        dotClass: "bg-warning",
        title: "La tâche n’a pas encore été exécutée.",
      };
  }
}

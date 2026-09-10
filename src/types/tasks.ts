export interface TaskDefinition {
  id: string;
  name: string;
  enabled: boolean;
  /** Markdown content, never a filesystem path. */
  instructions: string;
  expectChanges: boolean;
  schedule: {
    type: "manual" | "once" | "daily" | "weekly";
    timezone: string;
    time?: string;
    days?: string[];
    /** ISO 8601 instant with Z or an explicit UTC offset. */
    startsAt?: string;
  };
}

/** Full replacement for create/update; the service owns the immutable ID. */
export type TaskInput = Omit<TaskDefinition, "id">;

export const TASK_WEEKDAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;

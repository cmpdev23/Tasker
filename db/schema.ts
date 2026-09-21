import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  repositoryPath: text("repository_path"),
  defaultBranch: text("default_branch"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export const projectRuntimePreferences = sqliteTable("project_runtime_preferences", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  pythonExecutable: text("python_executable"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export type ProjectRuntimePreference = typeof projectRuntimePreferences.$inferSelect;

export const projectEnvironmentVariables = sqliteTable("project_environment_variables", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
}, (table) => [primaryKey({ columns: [table.projectId, table.name] })]);

export type ProjectEnvironmentVariable = typeof projectEnvironmentVariables.$inferSelect;

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("TASK"),
  taskId: text("task_id").notNull(),
  taskName: text("task_name").notNull(),
  sequenceId: text("sequence_id"),
  currentStepId: text("current_step_id"),
  status: text("status").notNull(),
  scheduledAt: text("scheduled_at"),
  queuedAt: text("queued_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  baseRemote: text("base_remote"),
  baseBranch: text("base_branch"),
  baseCommit: text("base_commit"),
  runBranch: text("run_branch"),
  worktreePath: text("worktree_path"),
  codexPid: integer("codex_pid"),
  terminationVerified: integer("termination_verified", { mode: "boolean" }).notNull().default(true),
  exitCode: integer("exit_code"),
  error: text("error"),
  result: text("result"),
  commitHash: text("commit_hash"),
  pushedAt: text("pushed_at"),
  pullRequestUrl: text("pull_request_url"),
  diff: text("diff"),
  resolvedConfig: text("resolved_config"),
  cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (table) => [index("runs_project_created").on(table.projectId, table.createdAt),
  uniqueIndex("runs_schedule_occurrence").on(table.projectId, table.taskId, table.scheduledAt)]);

export const runEvents = sqliteTable("run_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  timestamp: text("timestamp").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  rawPayload: text("raw_payload"),
}, (table) => [index("run_events_cursor").on(table.runId, table.id)]);

export const sequenceStepRuns = sqliteTable("sequence_step_runs", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  sequenceId: text("sequence_id").notNull(),
  stepId: text("step_id").notNull(),
  stepName: text("step_name").notNull(),
  position: integer("position").notNull(),
  status: text("status").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  exitCode: integer("exit_code"),
  error: text("error"),
  result: text("result"),
  commitHash: text("commit_hash"),
  publicationBranch: text("publication_branch"),
  pushedAt: text("pushed_at"),
  pullRequestUrl: text("pull_request_url"),
  diff: text("diff"),
}, (table) => [
  index("sequence_step_runs_run_position").on(table.runId, table.position),
  uniqueIndex("sequence_step_runs_identity").on(table.runId, table.stepId),
]);

export const schedulerState = sqliteTable("scheduler_state", {
  key: text("key").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  evaluatedAt: text("evaluated_at").notNull(),
});

export const runnerLock = sqliteTable("runner_lock", {
  id: integer("id").primaryKey(),
  ownerPid: integer("owner_pid").notNull(),
  token: text("token").notNull(),
});

export type Run = typeof runs.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;
export type SequenceStepRun = typeof sequenceStepRuns.$inferSelect;

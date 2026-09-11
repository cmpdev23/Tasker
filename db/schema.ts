import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull(),
  taskName: text("task_name").notNull(),
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

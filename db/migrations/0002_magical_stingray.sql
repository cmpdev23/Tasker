CREATE TABLE `run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`raw_payload` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_events_cursor` ON `run_events` (`run_id`,`id`);--> statement-breakpoint
CREATE TABLE `runner_lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner_pid` integer NOT NULL,
	`token` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`task_name` text NOT NULL,
	`status` text NOT NULL,
	`scheduled_at` text,
	`queued_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`base_remote` text,
	`base_branch` text,
	`base_commit` text,
	`run_branch` text,
	`worktree_path` text,
	`codex_pid` integer,
`termination_verified` integer DEFAULT true NOT NULL,
	`exit_code` integer,
	`error` text,
	`result` text,
	`commit_hash` text,
	`diff` text,
	`resolved_config` text,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_project_created` ON `runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `runs_schedule_occurrence` ON `runs` (`project_id`,`task_id`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `scheduler_state` (
	`key` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`evaluated_at` text NOT NULL
);

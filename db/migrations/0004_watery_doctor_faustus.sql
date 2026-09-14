CREATE TABLE `sequence_step_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`sequence_id` text NOT NULL,
	`step_id` text NOT NULL,
	`step_name` text NOT NULL,
	`position` integer NOT NULL,
	`status` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`exit_code` integer,
	`error` text,
	`result` text,
	`commit_hash` text,
	`diff` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sequence_step_runs_run_position` ON `sequence_step_runs` (`run_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `sequence_step_runs_identity` ON `sequence_step_runs` (`run_id`,`step_id`);--> statement-breakpoint
ALTER TABLE `runs` ADD `kind` text DEFAULT 'TASK' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `sequence_id` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `current_step_id` text;
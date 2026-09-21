ALTER TABLE `runs` ADD `resume_from_run_id` text REFERENCES runs(id);
--> statement-breakpoint
ALTER TABLE `runs` ADD `resume_stage` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD `resume_step_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_resume_source` ON `runs` (`resume_from_run_id`);

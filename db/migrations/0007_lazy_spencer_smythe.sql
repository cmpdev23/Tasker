CREATE TABLE `project_runtime_preferences` (
	`project_id` text PRIMARY KEY NOT NULL,
	`python_executable` text,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);

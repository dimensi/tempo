ALTER TABLE `workout_videos` ADD `name` text;--> statement-breakpoint
ALTER TABLE `workout_videos` ADD `recorded_at` integer;--> statement-breakpoint
ALTER TABLE `workout_videos` ADD `playback_size` integer;--> statement-breakpoint
ALTER TABLE `workout_videos` ADD `processing_progress` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workout_videos` ADD `processing_error` text;
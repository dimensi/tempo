CREATE TABLE `yazio_sync_progress` (
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`food` integer DEFAULT false NOT NULL,
	`photos` integer DEFAULT false NOT NULL,
	`steps` integer DEFAULT false NOT NULL,
	`weight` integer DEFAULT false NOT NULL,
	`body` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`owner_id`, `date`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO yazio_sync_progress (owner_id, date, food, photos, steps, weight, body)
SELECT owner_id, date, 1, 1, 1, 1, 1 FROM nutrition_days;
--> statement-breakpoint
UPDATE yazio_sync_progress SET food = 0, photos = 0
WHERE EXISTS (
  SELECT 1 FROM nutrition_sync_runs r, json_each(r.status, '$.failedDates') d
  WHERE r.owner_id = yazio_sync_progress.owner_id AND d.value = yazio_sync_progress.date
);
--> statement-breakpoint
UPDATE yazio_sync_progress SET photos = 0
WHERE EXISTS (
  SELECT 1 FROM nutrition_sync_runs r, json_each(r.status, '$.photoFailedDates') d
  WHERE r.owner_id = yazio_sync_progress.owner_id AND d.value = yazio_sync_progress.date
);
--> statement-breakpoint
UPDATE nutrition_sync_runs SET status = json_set(status, '$.skippedDates', json('[]'));
--> statement-breakpoint
UPDATE nutrition_schedule SET next_run_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 + 14400000
WHERE enabled = 1;

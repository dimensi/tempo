CREATE TABLE `offline_write_receipts` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result` text NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `medical_document_grants` (
	`owner_id` text NOT NULL,
	`trainer_id` text NOT NULL,
	`document_id` text NOT NULL,
	`granted_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `trainer_id`, `document_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trainer_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `medical_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `medical_document_grants_trainer_idx` ON `medical_document_grants` (`trainer_id`);--> statement-breakpoint
CREATE TABLE `medical_document_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`page_number` integer NOT NULL,
	`width` real,
	`height` real,
	`has_text_layer` integer NOT NULL,
	`text_json` text NOT NULL,
	`ocr_applied` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `medical_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medical_document_pages_page_uq` ON `medical_document_pages` (`document_id`,`page_number`);--> statement-breakpoint
CREATE TABLE `medical_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`filename` text NOT NULL,
	`storage_key` text NOT NULL,
	`sha256` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`page_count` integer NOT NULL,
	`laboratory_name` text,
	`title` text,
	`collected_at` text,
	`issued_at` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medical_documents_owner_sha_uq` ON `medical_documents` (`owner_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `medical_documents_owner_idx` ON `medical_documents` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `medical_import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`document_id` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`lease_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `medical_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `medical_import_jobs_owner_idx` ON `medical_import_jobs` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `medical_import_jobs_status_idx` ON `medical_import_jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `medical_marker_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`marker_id` text NOT NULL,
	`alias` text NOT NULL,
	FOREIGN KEY (`marker_id`) REFERENCES `medical_markers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medical_marker_aliases_alias_uq` ON `medical_marker_aliases` (`alias`);--> statement-breakpoint
CREATE TABLE `medical_marker_grants` (
	`owner_id` text NOT NULL,
	`trainer_id` text NOT NULL,
	`marker_id` text NOT NULL,
	`granted_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `trainer_id`, `marker_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trainer_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`marker_id`) REFERENCES `medical_markers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `medical_marker_grants_trainer_idx` ON `medical_marker_grants` (`trainer_id`);--> statement-breakpoint
CREATE TABLE `medical_markers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`short_name` text,
	`category` text NOT NULL,
	`description` text,
	`preferred_unit` text,
	`definition_version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medical_markers_code_unique` ON `medical_markers` (`code`);--> statement-breakpoint
CREATE TABLE `medical_observation_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`changed_by` text NOT NULL,
	`reason` text NOT NULL,
	`changes_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`observation_id`) REFERENCES `medical_observations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `medical_observation_revisions_observation_idx` ON `medical_observation_revisions` (`observation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `medical_observation_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`observation_id` text NOT NULL,
	`document_id` text NOT NULL,
	`page_number` integer NOT NULL,
	`source_kind` text NOT NULL,
	`raw_text` text NOT NULL,
	`bounding_box_json` text,
	`extraction_confidence` real,
	FOREIGN KEY (`observation_id`) REFERENCES `medical_observations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `medical_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medical_observation_sources_uq` ON `medical_observation_sources` (`observation_id`,`document_id`,`page_number`,`source_kind`);--> statement-breakpoint
CREATE INDEX `medical_observation_sources_document_idx` ON `medical_observation_sources` (`document_id`);--> statement-breakpoint
CREATE TABLE `medical_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`marker_id` text,
	`original_name` text NOT NULL,
	`value_json` text NOT NULL,
	`original_unit` text,
	`normalized_value` text,
	`normalized_unit` text,
	`collected_at` text,
	`date_precision` text NOT NULL,
	`laboratory_name` text,
	`reference_json` text,
	`reference_assessment` text NOT NULL,
	`verification` text NOT NULL,
	`extraction_version` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`marker_id`) REFERENCES `medical_markers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `medical_observations_owner_marker_idx` ON `medical_observations` (`owner_id`,`marker_id`,`collected_at`);--> statement-breakpoint
CREATE INDEX `medical_observations_owner_updated_idx` ON `medical_observations` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `medical_report_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_by` text NOT NULL,
	`marker_ids_json` text NOT NULL,
	`date_from` text,
	`date_to` text,
	`status` text NOT NULL,
	`storage_key` text,
	`filename` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `medical_report_exports_owner_idx` ON `medical_report_exports` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `medical_review_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`document_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`observation_id`) REFERENCES `medical_observations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `medical_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `medical_review_items_owner_status_idx` ON `medical_review_items` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `medical_review_items_observation_idx` ON `medical_review_items` (`observation_id`);
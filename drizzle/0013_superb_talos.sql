ALTER TABLE `medical_report_exports` ADD `date_keys_json` text;--> statement-breakpoint
ALTER TABLE `medical_report_exports` ADD `historical_period_json` text;
--> statement-breakpoint
UPDATE medical_report_exports SET historical_period_json = json_object('from', date_from, 'to', date_to);

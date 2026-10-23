ALTER TABLE `trainer_access` ADD `anamnesis_access` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE `trainer_access`
SET `anamnesis_access` = 1
WHERE EXISTS (
  SELECT 1 FROM `medical_marker_grants`
  WHERE `medical_marker_grants`.`owner_id` = `trainer_access`.`owner_id`
    AND `medical_marker_grants`.`trainer_id` = `trainer_access`.`trainer_id`
) OR EXISTS (
  SELECT 1 FROM `medical_document_grants`
  WHERE `medical_document_grants`.`owner_id` = `trainer_access`.`owner_id`
    AND `medical_document_grants`.`trainer_id` = `trainer_access`.`trainer_id`
);
--> statement-breakpoint
DROP TABLE `medical_document_grants`;
--> statement-breakpoint
DROP TABLE `medical_marker_grants`;

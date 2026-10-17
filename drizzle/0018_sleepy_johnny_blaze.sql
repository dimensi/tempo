-- Preserve existing queue failures without inventing HTTP status or an unknown stage.
-- A single unfinished media stage identifies that stage; ambiguous failures remain job-level.
UPDATE transformmate_replica_jobs
SET data = json_set(data, '$.failures', json_object(
  CASE WHEN error IN ('invalid_media','limit') THEN
    CASE
      WHEN coalesce(json_extract(data,'$.imageAt'),0)=0 AND coalesce(json_extract(data,'$.videoAt'),0)>0 AND coalesce(json_extract(data,'$.posterAt'),0)>0 THEN 'image'
      WHEN coalesce(json_extract(data,'$.imageAt'),0)>0 AND coalesce(json_extract(data,'$.videoAt'),0)=0 AND coalesce(json_extract(data,'$.posterAt'),0)>0 THEN 'video'
      WHEN coalesce(json_extract(data,'$.imageAt'),0)>0 AND coalesce(json_extract(data,'$.videoAt'),0)>0 AND coalesce(json_extract(data,'$.posterAt'),0)=0 THEN 'poster'
      ELSE 'job'
    END
  ELSE 'job' END,
  json_object('reason', error, 'httpStatus', NULL)
)) WHERE error IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `transformmate_replica_jobs` DROP COLUMN `error`;
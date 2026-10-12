UPDATE nutrition_sync_runs
SET status = json_set(status, '$.photoFailedDates', json('[]'))
WHERE json_valid(status) AND json_type(status, '$.photoFailedDates') IS NULL;

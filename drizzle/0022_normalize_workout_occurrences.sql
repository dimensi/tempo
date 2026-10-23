-- Older plans allowed duplicate exercise IDs, and sessions allowed duplicate
-- provider occurrence keys. Preserve the first identity and every exercise;
-- only later collisions receive a fresh identity. Session exercise IDs (and
-- therefore personal-video references) were already unique and stay intact.
WITH original AS (
  SELECT w.id AS workout_id, CAST(e.key AS integer) AS position, e.value,
    json_extract(e.value, '$.transformMate.occurrenceKey') AS occurrence_key,
    row_number() OVER (
      PARTITION BY w.id, json_extract(e.value, '$.id')
      ORDER BY CAST(e.key AS integer)
    ) AS id_rank,
    row_number() OVER (
      PARTITION BY w.id, json_extract(e.value, '$.transformMate.occurrenceKey')
      ORDER BY CAST(e.key AS integer)
    ) AS key_rank
  FROM workouts w, json_each(w.data, '$.exercises') e
), repaired_ids AS (
  SELECT workout_id, position, occurrence_key, key_rank,
    CASE WHEN id_rank > 1 THEN json_set(value, '$.id',
      lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))))
    ELSE value END AS value
  FROM original
), repaired AS (
  SELECT workout_id, position,
    CASE WHEN occurrence_key IS NOT NULL AND key_rank > 1 THEN
      json_set(value, '$.transformMate.occurrenceKey',
        lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))))
    ELSE value END AS value
  FROM repaired_ids
)
UPDATE workouts SET data = json_set(data, '$.exercises', json((
  SELECT json_group_array(json(value)) FROM (
    SELECT value FROM repaired WHERE workout_id = workouts.id ORDER BY position
  )
))), revision = revision + 1
WHERE id IN (
  SELECT workout_id FROM original
  WHERE id_rank > 1 OR (occurrence_key IS NOT NULL AND key_rank > 1)
);

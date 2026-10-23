CREATE TABLE workouts (
 id text PRIMARY KEY NOT NULL,
 owner_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 data text NOT NULL,
 date text NOT NULL,
 revision integer DEFAULT 1 NOT NULL,
 created_at text NOT NULL,
 updated_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX workouts_owner_date_idx ON workouts(owner_id,date);
--> statement-breakpoint
-- Old nested IDs were unique only within a plan. Keep them when safe; preserve every session ID.
CREATE TEMP TABLE workout_id_map AS
SELECT p.owner_id,p.id AS old_plan_id,json_extract(w.value,'$.id') AS old_workout_id,
coalesce((SELECT s.id FROM workout_sessions s WHERE s.owner_id=p.owner_id AND json_extract(s.data,'$.planId')=p.id AND json_extract(s.data,'$.plannedWorkoutId')=json_extract(w.value,'$.id') ORDER BY s.created_at DESC,s.id DESC LIMIT 1),
 CASE WHEN (SELECT count(*) FROM workout_plans p2,json_each(p2.data,'$.workouts') w2 WHERE json_extract(w2.value,'$.id')=json_extract(w.value,'$.id'))>1
 OR EXISTS(SELECT 1 FROM workout_sessions s2 WHERE s2.id=json_extract(w.value,'$.id'))
 THEN lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))
 ELSE json_extract(w.value,'$.id') END) AS new_id
FROM workout_plans p,json_each(p.data,'$.workouts') w;
--> statement-breakpoint
INSERT INTO workouts
SELECT id,owner_id,json_object(
 'date',json_extract(data,'$.date'), 'title',coalesce(json_extract(data,'$.title'),''),
 'exercises',json(coalesce(json_extract(data,'$.exercises'),'[]')),
 'note',CASE WHEN json_extract(data,'$.status')='skipped' THEN
 trim(coalesce(json_extract(data,'$.note'),'') || char(10) || 'Была пропущена')
 ELSE coalesce(json_extract(data,'$.note'),'') END,
 'status',CASE WHEN json_extract(data,'$.status')='skipped' THEN 'planned' ELSE json_extract(data,'$.status') END
),date,revision,created_at,updated_at FROM workout_sessions;
--> statement-breakpoint
-- Preserve parent text even when the original parent plan has already been deleted.
UPDATE workouts SET data=json_set(data,'$.note',trim(
 CASE WHEN coalesce((SELECT coalesce(json_extract(s.data,'$.planSnapshot.planTitle'),json_extract(p.data,'$.title')) FROM workout_sessions s LEFT JOIN workout_plans p ON p.id=json_extract(s.data,'$.planId') AND p.owner_id=s.owner_id WHERE s.id=workouts.id),'')<>'' THEN
 'План: ' || (SELECT coalesce(json_extract(s.data,'$.planSnapshot.planTitle'),json_extract(p.data,'$.title')) FROM workout_sessions s LEFT JOIN workout_plans p ON p.id=json_extract(s.data,'$.planId') AND p.owner_id=s.owner_id WHERE s.id=workouts.id) || char(10) ELSE '' END ||
 coalesce((SELECT json_extract(p.data,'$.description') FROM workout_sessions s LEFT JOIN workout_plans p ON p.id=json_extract(s.data,'$.planId') AND p.owner_id=s.owner_id WHERE s.id=workouts.id),'') || char(10) || json_extract(data,'$.note')
)) WHERE EXISTS(SELECT 1 FROM workout_sessions s WHERE s.id=workouts.id AND (json_extract(s.data,'$.planId') IS NOT NULL OR json_extract(s.data,'$.planSnapshot.planTitle') IS NOT NULL));
--> statement-breakpoint
UPDATE workouts SET data=json_set(data,'$.legacySource',json((SELECT json_object('planId',json_extract(s.data,'$.planId'),'workoutId',json_extract(s.data,'$.plannedWorkoutId')) FROM workout_sessions s WHERE s.id=workouts.id)))
WHERE EXISTS(SELECT 1 FROM workout_sessions s WHERE s.id=workouts.id AND json_extract(s.data,'$.planId') IS NOT NULL AND json_extract(s.data,'$.plannedWorkoutId') IS NOT NULL);
--> statement-breakpoint
INSERT INTO workouts
SELECT m.new_id,p.owner_id,json_object(
 'date',json_extract(w.value,'$.date'),
 'title',CASE WHEN coalesce(json_extract(w.value,'$.title'),'')='' THEN coalesce(json_extract(p.data,'$.title'),'') ELSE json_extract(w.value,'$.title') END,
 'exercises',json(json_extract(w.value,'$.exercises')),
 'note',trim(CASE WHEN coalesce(json_extract(w.value,'$.title'),'')<>'' AND coalesce(json_extract(p.data,'$.title'),'')<>'' AND json_extract(w.value,'$.title')<>json_extract(p.data,'$.title') THEN 'План: '||json_extract(p.data,'$.title')||char(10) ELSE '' END||coalesce(json_extract(p.data,'$.description'),'')),
 'status','planned','legacySource',json_object('planId',p.id,'workoutId',json_extract(w.value,'$.id'))
),json_extract(w.value,'$.date'),p.revision,p.created_at,p.updated_at
FROM workout_plans p,json_each(p.data,'$.workouts') w JOIN workout_id_map m ON m.owner_id=p.owner_id AND m.old_plan_id=p.id AND m.old_workout_id=json_extract(w.value,'$.id')
WHERE NOT EXISTS (SELECT 1 FROM workout_sessions s WHERE s.owner_id=p.owner_id AND json_extract(s.data,'$.planId')=p.id AND json_extract(s.data,'$.plannedWorkoutId')=json_extract(w.value,'$.id'));
--> statement-breakpoint
UPDATE workouts SET data=json_set(data,'$.exercises',json(coalesce((SELECT json_group_array(json_set(e.value,'$.id',coalesce(json_extract(e.value,'$.id'),lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))))) FROM json_each(workouts.data,'$.exercises') e),'[]')));
--> statement-breakpoint
UPDATE workout_transformmate_links SET
 plan_id=coalesce((SELECT m.new_id FROM workout_id_map m WHERE m.owner_id=workout_transformmate_links.owner_id AND m.old_plan_id=workout_transformmate_links.plan_id AND m.old_workout_id=workout_transformmate_links.workout_id),plan_id),
 workout_id=coalesce((SELECT m.new_id FROM workout_id_map m WHERE m.owner_id=workout_transformmate_links.owner_id AND m.old_plan_id=workout_transformmate_links.plan_id AND m.old_workout_id=workout_transformmate_links.workout_id),workout_id);
--> statement-breakpoint
UPDATE workout_transformmate_links SET state=json_set(state,'$.workout.id',workout_id);
--> statement-breakpoint
UPDATE workout_transformmate_links SET state=json_set(state,'$.published.workout.id',workout_id) WHERE json_type(state,'$.published.workout')='object';
--> statement-breakpoint
UPDATE workout_transformmate_links SET state=json_set(state,'$.updateAttempt.previous.workout.id',workout_id,'$.updateAttempt.desired.workout.id',workout_id) WHERE json_type(state,'$.updateAttempt')='object';
--> statement-breakpoint
DROP TABLE workout_id_map;
--> statement-breakpoint
CREATE TABLE workout_videos_new (
 id text PRIMARY KEY NOT NULL, owner_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 workout_id text NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
 exercise_id text NOT NULL,size integer NOT NULL,duration integer NOT NULL,state text NOT NULL,
 parts text NOT NULL,created_at integer NOT NULL
);
--> statement-breakpoint
INSERT INTO workout_videos_new SELECT id,owner_id,session_id,exercise_id,size,duration,state,parts,created_at FROM workout_videos;
--> statement-breakpoint
DROP TABLE workout_videos;
--> statement-breakpoint
ALTER TABLE workout_videos_new RENAME TO workout_videos;
--> statement-breakpoint
CREATE INDEX workout_videos_workout_idx ON workout_videos(owner_id,workout_id);
--> statement-breakpoint
DROP TABLE workout_sessions;
--> statement-breakpoint
DROP TABLE workout_plans;

import 'server-only';
import { z } from 'zod';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const named = z.looseObject({ id, name: z.string() });
const image = z.string().nullable();
const muscleGroup = named.extend({ image });
const equipmentGroup = named.extend({ equipments: z.array(named) });

// Preserve the upstream URLs and resolution; do not fetch, sign or select media here.
export const transformMateExerciseVideoSchema = z.looseObject({
  id: z.string().nullable(),
  url: z.string().nullable(),
  resolution: z.string().nullable(),
  quality: z.string().optional(),
  filetype: z.string().optional(),
  video_id: z.string().optional(),
  file_size: z.number().int().nonnegative().optional(),
  created_at: z.iso.datetime({ offset: true }).optional(),
  download_link: z.string().nullable().optional(),
  original_name: z.string().optional(),
});
export const transformMateExerciseDetailSchema = z.looseObject({
  id,
  author: id.nullable(),
  name: z.string(),
  other_names: z.array(z.string()),
  description: z.string(),
  image,
  video_link: z.string().nullable(),
  youtube_link: z.string().nullable(),
  vimeo_link: z.string().nullable(), // May be only a Vimeo ID, not a URL.
  kinescope_data: z.array(transformMateExerciseVideoSchema).nullable(),
  exercise_type: named.nullable(),
  equipments: z.array(
    named.extend({
      equipment_group: equipmentGroup.nullable(),
      equipment_groups: z.array(equipmentGroup),
    }),
  ),
  muscles: z.array(
    z.looseObject({
      id,
      muscle: named.extend({ image, muscle_group: muscleGroup }),
      position: named.extend({ is_main: z.boolean() }).nullable(),
    }),
  ),
  muscle_groups_main_position: z.array(z.string()),
  restrictions: z.array(z.string()),
  warm_up: named.extend({ description: z.string() }).nullable(),
  metrics: z.array(
    named.extend({
      short_name: z.string(),
      key: z.string(),
      value_type: z.string(),
      set_metric_types: z.array(
        z.looseObject({
          name: z.string(),
          type: z.string(),
          key: z.string(),
          friendly_techniques: z.array(id),
        }),
      ),
    }),
  ),
  sports: z.array(
    named.extend({ sport_type: named.extend({ short_name: z.string() }) }),
  ),
  accents: z.array(named),
  favorite_id: id.nullable(),
  completed: z.boolean(),
  is_new: z.boolean(),
  is_updated: z.boolean(),
});

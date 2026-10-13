# TransformMate exercise detail and client headers

## Read API

`client.getExercise(exerciseId: number)` выполняет
`GET /exercises/{id}/` без query/body. ID должен быть положительным safe integer.
Возвращает `Promise<RawResponse<TransformMateExerciseDetail>>` после Zod validation.
Типы находятся в `src/server/transformmate/types.ts`, схемы — в `exercise-schema.ts`.
Клиент не выбирает видео и не скачивает медиа.

```ts
const { body: exercise } = await client.getExercise(exerciseId);
const variants = exercise.kinescope_data ?? [];
for (const video of variants) {
  // URL may be null; preserve upstream URLs including their query string.
  if (video.url) console.log(video.quality, video.resolution);
}
```

Detail включает имя, описание, изображение, альтернативные имена, тип упражнения,
оборудование/группы, мышцы/позиции, ограничения, разминку, спорт, акценты и метрики
(включая value_type/set_metric_types). В отличие от detail, сокращённый GET /exercises/
не содержит видео-полей. `client.listExercises()` валидирует сокращённый каталог
(`id`, `name`, `metrics[].id/key`) и ограничивает его 10 000 записями.
Редактор и защищённая доставка видео описаны в [интеграции](transformmate-integration.md).

| Video field         | Wire type              | Meaning                                       |
| ------------------- | ---------------------- | --------------------------------------------- |
| video_link          | string/null            | Additional source link                        |
| youtube_link        | string/null            | YouTube link used by the APK player           |
| vimeo_link          | string/null            | Can contain a Vimeo ID rather than a URL      |
| kinescope_data      | video[]/null           | Direct video variants                         |
| video.id            | string/null            | Provider variant ID, not numeric exercise ID  |
| video.url           | string/null            | Playback URL                                  |
| video.resolution    | string/null            | e.g. 1280x720                                 |
| video.quality       | optional string        | e.g. 720p                                     |
| video.filetype      | optional string        | Observed mp4                                  |
| video.video_id      | optional string        | May contain the all-zero UUID                 |
| video.file_size     | optional integer       | Upstream metadata, not verified download size |
| video.created_at    | optional ISO timestamp | Upstream creation time                        |
| video.download_link | optional string/null   | Separate download URL                         |
| video.original_name | optional string        | Upstream filename                             |

Empty/null media do not make the exercise invalid. Unknown extra response fields are
preserved. String URLs are not normalized or rewritten; Vimeo IDs are not treated as URLs.
Invalid responses throw TransformMateResponseError without payload values in the error.
HTTP errors/retry/redaction follow the common client behavior.

## Verification and APK playback

Read-only probes on 2026-10-12: exercise IDs 6, 21 and 48 returned HTTP 200, all with
four Kinescope MP4 variants (1080p/720p/480p/360p). Raw JSON remains in ignored .tmp.
For exercise 6, anonymous HEAD of the first playback URL returned 200 video/mp4.
HEAD on download_link returned 405; this does not establish whether GET download works.
Browser playback, CORS and physical phone playback have not been tested.

APK 2.1.7: PhysicalRepositoryImpl detail GET at 0xd69b58 maps full ExerciseEntity
at 0xd69bac. ViewExerciseScreenController.createPodController (0xbe8a08) selects
YouTube or Kinescope based on source settings and available data. It calls
PlayVideoFrom.youtube (0xbe8c34) or PlayVideoFrom.networkQualityUrls (0xbe8d54).
ViewExerciseScreen._PodPlayer constructs PodVideoPlayer (0x8cbc58): native Flutter
embedded playback, not a Kinescope iframe. There is no video UI integration in our app yet.

## Headers and application identity

APK Environment.createDioHeader (0xbec704) sets:

- user-agent: generated from application package info plus OS/device information;
- accept: application/json; version=1.3;
- accept-language: ru;
- optional idfa/adid advertising identifiers (empty values removed).

Environment.packageInfoInit (0xbf018c) constructs the app/device User-Agent.
Third-party Dio options (0xbeb9cc) use a separate browser-style User-Agent.
No separate app-version header was found in this common backend-header constructor.
Accept version=1.3 is API content negotiation, not Android app version 2.1.7.
Other SDK telemetry may exist; backend logging/analytics behavior has not been inspected.

Our backend requests now use:

```text
Authorization: JWT <Firebase ID token>
Accept: application/json; version=1.3
Accept-Language: ru
User-Agent: TransformMate/2.1.7 (Android 13) (2211133G)
Content-Type: application/json   # only requests with a JSON body
```

The configured preset uses the APK-style app/version/OS/model format with Xiaomi 13
(model 2211133G) and Android 13. It is a selected preset, not a capture from the user's
phone. No yazio-dashboard identity or idfa/adid advertising identifiers are sent.
Model reference: [Xiaomi 13 official guide](https://alsgp0.fds.api.xiaomi.com/gl123/XIAOMI/Xiaomi%2013/%E9%87%8F%E4%BA%A7/_M3_%E5%85%A5%E9%97%A8%E6%8C%87%E5%8D%97_%E8%8B%B1%E6%B3%B0%E7%89%88_A_20221206_TH%20EN.pdf).
Android 13 reference: [Xiaomi specifications](https://www.mi.com/pl/product/xiaomi-13/specs/).
The negotiation headers were accepted by the live API;
exercise 6 detail matched the previous response without explicit Accept/version headers.
Exercise detail and training list also passed runtime validation through the updated client.

The JWT already authenticates the account, so User-Agent is not an anonymity control.
Changing it does not guarantee that backend logs cannot distinguish this integration.
For private own-account use, imitating the official app version is not required by the
observed endpoints. This is a compatibility observation, not a guarantee about monitoring
or future API policy. Refresh requests to Firebase retain their existing independent headers.

[Client setup and writes](transformmate-write.md) · [Firebase auth/probes](transformmate-probe.md).

## Catalog filters and muscle groups

`listExercises(filters?: TransformMateExerciseFilters)` requests the full short catalog
from `GET /exercises/` and returns `RawResponse<TransformMateExerciseSummary[]>`.
`listExercisePage(input?: TransformMateExercisePageInput)` requests one page from
`GET /exercises/temporary_exercises/` and returns `RawResponse<TransformMateExercisePage>`:
`{ count, next, previous, results }`. Pagination links are data only: the client never
follows them or sends credentials to a URL from the response.

`listMuscleGroups()` requests `GET /exercises/muscle_groups/` and returns
`RawResponse<TransformMateMuscleGroup[]>`. Each group contains `id`, `name`, nullable
`image`, numeric `muscles[]` IDs, and `common_muscle_group: { id, name }`.
These are three different identifier collections; the exercise query uses **names**.

| Client input       | Query parameter     | Format                                  |
| ------------------ | ------------------- | --------------------------------------- |
| commonMuscleGroup  | common_muscle_group | One exact group name, e.g. Ноги         |
| muscleGroups       | muscle_group        | Exact subgroup names joined with commas |
| search             | search              | Plain search text, URL encoded          |
| limit (page only)  | limit               | Integer 1–50; server caps pages at 50   |
| offset (page only) | offset              | Nonnegative integer                     |

Numeric group IDs are not filter values: muscle_group=13 returns no results, while
muscle_group=Квадрицепс works. Use the names returned by the dictionary in the same locale.
Multiple muscle_group names form a union; common_muscle_group is exposed as a single
name because a comma-separated list of common groups did not work in the live probe.
Combining common_muscle_group and muscle_group narrows results using both conditions.
Unknown names can legitimately return an empty result. Empty arrays/search strings omit
the corresponding parameter. Commas inside individual names and unknown input properties
are rejected before HTTP; URLSearchParams encodes Cyrillic, spaces and query delimiters.

```ts
const { body: groups } = await client.listMuscleGroups();
const selected = groups.find((group) => group.name === 'Квадрицепс');
if (selected) {
  const { body: exercises } = await client.listExercises({
    muscleGroups: [selected.name],
  });
  const { body: page } = await client.listExercisePage({
    commonMuscleGroup: selected.common_muscle_group.name,
    muscleGroups: [selected.name],
    search: 'Разгибание',
    limit: 20,
    offset: 0,
  });
}
```

The short result projection has typed `id`, `name` and `metrics` (`id`, `key`), as used
by the catalog service. Use getExercise(id) for the full description, muscles and videos.
No UI or database filtering behavior is changed by these new client operations.

Read-only verification: 18 dictionary groups; quadriceps 169 results, hamstrings 66,
combined subgroups 212, common group Ноги 224. Search Разгибание with quadriceps returned
2; limit=2&offset=2 returned IDs 324/86, matching positions 3/4 of the full filtered list.
Counts are an observation, not constants or test fixtures. Raw responses remain ignored
under .tmp/tm-filter-*.json; no production payloads are committed.

APK evidence: ExercisesBloc._getFilters (0xd6fa74) uses the filter type as query key and
joins values with ',' at 0xd6fb30. PhysicalRepositoryImpl.exercises (0xd024fc) requests
/exercises/temporary_exercises/ (GET 0xd025c4); search is added as query key at 0xd0258c.
Its muscleGroups method requests /exercises/muscle_groups/ (0xd6d23c). Live requests
confirmed both the paginated and full-catalog routes accept the same name-based filters.

## Server catalog cache policy

Full catalog, muscle dictionary, filtered page membership and exercise details are
fresh for 30 days. This is a freshness window, not a deletion deadline: SQLite
retains exercise descriptions and aliases after expiry and process restarts.
Query snapshots are bounded to 64 per connection; evicting a snapshot does not
remove its exercise records. Local fallback results retain partial/unknown coverage.

Warm reads do not request the provider. Stale list, dictionary and detail reads
return stored data while a single refresh per scoped operation runs in the
background. Cold reads wait for one deduplicated fetch. Failed refreshes preserve
stored data and impose a shared 60-second retry cooldown across that connection;
429 uses the existing bounded Retry-After policy. No timer deletes catalog data
or refreshes it daily. Request-driven refreshes retain owner/account/generation
and session authorization fences before writes and responses.

Private preview/video delivery still validates media separately. Forced detail
refreshes wait for the provider and propagate errors, allowing expiring media URLs
to refresh without treating month-long description freshness as media validity.

Failed private preview checks retain `unknown` availability with a separate
60-second retry window, checked after catalog authorization. Repeated requests
within that window skip provider metadata and image requests. A failed image URL
triggers one forced metadata refresh; the image request is retried only when that
refresh changes its URL. Expiry permits another attempt. This does not establish
that the provider has no image; video refresh behavior is unchanged.

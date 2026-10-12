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
не содержит видео-полей. Метода списка каталога в клиенте пока нет.

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
User-Agent:                     # empty; suppresses Node fetch default
Content-Type: application/json   # only requests with a JSON body
```

No application name/version/device identity or advertising identifiers are sent.
Node fetch inserts User-Agent: node when the header is omitted; an explicitly empty
value suppresses that default. The wire header is present with an empty value.
The negotiation headers were accepted by the live API;
exercise 6 detail matched the previous response without explicit Accept/version headers.
Exercise detail and training list also passed runtime validation through the updated client.

The JWT already authenticates the account, so User-Agent is not an anonymity control.
Changing it does not guarantee that backend logs cannot distinguish this integration.
For private own-account use, imitating the official app version is not required by the
observed endpoints. This is a compatibility observation, not a guarantee about monitoring
or future API policy. Refresh requests to Firebase retain their existing independent headers.

[Client setup and writes](transformmate-write.md) · [Firebase auth/probes](transformmate-probe.md).

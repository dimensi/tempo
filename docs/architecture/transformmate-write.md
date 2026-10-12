# TransformMate write contract

Проверено 2026-10-12 на Android APK 2.1.7 и собственных временных тренировках.
Base: `https://transformmate.pht.space/ipt/api/v1`. Auth: `JWT <Firebase ID token>`.
Query parameters для записей отсутствуют. Интеграции с нашей БД/UI нет.

## Подтверждённые операции

`T` ниже — `/workouts/trainings/{id}/`. Любое вложенное изменение отправляет
**полный ForUpdate DTO**, затем клиент получает GET detail. PATCH response сокращён:
нет author, updated_at и части остальных полей detail. POST возвращает сокращённую
тренировку; клиент валидирует и возвращает её id. DELETE имеет пустой ответ.

| Operation                   | HTTP   | Endpoint                  | Request shape                              | Response               | Verified |
| --------------------------- | ------ | ------------------------- | ------------------------------------------ | ---------------------- | -------- |
| List/detail                 | GET    | `/workouts/trainings/`, T | none                                       | 200 summary[] / detail | live     |
| Create training             | POST   | `/workouts/trainings/`    | name, description, date, protocols         | 201, JSON with id      | live     |
| Update header               | PATCH  | T                         | full DTO, changed name/description/date    | 200 reduced workout    | live     |
| Add/remove exercise         | PATCH  | T                         | protocols[].workout_exercises array        | 200 reduced workout    | live     |
| Reorder exercises/protocols | PATCH  | T                         | reordered arrays, retained IDs             | 200 reduced workout    | live     |
| Create/delete plan set      | PATCH  | T                         | metrics[type=plan/fact].sets arrays        | 200 reduced workout    | live     |
| Update plan values          | PATCH  | T                         | plan sets[].set_metrics[].metric_values    | 200 reduced workout    | live     |
| Update fact values          | PATCH  | T                         | fact sets[].set_metrics[].metric_values    | 200 reduced workout    | live     |
| Mark fact set done          | PATCH  | T                         | fact sets[].is_done                        | 200 reduced workout    | live     |
| Start/finish                | PATCH  | T                         | started / finished UTC timestamp, full DTO | 200 reduced workout    | live     |
| Inline exercise comment     | PATCH  | T                         | workout_exercises[].comment                | 200 reduced workout    | live     |
| Delete training             | DELETE | T                         | none                                       | 204 empty              | live     |

## Request DTO (separate from response types)

```text
Training: name:string, description:string, date:YYYY-MM-DD, protocols:Protocol[]
          started?:ISO timestamp, finished?:ISO timestamp
Protocol: id?:number, workout_exercises:Exercise[]
Exercise: id?:number, exercise:number, comment:string,
          exercise_metrics:number[], metrics:Metrics[],
          target_indication?:number, videoreport_required?:boolean
Metrics:  id?:number, type:plan|fact, sets:Set[]
Set:      id?:number, is_done?:boolean, techniques?:number[], set_metrics:Metric[]
Metric:   id?:number, type?:straight|range|drop|two_in_one,
          measure:number, metric_values:Value[]
Value:    id?:number, value:string
```

Нет request order: порядок задаётся массивами. Нет request root id/author/progress,
exercise results, warmup_metrics или полных объектов measure/exercise. Positive IDs
сохраняются при последующих PATCH; новые сущности идут без id. Значения остаются строками.
Sharing token из APK исключён из поддерживаемого DTO, его поведение не исследовалось.
Типы range/drop/two_in_one подтверждены APK; live probe использовал только straight.

## APK evidence

Flutter AOT разобран Blutter. Base APK SHA256:
`98c5a30027c6ee50f9d26d76b6f949cc388a4530fe2c026e89f4ff0b9792c5a9`.
arm64 split SHA256:
`730f8dc66934026ef954e7dcfddc66164fd31085fa79a6725d41871d5c0d1122`.
Assemblies сохранены локально под `transformmate-apk/research/output/asm/physical_training`;
они не входят в Git.

- `PhysicalRepositoryImpl.createWorkout` 0xd8c818: serializer 0xd8c940,
  POST 0xd8c970; читает JSON.id и возвращает int.
- `PhysicalRepositoryImpl.updateWorkout` 0xda2884: URI 0xda2998,
  serializer 0xda29d8, PATCH 0xda2a04; парсит WorkoutEntity 0xda2a50.
- `PhysicalRepositoryImpl.deleteWorkout` 0xda709c: URI 0xda70ec,
  DELETE 0xda7138; response игнорируется, Future<void>.
- ForUpdate serializers: Workout 0xc23f84, Superset 0xc2319c,
  WorkoutExercise 0x931e84, Metrics 0x932104, Set 0x9325c4,
  SetMetric 0x9332f0, SetMetricValue 0x933520.
- SetType map: object pool pp+0x21cc0.
- `EditableWorkoutBloc` events add/remove/move exercise, add/remove set,
  change plan/fact, complete set, change comment изменяют local workout.
  Save → `PhysicalInteractor.updateWorkout` → repository PATCH.
  Start 0xda20d0 / finish 0xda335c записывают now/toUtc тем же путём.

Inline comment отличается от curator notes и curator reports: их запись не проверялась
и методов отправки сообщений клиент не предоставляет. Глобальные exercises/training_blocks
не изменялись. Реальная тренировка читалась только; записи выполнялись лишь в новых API Probe.

## Live evidence

Первый lifecycle: temporary training **2279818**:

created → exercise added → plan added → started → fact entered → completed → deleted.

Raw requests, responses и GET snapshots находятся в ignored local directory
`.tmp/transformmate-write-2026-10-12T00-18-51-769Z/` (private data, не коммитить).

- Plan: 10/3 и 12.5/5, затем второй изменён на 15/6.
- После создания двух plan sets сервер вернул **0 fact sets**. Пары автоматически
  не создаются: probe добавил два fact placeholders отдельным PATCH.
- Fact первого подхода 11/4. ID подхода до/после записи сохранился, is_done оставался false.
  Отдельный PATCH is_done=true сохранил значения. Не гарантируем стабильность ID между сессиями.
- Start: progress=in_progress; finish: progress=done и UTC finished.
- После finish fact остался 11/4. last_results/best_result содержали исторические 10/3,
  а не текущий факт. Не использовать results как источник текущих подходов.
- DELETE=204, отсутствие в списке подтверждено.

Второй lifecycle **2279822** выполнен уже через новые методы клиента. Raw evidence:
`.tmp/transformmate-client-write-1791764719546/`. Дополнительно
подтверждены reorder внутри protocol и между protocols, inline comment, removal exercise,
создание/удаление третьего подхода с обеими сторонами пары. Обе тестовые тренировки удалены;
исходная реальная тренировка осталась в списке.

## Client behavior and limits

`client.ts` сохраняет совместимость с read probes. Новых произвольных raw write endpoints нет.
Для convenience mutations: GET свежего detail → проверка is_mine и ID → явный ForUpdate DTO →
PATCH → validation response id → GET полного detail. Delete также проверяет ownership через GET.

Exercise selector — occurrence id, не global exercise id. Set selector — type + 1-based array
position. Positive IDs из свежего GET служат метаданными запроса, не постоянной идентичностью.
`createPlanSet` / `deletePlanSet` явно меняют обе plan/fact стороны; несогласованные размеры
массивов отклоняются. `updateTraining` позволяет явно передать подтверждённый protocols DTO
для восстановления такого состояния. Никакого автоматического угадывания значений нет.

Read-modify-write не атомарен: конкурентное редактирование в приложении может перезаписать
изменения. Клиент не делает network/5xx retries, особенно для POST с неизвестным результатом.
Только 401 вызывает один Firebase refresh и повтор того же body; 403 не повторяется.
После успешной записи последующий GET может отдельно завершиться ошибкой: это не отменяет PATCH.
Неизвестные write fields/metric types и непонятные reference shapes отклоняются перед записью.

Credentials редактируются в ответах/ошибках; входные validation errors не содержат payload.
Unit tests используют synthetic demo fixtures; реальные raw JSON остаются только локально.

## Validation

На ветке `codex/transformmate-write-client`, поверх origin/main `7876d35`:
format:check, lint, typecheck и build прошли; pnpm test — 348 passed, включая 100 новых
write/safeguard tests. Live probes прошли, cleanup подтверждён.

Полный E2E run: 37 passed / 1 failed (desktop diary photo text locator found two
elements). Отдельный повтор этого теста прошёл. Первый параллельный запуск pnpm test
и E2E вызвал конфликт общей e2e.sqlite; последовательный повтор pnpm test прошёл.
Эти наборы нужно запускать последовательно. Docker smoke не запускался: инфраструктура
не менялась.

## Using the client

Только серверный код: `createTransformMateClient` импортируется из
`@/server/transformmate/client`; `FirebaseSession` — из
`@/server/transformmate/firebase-session`. Write types находятся в
`write-inputs.ts`, response types — в `types.ts`. Секреты не передавать в браузер.

```ts
import { createTransformMateClient } from '@/server/transformmate/client';
import { FirebaseSession } from '@/server/transformmate/firebase-session';

const session = new FirebaseSession({
  firebaseApiKey: process.env.TRANSFORMMATE_FIREBASE_API_KEY!,
  refreshToken: process.env.TRANSFORMMATE_FIREBASE_REFRESH_TOKEN!,
});
const client = createTransformMateClient({
  baseUrl: 'https://transformmate.pht.space/ipt/api/v1',
  tokenProvider: session,
});
const { body: trainings } = await client.listTrainings();
const first = trainings[0];
if (!first) throw new Error('No TransformMate trainings');
const { body: training } = await client.getTraining(first.id);
```

Каждый метод возвращает
`RawResponse<T>`: `body`, `status`, `statusText`, `contentType`, `isJson`.
Create возвращает `body: { id: number }`, остальные изменения — полный detail после
GET, delete — пустой `body: ''`. Ошибки HTTP выбрасываются как
`TransformMateApiError`, неверный response — `TransformMateResponseError`.

| Method                         | Arguments                                                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| listTrainings                  | none                                                                                                                                           |
| getTraining                    | trainingId                                                                                                                                     |
| createTraining                 | CreateTrainingInput: name, description, date, optional protocols                                                                               |
| updateTraining                 | trainingId, UpdateTrainingInput (partial header/timestamps/protocols)                                                                          |
| deleteTraining                 | trainingId                                                                                                                                     |
| addExercise                    | trainingId, AddExerciseInput: exercise (catalog ID), comment, exercise_metrics IDs, optional protocolId/target_indication/videoreport_required |
| removeExercise                 | trainingId, exerciseOccurrenceId                                                                                                               |
| reorderProtocols               | trainingId, complete protocolIds array                                                                                                         |
| reorderExercises               | trainingId, protocolId, complete exerciseOccurrenceIds array                                                                                   |
| updateExerciseComment          | trainingId, exerciseOccurrenceId, comment                                                                                                      |
| createPlanSet                  | trainingId, exerciseOccurrenceId, { set_metrics, optional techniques }                                                                         |
| updatePlanSet                  | trainingId, exerciseOccurrenceId, order (1-based), UpdateSetInput                                                                              |
| deletePlanSet                  | trainingId, exerciseOccurrenceId, order (1-based)                                                                                              |
| updateFactSet                  | trainingId, exerciseOccurrenceId, order (1-based), UpdateSetInput                                                                              |
| markSetDone                    | trainingId, exerciseOccurrenceId, order (1-based), done (default true)                                                                         |
| startTraining / finishTraining | trainingId, optional ISO timestamp (default current UTC)                                                                                       |

Пример значения для createPlanSet/updatePlanSet/updateFactSet:

```ts
const set_metrics = [
  { type: 'straight' as const, measure: 3, metric_values: [{ value: '11' }] },
  { type: 'straight' as const, measure: 4, metric_values: [{ value: '4' }] },
];
// Только на предназначенной для редактирования тренировке:
const exerciseOccurrenceId = training.protocols[0]?.workout_exercises[0]?.id;
if (!exerciseOccurrenceId) throw new Error('No TransformMate exercise');
await client.updateFactSet(training.id, exerciseOccurrenceId, 1, {
  set_metrics,
});
await client.markSetDone(training.id, exerciseOccurrenceId, 1);
```

`measure=3` — weight, `measure=4` — reps в проверенном каталоге. UpdateSetInput
содержит optional set_metrics/techniques/is_done; is_done допустим только для fact.
Reorder требует все текущие ID без повторов. Add без protocolId создаёт новый protocol.
Remove последнего exercise удаляет его пустой protocol. Методы изменения требуют is_mine.
`getMe`, `getTrainingsRaw`, `getTrainingRaw`, `getTrainings` оставлены для совместимости
с исследовательскими probes. Неисследованные response fields (mediareports, week и др.)
сохраняются как unknown; curator notes и sharing writes не поддерживаются.

FirebaseSession кэширует ID token и обновляет его автоматически. Rotation refresh token
можно обработать через onRefreshToken; клиент не сохраняет обновлённый refresh token на диск.
Подробности и безопасный CLI запуск — [auth/probe guide](transformmate-probe.md).

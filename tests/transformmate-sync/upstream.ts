import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import {
  trainingDetailFixture,
  trainingSummaryFixture,
} from '../fixtures/transformmate';
import type { TrainingWriteBody } from '@/server/transformmate/write-inputs';
import { exerciseDetailFixture } from '../fixtures/transformmate-exercise';

type Detail = ReturnType<typeof trainingDetailFixture>;
const exercise = () => {
  const e = exerciseDetailFixture();
  e.metrics = [3, 4].map((id) => ({
    id,
    name: id === 3 ? 'Weight' : 'Reps',
    short_name: '',
    key: id === 3 ? 'weight' : 'reps',
    value_type: 'float',
    set_metric_types: [
      { name: 'Straight', type: 'straight', key: '', friendly_techniques: [] },
    ],
  }));
  e.kinescope_data[0]!.url =
    'https://kinescopecdn.net/synthetic.mp4?sign=synthetic-only';
  return e;
};
let wireGeneration = 0;
function wireDetail(
  id: number,
  body: TrainingWriteBody,
  previous?: Detail,
): Detail {
  const detail = previous ? structuredClone(previous) : trainingDetailFixture();
  Object.assign(detail, {
    id,
    name: body.name,
    description: body.description,
    date: body.date,
  });
  if (body.started !== undefined) detail.started = body.started;
  if (body.finished !== undefined) detail.finished = body.finished;
  let sequence = id * 100000 + ++wireGeneration * 1000;
  detail.protocols = body.protocols.map((p, pi) => ({
    ...p,
    id: p.id ?? ++sequence,
    order: pi + 1,
    workout_exercises: p.workout_exercises.map((e, ei) => ({
      ...trainingDetailFixture().protocols[0]!.workout_exercises[0],
      ...e,
      id: e.id ?? ++sequence,
      order: ei + 1,
      exercise: { id: e.exercise, name: 'Demo exercise' },
      exercise_metrics: e.exercise_metrics.map((id) => ({
        id,
        name: id === 3 ? 'weight' : 'reps',
      })),
      metrics: e.metrics.map((m) => ({
        ...m,
        id: m.id ?? ++sequence,
        sets: m.sets.map((s, si) => ({
          ...s,
          id: s.id ?? ++sequence,
          order: si + 1,
          ...(m.type === 'fact' ? { is_done: s.is_done ?? false } : {}),
          techniques: s.techniques ?? [],
          set_metrics: s.set_metrics.map((metric) => ({
            ...metric,
            id: metric.id ?? ++sequence,
            type: metric.type ?? 'straight',
            measure: {
              id: metric.measure,
              key: metric.measure === 3 ? 'weight' : 'reps',
              name: '',
              short_name: '',
            },
            metric_values: metric.metric_values.map((v) => ({
              ...v,
              id: v.id ?? ++sequence,
            })),
          })),
        })),
      })),
    })),
  })) as unknown as Detail['protocols'];
  return detail;
}
export async function startUpstream() {
  const video = readFileSync(new URL('./synthetic.mp4', import.meta.url));
  let trainings = new Map<number, Detail>();
  let posts: TrainingWriteBody[] = [];
  let patches: { id: number; body: TrainingWriteBody }[] = [];
  let forbiddenWrites = 0,
    reads = 0,
    activeReads = 0,
    nextId = 1000;
  let failure = '',
    delay = 0,
    rotate = false;
  let firebaseTokens: string[] = [];
  const state = () => ({
    posts,
    patches,
    forbiddenWrites,
    reads,
    activeReads,
    firebaseTokens,
    ids: [...trainings.keys()],
    trainings: [...trainings.values()],
  });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1:3158');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString();
    const json = (value: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (url.pathname === '/control' && req.method === 'GET')
      return json(state());
    if (url.pathname === '/control' && req.method === 'POST') {
      const control = JSON.parse(text) as {
        action: string;
        id?: number;
        delay?: number;
      };
      if (control.action === 'reset') {
        trainings = new Map();
        posts = [];
        patches = [];
        forbiddenWrites = 0;
        reads = 0;
        failure = '';
        delay = 0;
        rotate = false;
        firebaseTokens = [];
      } else if (
        [
          'failaftercommit',
          'createunknown',
          'patchaftercommit',
          'patchunknown',
        ].includes(control.action)
      )
        failure = control.action;
      else if (control.action === 'cachedauthdelay')
        delay = control.delay ?? 500;
      else if (control.action === 'rotate') rotate = true;
      else if (control.action === 'seednative') {
        const id = nextId++;
        const detail = trainingDetailFixture(true);
        detail.id = id;
        detail.name = 'Native phone workout';
        detail.description = 'Created in TransformMate';
        detail.protocols[0]!.workout_exercises.push({
          ...structuredClone(detail.protocols[0]!.workout_exercises[0]!),
          id: detail.protocols[0]!.workout_exercises[0]!.id + 1,
          order: 2,
          exercise: { id: 502, name: 'Second native exercise' },
        });
        trainings.set(id, detail);
      } else if (
        ['setfact', 'unstartedfact', 'start', 'externaledit'].includes(
          control.action,
        )
      ) {
        const current = trainings.get(control.id!);
        if (!current) return json({ error: 'not found' }, 404);
        if (control.action === 'externaledit') current.name += ' external edit';
        else {
          if (control.action !== 'unstartedfact') {
            current.started = '2026-01-01T10:00:00Z';
            current.progress = 'progress';
          }
          if (control.action === 'setfact') {
            current.finished = '2026-01-01T10:30:00Z';
            current.progress = 'done';
          }
          if (control.action !== 'start')
            for (const p of current.protocols)
              for (const e of p.workout_exercises) {
                e.id += 10000;
                const plan = e.metrics.find((m) => m.type === 'plan')!,
                  fact = e.metrics.find((m) => m.type === 'fact')!;
                fact.sets = structuredClone(plan.sets).map((s) => ({
                  ...s,
                  id: s.id + 10000,
                  is_done: true,
                  set_metrics: s.set_metrics.map((m) => ({
                    ...m,
                    id: m.id + 10000,
                    metric_values: m.metric_values.map((v) => ({
                      ...v,
                      value: m.measure.id === 3 ? '12.5' : '7',
                    })),
                  })),
                }));
              }
        }
      } else return json({ error: 'unknown action' }, 400);
      return json(state());
    }
    if (url.pathname === '/firebase/v1/token') {
      const token = new URLSearchParams(text).get('refresh_token') ?? '';
      if (
        url.searchParams.get('key') !== 'synthetic-api-key' ||
        ![
          'synthetic-refresh-token',
          'synthetic-refresh-token-rotated',
          'synthetic-refresh-token-other',
          'synthetic-refresh-token-rejected',
        ].includes(token)
      )
        return json({}, 403);
      firebaseTokens.push(token);
      if (token === 'synthetic-refresh-token-rejected')
        return json({ error: { message: 'INVALID_REFRESH_TOKEN' } }, 400);
      const other = token === 'synthetic-refresh-token-other';
      return json({
        id_token: other ? 'synthetic-id-token-other' : 'synthetic-id-token',
        refresh_token: other
          ? token
          : rotate
            ? 'synthetic-refresh-token-rotated'
            : token,
        expires_in: '3600',
        user_id: other ? 'synthetic-user-other' : 'synthetic-user',
        project_id: 'synthetic-project',
      });
    }
    if (url.pathname === '/media/synthetic.mp4') {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      const start = match ? Number(match[1]) : 0,
        end = match?.[2]
          ? Math.min(Number(match[2]), video.length - 1)
          : video.length - 1;
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${video.length}` });
        return res.end();
      }
      res.writeHead(match ? 206 : 200, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        ...(match
          ? { 'Content-Range': `bytes ${start}-${end}/${video.length}` }
          : {}),
      });
      return res.end(
        req.method === 'HEAD' ? undefined : video.subarray(start, end + 1),
      );
    }
    if (
      !['JWT synthetic-id-token', 'JWT synthetic-id-token-other'].includes(
        req.headers.authorization ?? '',
      )
    )
      return json({}, 401);
    if (req.method === 'DELETE') {
      forbiddenWrites++;
      return json({}, 405);
    }
    if (req.method === 'GET') {
      reads++;
      activeReads++;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      activeReads--;
    }
    const path = url.pathname.replace('/transformmate/ipt/api/v1', '');
    if (path === '/users/me/')
      return json({
        id: req.headers.authorization?.endsWith('-other') ? 202 : 201,
        first_name: 'Synthetic',
        last_name: 'Athlete',
        email: 'synthetic@example.test',
      });
    if (path === '/exercises/' || path === '/exercises/501/')
      return json(path === '/exercises/' ? [exercise()] : exercise());
    if (path === '/workouts/trainings/' && req.method === 'POST') {
      const body = JSON.parse(text) as TrainingWriteBody;
      posts.push(body);
      const id = nextId++;
      if (failure !== 'createunknown') trainings.set(id, wireDetail(id, body));
      if (failure) {
        failure = '';
        res.destroy();
        return;
      }
      return json({ id }, 201);
    }
    if (path === '/workouts/trainings/')
      return json(
        [...trainings.values()].map((d) => ({
          ...trainingSummaryFixture(),
          ...d,
          protocols: undefined,
        })),
      );
    const training = /^\/workouts\/trainings\/(\d+)\/$/.exec(path);
    if (training) {
      const id = Number(training[1]);
      if (!trainings.has(id)) return json({}, 404);
      if (req.method === 'PATCH') {
        const body = JSON.parse(text) as TrainingWriteBody;
        patches.push({ id, body });
        if (failure !== 'patchunknown')
          trainings.set(id, wireDetail(id, body, trainings.get(id)));
        if (failure) {
          failure = '';
          res.destroy();
          return;
        }
        return json({ id });
      }
      return json(trainings.get(id));
    }
    json({ error: 'unexpected synthetic request' }, 404);
  });
  await new Promise<void>((resolve) =>
    server.listen(3158, '127.0.0.1', resolve),
  );
  return server;
}

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import {
  trainingDetailFixture,
  trainingSummaryFixture,
} from '../fixtures/transformmate';
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
export async function startUpstream() {
  const video = readFileSync(new URL('./synthetic.mp4', import.meta.url));
  let trainings = new Map<number, Detail>();
  let posts: unknown[] = [];
  let forbiddenWrites = 0;
  let reads = 0;
  let nextId = 1000;
  let failure = '';
  let delay = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1:3158');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString();
    const json = (value: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (url.pathname === '/control' && req.method === 'POST') {
      const control = JSON.parse(text) as {
        action: string;
        id?: number;
        delay?: number;
      };
      if (control.action === 'reset') {
        trainings = new Map();
        posts = [];
        forbiddenWrites = 0;
        reads = 0;
        failure = '';
        delay = 0;
      } else if (['failaftercommit', 'createunknown'].includes(control.action))
        failure = control.action;
      else if (control.action === 'cachedauthdelay')
        delay = control.delay ?? 500;
      else if (
        control.action === 'setfact' ||
        control.action === 'externaledit'
      ) {
        const current = trainings.get(control.id!);
        if (!current) return json({ error: 'not found' }, 404);
        if (control.action === 'externaledit') current.name += ' external edit';
        else {
          current.started = '2026-01-01T10:00:00Z';
          current.finished = '2026-01-01T10:30:00Z';
          current.progress = 'done';
          for (const p of current.protocols)
            for (const e of p.workout_exercises) {
              e.id += 10000;
              const plan = e.metrics.find((m) => m.type === 'plan')!;
              const fact = e.metrics.find((m) => m.type === 'fact')!;
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
      return json({
        posts,
        forbiddenWrites,
        reads,
        ids: [...trainings.keys()],
      });
    }
    if (url.pathname === '/control' && req.method === 'GET')
      return json({
        posts,
        forbiddenWrites,
        reads,
        ids: [...trainings.keys()],
      });
    if (url.pathname === '/firebase/v1/token') {
      if (
        url.searchParams.get('key') !== 'synthetic-api-key' ||
        new URLSearchParams(text).get('refresh_token') !==
          'synthetic-refresh-token'
      )
        return json({}, 403);
      return json({
        id_token: 'synthetic-id-token',
        refresh_token: 'synthetic-refresh-token',
        expires_in: '3600',
        user_id: 'synthetic-user',
        project_id: 'synthetic-project',
      });
    }
    if (url.pathname === '/media/synthetic.mp4') {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2]
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
    if (req.headers.authorization !== 'JWT synthetic-id-token')
      return json({}, 401);
    if (req.method === 'PATCH' || req.method === 'DELETE') {
      forbiddenWrites++;
      return json({}, 405);
    }
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const path = url.pathname.replace('/transformmate/ipt/api/v1', '');
    if (path === '/exercises/' || path === '/exercises/501/') {
      reads++;
      return json(path === '/exercises/' ? [exercise()] : exercise());
    }
    if (path === '/workouts/trainings/' && req.method === 'POST') {
      const body = JSON.parse(text);
      posts.push(body);
      const id = nextId++;
      if (failure !== 'createunknown') {
        const detail = trainingDetailFixture();
        Object.assign(detail, {
          id,
          name: body.name,
          description: body.description,
          date: body.date,
        });
        let sequence = id * 100;
        detail.protocols = body.protocols.map((p: Record<string, unknown>) => ({
          ...p,
          id: ++sequence,
          order: 1,
          workout_exercises: (
            p.workout_exercises as Record<string, unknown>[]
          ).map((e) => ({
            ...detail.protocols[0]!.workout_exercises[0],
            ...e,
            id: ++sequence,
            exercise: { id: e.exercise, name: 'Demo exercise' },
            exercise_metrics: (e.exercise_metrics as number[]).map((id) => ({
              id,
              name: id === 3 ? 'weight' : 'reps',
            })),
            metrics: (
              e.metrics as {
                type: string;
                sets: {
                  set_metrics: {
                    measure: number;
                    metric_values: { value: string }[];
                  }[];
                }[];
              }[]
            ).map((m) => ({
              ...m,
              id: ++sequence,
              sets: m.sets.map((s, index) => ({
                ...s,
                id: ++sequence,
                order: index + 1,
                techniques: [],
                set_metrics: s.set_metrics.map((metric) => ({
                  ...metric,
                  id: ++sequence,
                  measure: {
                    id: metric.measure,
                    key: metric.measure === 3 ? 'weight' : 'reps',
                    name: '',
                    short_name: '',
                  },
                  metric_values: metric.metric_values.map((v) => ({
                    ...v,
                    id: ++sequence,
                  })),
                })),
              })),
            })),
          })),
        }));
        trainings.set(id, detail);
      }
      if (failure) {
        failure = '';
        res.destroy();
        return;
      }
      return json({ id }, 201);
    }
    if (path === '/workouts/trainings/') {
      reads++;
      return json(
        [...trainings.values()].map((d) => ({
          ...trainingSummaryFixture(),
          ...d,
          protocols: undefined,
        })),
      );
    }
    const training = /^\/workouts\/trainings\/(\d+)\/$/.exec(path);
    if (training) {
      reads++;
      return json(
        trainings.get(Number(training[1])) ?? {},
        trainings.has(Number(training[1])) ? 200 : 404,
      );
    }
    json({ error: 'unexpected synthetic request' }, 404);
  });
  await new Promise<void>((resolve) =>
    server.listen(3158, '127.0.0.1', resolve),
  );
  return server;
}

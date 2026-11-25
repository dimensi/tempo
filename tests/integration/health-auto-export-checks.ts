import { expect, vi } from 'vitest';
import { POST as upload } from '@/app/api/health/auto-export/route';
import {
  DELETE as revoke,
  GET as status,
  POST as issue,
} from '@/app/api/settings/health-auto-export/route';
import { getRecovery } from '@/server/recovery';

const origin = 'https://tempo.example.test';
const ingress = `${origin}/api/health/auto-export`;
const range = {
  from: '2026-10-23',
  to: '2026-10-26',
  timezone: 'Europe/Berlin',
};
const source = 'Synthetic Apple Watch';

export async function assertHealthAutoExport(
  selectSession: (role: 'OWNER' | 'TRAINER') => void,
) {
  vi.stubEnv('BETTER_AUTH_URL', origin);
  const settings = (method: string, requestOrigin = origin) =>
    new Request(`${origin}/api/settings/health-auto-export`, {
      method,
      headers: { Origin: requestOrigin },
    });
  const send = (token: string, metrics: unknown[]) =>
    upload(
      new Request(ingress, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: { metrics } }),
      }),
    );
  const selected = (name: string, units: string, data: unknown[]) => ({
    name,
    units,
    data,
  });
  const segment = (
    start: string,
    end: string,
    value: string,
    qty: number,
    device = source,
  ) => ({
    date: start,
    startDate: start,
    endDate: end,
    value,
    qty,
    source: device,
  });
  try {
    selectSession('TRAINER');
    expect((await issue(settings('POST'))).status).toBe(403);
    await expect(
      getRecovery(new Headers(), 'owner', range),
    ).rejects.toMatchObject({ status: 403 });

    selectSession('OWNER');
    expect(
      (await issue(settings('POST', 'https://wrong.example.test'))).status,
    ).toBe(403);
    const created = await issue(settings('POST'));
    expect(created.ok).toBe(true);
    const { token } = (await created.json()) as { token: string };
    expect(token).toMatch(/^hae_[A-Za-z0-9_-]{43}$/);
    const settingsDto = await status(settings('GET'));
    expect(settingsDto.headers.get('cache-control')).toContain('no-store');
    const publicStatus = await settingsDto.json();
    expect(publicStatus).toMatchObject({ connected: true, endpoint: ingress });
    expect(publicStatus).not.toHaveProperty('token');

    // Health Auto Export JSON v2, unsummarized, with the fall DST transition.
    const first = [
      selected('sleep_analysis', 'hr', [
        segment(
          '2026-10-24 23:00:00 +0200',
          '2026-10-25 02:30:00 +0200',
          'Основная',
          3.5,
        ),
        segment(
          '2026-10-25 02:00:00 +0200',
          '2026-10-25 02:30:00 +0100',
          'Deep',
          1.5,
        ),
      ]),
      selected('step_count', 'count', [
        { qty: 100, date: '2026-10-25 03:30:00 +0100' },
      ]),
    ];
    const later = [
      selected('sleep_analysis', 'hr', [
        segment(
          '2026-10-24 22:45:00 +0200',
          '2026-10-25 06:15:00 +0100',
          'In Bed',
          8.5,
        ),
        segment(
          '2026-10-25 00:15:00 +0200',
          '2026-10-25 00:45:00 +0200',
          'Awake',
          0.5,
          'Synthetic Other Tracker',
        ),
        segment(
          '2026-10-25 02:30:00 +0100',
          '2026-10-25 02:45:00 +0100',
          'Бодрствование',
          0.25,
        ),
        segment(
          '2026-10-25 02:45:00 +0100',
          '2026-10-25 06:00:00 +0100',
          'БДГ',
          3.25,
        ),
        segment(
          '2026-10-25 08:00:00 +0100',
          '2026-10-25 09:00:00 +0100',
          'Unspecified',
          1,
        ),
        segment(
          '2026-10-25 13:00:00 +0100',
          '2026-10-25 13:30:00 +0100',
          'Core',
          0.5,
        ),
        segment(
          '2026-10-26 11:00:00 +0100',
          '2026-10-26 11:30:00 +0100',
          'Asleep',
          0.5,
        ),
      ]),
      selected('heart_rate', 'count/min', [
        {
          Avg: 54,
          Min: 50,
          Max: 60,
          date: '2026-10-25 03:30:00 +0100',
          source,
        },
        { Avg: 54, date: '2026-10-25 03:30:00 +0100' },
        { Avg: 95, date: '2026-10-25 00:20:00 +0200', source },
        { Avg: 90, date: '2026-10-25 02:40:00 +0100', source },
        { Avg: 72, date: '2026-10-25 13:10:00 +0100', source },
        { Avg: 74, date: '2026-10-26 11:10:00 +0100', source },
      ]),
    ];
    const delivery = await send(token, first);
    expect(delivery.status).toBe(200);
    expect(await delivery.json()).toMatchObject({ inserted: 2, ignored: 1 });
    expect((await send(token, later)).status).toBe(200);
    expect(await (await send(token, first)).json()).toMatchObject({
      inserted: 0,
      duplicates: 2,
    });
    const history = [
      selected('heart_rate_variability', 'ms', [
        { qty: 40, date: '2026-10-23 06:00:00 +0200', source },
        { qty: 60, date: '2026-10-23 06:00:00 +0200', source },
      ]),
    ];
    expect(await (await send(token, history)).json()).toMatchObject({
      inserted: 2,
    });
    expect(await (await send(token, history)).json()).toMatchObject({
      inserted: 0,
      duplicates: 2,
    });

    const invalid = await send(token, [
      selected('heart_rate_variability', 'ms', [
        { qty: 90, date: '2026-10-26 06:00:00 +0100' },
      ]),
      selected('sleep_analysis', 'hr', [
        { date: '2026-10-26 00:00:00 +0100', totalSleep: 8 },
      ]),
    ]);
    expect(invalid.status).toBe(422);
    const failedStatus = await (await status(settings('GET'))).json();
    expect(failedStatus).toMatchObject({
      lastSuccessAt: expect.any(String),
      lastErrorCode: 'invalid_payload',
      lastErrorAt: expect.any(String),
    });
    expect((await send(token, later)).status).toBe(200);
    expect(await (await status(settings('GET'))).json()).toMatchObject({
      lastInserted: 0,
      lastErrorCode: 'invalid_payload',
      lastErrorAt: failedStatus.lastErrorAt,
    });
    const recovery = await getRecovery(new Headers(), 'owner', range);
    expect(recovery.days).toMatchObject([
      {
        date: '2026-10-23',
        sleep: [],
        metrics: {
          heart_rate_variability: { value: 50, unit: 'ms', count: 2 },
        },
      },
      { date: '2026-10-24', sleep: [], metrics: {} },
      {
        date: '2026-10-25',
        sleep: [
          {
            durationSeconds: 26100,
            isNight: true,
            stages: { core: 9000, deep: 3600, rem: 11700, unspecified: 1800 },
            awakeSeconds: 2700,
            inBedSeconds: 28800,
            sources: [source, 'Synthetic Other Tracker'],
          },
          { durationSeconds: 1800, isNight: false },
        ],
        metrics: { night_heart_rate: { value: 54, unit: 'bpm', count: 1 } },
      },
      {
        date: '2026-10-26',
        sleep: [{ durationSeconds: 1800, isNight: false }],
        metrics: {},
      },
    ]);
    expect(recovery.days[3]?.metrics).toEqual({});
    expect(recovery.summary).toMatchObject({
      observedDays: 3,
      sleep: {
        nights: 1,
        observedDays: 2,
        episodes: 3,
        averageDurationSeconds: 14850,
      },
    });
    await expect(
      getRecovery(new Headers(), 'another-owner', range),
    ).rejects.toMatchObject({ status: 403 });

    const replacement = await issue(settings('POST'));
    expect(replacement.ok).toBe(true);
    const { token: newToken } = (await replacement.json()) as { token: string };
    expect(newToken).not.toBe(token);
    expect((await send(token, later)).status).toBe(401);
    expect((await send(newToken, later)).status).toBe(200);
    expect((await revoke(settings('DELETE'))).ok).toBe(true);
    expect((await send(newToken, later)).status).toBe(401);
    expect(await (await status(settings('GET'))).json()).toMatchObject({
      connected: false,
    });
    expect((await getRecovery(new Headers(), 'owner', range)).days).toEqual(
      recovery.days,
    );
  } finally {
    vi.unstubAllEnvs();
  }
}

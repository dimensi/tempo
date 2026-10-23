import { expect } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { eq } from 'drizzle-orm';
import { account, session, user } from '@/server/db/schema';
import {
  oauthAccessToken,
  oauthClient,
  oauthRefreshToken,
} from '@/server/db/schema/oauth';
import { nutritionSchedule } from '@/server/db/schema/nutrition-schedule';
import { nutritionRepository } from '@/server/nutrition/repository';
import { measurementRepository } from '@/server/measurements/repository';
import { yazioHealthRepository } from '@/server/yazio/health-repository';
import { getSavedDataFreshness } from '@/server/analytics/freshness';
import { nutritionDays, nutritionSyncRuns } from '@/server/db/schema/nutrition';
import { yazioDailySteps } from '@/server/db/schema/yazio-health';
import { getAnalytics } from '@/server/analytics';
import { bindMcpReader } from '@/server/auth/data-session';
import { authorize } from '@/server/auth/guards';
import { handleMcp } from '@/server/mcp/http';
import { mcpHistoryInput, mcpOutput, mcpTools } from '@/contracts/mcp';
import { readMcpData } from '@/server/mcp/data';
import {
  createMcpClient,
  listMcpClients,
  revokeMcpClient,
} from '@/server/mcp/clients';
import { workoutTransformMateLinks } from '@/server/db/schema/transformmate';
import { syncStateSchema } from '@/server/workouts/transformmate/state';
import { workoutRepository } from '@/server/workouts/repository';
import {
  meals,
  type NutritionDay,
  type NutritionEntry,
} from '@/contracts/nutrition';

export async function assertMcpAccess(
  auth: ReturnType<(typeof import('@/server/auth'))['getAuth']>,
  connection: ReturnType<
    (typeof import('@/server/db/connection'))['openDatabase']
  >,
) {
  const base = 'http://localhost:3000';
  const resource = `${base}/api/mcp`;
  const password = 'Synthetic-test-password-1234';
  const hash = await hashPassword(password);
  for (const id of ['owner', 'trainer'])
    connection.db
      .insert(account)
      .values({
        id: `mcp-${id}`,
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: hash,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  async function signIn(id: string) {
    const response = await auth.api.signInEmail({
      asResponse: true,
      headers: new Headers({ origin: base }),
      body: { email: `${id}@example.test`, password },
    });
    expect(response.status).toBe(200);
    return new Headers({
      cookie: response.headers.get('set-cookie')!.split(';')[0]!,
      origin: base,
      accept: 'application/json',
    });
  }
  const ownerHeaders = await signIn('owner');
  const trainerHeaders = await signIn('trainer');
  await expect(
    createMcpClient(trainerHeaders, {
      name: 'Denied',
      callback: 'https://client.example.test/callback',
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(listMcpClients(trainerHeaders)).rejects.toMatchObject({
    status: 403,
  });
  const client = await createMcpClient(ownerHeaders, {
    name: 'Synthetic MCP',
    callback: 'https://client.example.test/callback',
  });
  const listed = await listMcpClients(ownerHeaders);
  expect(listed.clients.some((row) => row.clientId === client.client_id)).toBe(
    true,
  );
  expect(
    listed.clients.find((row) => row.clientId === client.client_id)?.callback,
  ).toBe('https://client.example.test/callback');
  expect(JSON.stringify(listed)).not.toContain(client.client_secret);
  await expect(
    revokeMcpClient(trainerHeaders, { clientId: client.client_id }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    revokeMcpClient(ownerHeaders, { clientId: 'someone-elses-client' }),
  ).rejects.toMatchObject({ status: 404 });
  expect(client.client_secret).toBeTruthy();
  const verifier = 'v'.repeat(64);
  async function authorizeQuery(
    headers: Headers,
    scope = 'tempo:read offline_access',
  ) {
    const query = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: 'https://client.example.test/callback',
      response_type: 'code',
      scope,
      state: randomUUID(),
      resource,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'consent',
    });
    const response = await auth.handler(
      new Request(`${base}/api/auth/oauth2/authorize?${query}`, { headers }),
    );
    const location =
      response.headers.get('location') ?? (await response.json()).url;
    expect(location).toContain('/mcp/consent?');
    return new URL(location, base).search.slice(1);
  }
  async function tokenRequest(values: Record<string, string>) {
    return auth.handler(
      new Request(`${base}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.client_id,
          client_secret: client.client_secret!,
          resource,
          ...values,
        }),
      }),
    );
  }
  const query = await authorizeQuery(ownerHeaders);
  const { validMcpQuery } = await import('@/server/mcp/consent');
  expect(await validMcpQuery(query)).toBe(true);
  expect(await validMcpQuery(query + '&scope=tempo:write')).toBe(false);
  const { completeMcpConsent } = await import('@/server/mcp/consent');
  const target = await completeMcpConsent(ownerHeaders, query, true);
  const callback = new URL(target, base);
  expect(
    callback.searchParams.get('error'),
    callback.searchParams.get('error_description') ?? '',
  ).toBeNull();
  const code = callback.searchParams.get('code')!;
  expect(code).toBeTruthy();
  const exchanged = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: 'https://client.example.test/callback',
  });
  expect(
    exchanged.status,
    exchanged.ok ? '' : await exchanged.clone().text(),
  ).toBe(200);
  const tokens = await exchanged.json();
  expect(tokens.access_token).toBeTruthy();
  expect(tokens.refresh_token).toBeTruthy();
  const persistentRefresh = connection.db
    .select()
    .from(oauthRefreshToken)
    .get()!;
  expect(persistentRefresh.sessionId).toBeNull();
  expect(persistentRefresh.expiresAt.getTime()).toBeGreaterThan(
    Date.now() + 99 * 365 * 86400000,
  );
  expect(
    connection.db.select().from(oauthAccessToken).get()!.sessionId,
  ).toBeNull();
  await auth.api.verifyTempoToken({ body: { token: tokens.access_token } });
  const headers = new Headers();
  bindMcpReader(headers, () =>
    auth.api.verifyTempoToken({ body: { token: tokens.access_token } }),
  );
  expect((await authorize(headers, 'nutrition:read', 'owner')).ok).toBe(true);
  expect((await authorize(headers, 'nutrition:read', 'someone-else')).ok).toBe(
    false,
  );
  for (const permission of [
    'nutrition:write',
    'workouts:plan',
    'anamnesis:read',
    'reports:export',
    'settings:manage',
  ] as const)
    expect((await authorize(headers, permission, 'owner')).ok).toBe(false);
  const saved = (
    date: string,
    value: string | null,
    entries: boolean,
  ): NutritionDay => {
    const totals = {
      calories: value,
      protein: value,
      fat: value,
      carbs: value,
    };
    const entry: NutritionEntry = {
      id: date,
      kind: 'simple',
      name: 'Synthetic food',
      meal: 'breakfast',
      diaryDateTime: `${date} 12:00:00`,
      addedAt: null,
      consumedAt: null,
      editedAt: null,
      sourceId: null,
      amount: null,
      baseUnit: null,
      serving: null,
      servingQuantity: null,
      consumedPortions: null,
      recipePortions: null,
      massG: null,
      volumeMl: null,
      ingredientMassEstimateG: null,
      totals,
      issues: [],
    };
    return {
      date,
      fetchedAt: '2026-10-20T00:00:00Z',
      totals,
      knownTotals: totals,
      officialTotals: totals,
      delta: { calories: '0', protein: '0', fat: '0', carbs: '0' },
      meals: meals.map((kind) => ({
        kind,
        entries: entries && kind === 'breakfast' ? [entry] : [],
        totals,
        knownTotals: totals,
        officialTotals: totals,
        delta: totals,
      })),
    };
  };
  for (const day of [
    saved('2026-10-01', '0', true),
    saved('2026-10-02', null, true),
    saved('2026-10-03', '0', false),
  ])
    connection.db
      .insert(nutritionDays)
      .values({
        ownerId: 'owner',
        date: day.date,
        snapshot: JSON.stringify(day),
        fetchedAt: day.fetchedAt,
      })
      .run();
  connection.db
    .insert(yazioDailySteps)
    .values({
      ownerId: 'owner',
      date: '2026-10-01',
      steps: 0,
      observedAt: '2026-10-20T00:00:00Z',
    })
    .run();

  const workouts = workoutRepository(connection.db);
  const planned = workouts.create('owner', {
    date: '2026-10-01',
    title: 'Strength',
    status: 'planned',
    note: '',
    exercises: [{ name: 'Squat', sets: [{ reps: 8, weightKg: 40 }] }],
  });
  const started = workouts.update(
    'owner',
    planned.id,
    planned.revision,
    {
      date: planned.date,
      title: planned.title,
      status: 'in_progress',
      note: '',
      exercises: planned.exercises,
    },
    'start',
  );
  const completed = workouts.update(
    'owner',
    started.id,
    started.revision,
    {
      date: started.date,
      title: started.title,
      status: 'completed',
      note: '',
      exercises: [
        { ...started.exercises[0]!, sets: [{ reps: 6, weightKg: 45 }] },
      ],
    },
    'complete',
  );
  const mcp = new Client({ name: 'tempo-integration', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    authProvider: { token: async () => tokens.access_token },
    fetch: async (url, options) => handleMcp(new Request(url, options)),
  });
  await mcp.connect(transport);
  try {
    expect((await mcp.listTools()).tools.map((t) => t.name).sort()).toEqual(
      [...mcpTools].sort(),
    );
    const range = { from: '2026-10-01', to: '2026-10-04' };
    const firstWorkout = mcpOutput.parse(
      (
        await mcp.callTool({
          name: 'get_workouts',
          arguments: { ...range, limit: 1, detail: 'records' },
        })
      ).structuredContent,
    );
    expect(firstWorkout).toMatchObject({
      next_cursor: null,
      data: {
        coverage: { recordCounts: { workout: 1, linked: 0, native: 0 } },
        records: [
          {
            kind: 'workout',
            id: completed.id,
            executionStatus: 'completed',
            exercises: [{ actualSets: [{ reps: 6, weightKg: 45 }] }],
          },
        ],
      },
    });
    expect(firstWorkout.data.records).toHaveLength(1);
    // A provider fact container can be an untouched draft, not another session.
    const linkId = randomUUID();
    const state = syncStateSchema.parse({
      version: 1,
      workout: {
        id: planned.id,
        date: planned.date,
        title: planned.title,
        exercises: planned.exercises,
      },
      planTitle: planned.title,
      marker: `[yazio-dashboard:${linkId}]`,
      attempted: true,
      status: 'synced',
      reason: null,
      expected: null,
      baseline: null,
      occurrences: [],
      checkedAt: '2026-10-17T00:00:00Z',
      updateAttempt: {
        id: randomUUID(),
        phase: 'conflict',
        previous: { workout: plan.workouts[0], planTitle: plan.title },
        desired: { workout: plan.workouts[0], planTitle: plan.title },
        previousFingerprint: '0'.repeat(64),
        expectedFingerprint: null,
        connectionId: null,
        createdAt: '2026-10-17T00:00:00Z',
        checkedAt: '2026-10-18T00:00:00Z',
      },
      actual: null,
    });
    connection.db
      .insert(workoutTransformMateLinks)
      .values({
        id: linkId,
        ownerId: 'owner',
        planId: planned.id,
        workoutId: planned.id,
        remoteTrainingId: 123,
        state: JSON.stringify(state),
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      })
      .run();
    const actual = {
      date: '2026-10-01',
      title: 'Strength',
      started: null,
      finished: null,
      exercises: [
        {
          occurrenceKey: null,
          exerciseId: 1,
          name: 'Squat',
          comment: '',
          sets: [{ order: 1, done: false, metrics: [] }],
        },
      ],
    };
    for (const evidence of [
      {
        actual: null,
        executionStatus: 'unknown',
        coverage: 'missing',
        completedSessions: 1,
      },
      {
        actual,
        executionStatus: 'not_started',
        coverage: 'empty',
        completedSessions: 1,
      },
      {
        actual: {
          ...actual,
          exercises: [
            {
              ...actual.exercises[0],
              sets: [
                {
                  order: 1,
                  done: false,
                  metrics: [
                    {
                      name: 'Weight',
                      unit: 'kg',
                      type: 'straight',
                      values: ['0'],
                    },
                  ],
                },
              ],
            },
          ],
        },
        executionStatus: 'in_progress',
        coverage: 'partial',
        completedSessions: 1,
      },
      {
        actual: { ...actual, finished: '2026-10-01T12:00:00Z' },
        executionStatus: 'completed',
        coverage: 'recorded',
        completedSessions: null,
      },
    ]) {
      connection.db
        .update(workoutTransformMateLinks)
        .set({
          state: JSON.stringify(
            syncStateSchema.parse({ ...state, actual: evidence.actual }),
          ),
        })
        .where(eq(workoutTransformMateLinks.id, linkId))
        .run();
      // Default compact responses must be sufficient; limit=1 must not truncate the total.
      const result = await mcp.callTool({
        name: 'get_workouts',
        arguments: { ...range, limit: 1 },
      });
      expect(result.structuredContent).toMatchObject({
        data: {
          freshness: {
            transformmateLinked: {
              latestRecordDate: '2026-10-01',
              lastCheckedAt: '2026-10-18T00:00:00Z',
              lastFetchedAt: null,
              syncState: 'unknown',
            },
          },
          summary: {
            completedSessions: evidence.completedSessions,
            completionCountAmbiguous: evidence.completedSessions === null,
          },
          records: [
            {
              kind: 'linked',
              checkedAt: '2026-10-18T00:00:00Z',
              executionStatus: evidence.executionStatus,
              coverage: evidence.coverage,
            },
          ],
        },
      });
    }
    connection.db
      .delete(workoutTransformMateLinks)
      .where(eq(workoutTransformMateLinks.id, linkId))
      .run();
    // Saved data remains readable after a failed sync; each source has its own clock.
    const failedSync = {
      state: 'failed' as const,
      startedAt: '2026-10-21T00:00:00Z',
      finishedAt: '2026-10-21T00:01:00Z',
      completedDates: [],
      skippedDates: [],
      failedDates: ['2026-10-04'],
      photoFailedDates: [],
    };
    const repository = nutritionRepository(connection);
    repository.saveStatus('owner', failedSync);
    connection.db
      .insert(nutritionSchedule)
      .values({
        ownerId: 'owner',
        enabled: true,
        lastSuccess: Date.parse('2026-10-20T01:00:00Z'),
        lastError: 'SYNC_FAILED',
        nextRunAt: Date.parse('2026-10-21T04:00:00Z'),
      })
      .onConflictDoUpdate({
        target: nutritionSchedule.ownerId,
        set: { lastError: 'SYNC_FAILED' },
      })
      .run();
    yazioHealthRepository(connection.db).upsert(
      'owner',
      {
        dailySteps: [],
        weights: [
          {
            source: 'yazio',
            externalId: randomUUID(),
            providerDate: '2026-10-02',
            measuredDate: '2026-10-02',
            rawValue: '70',
            unit: null,
            unitContext: null,
            upstreamSource: null,
            gateway: null,
          },
        ],
      },
      '2026-10-18T00:00:00Z',
    );
    measurementRepository(connection.db).create('owner', {
      measuredAt: '2026-10-04',
      values: [{ metric: 'waist', value: '80', unit: 'cm' }],
      note: null,
    });
    const changesBefore = connection.sqlite
      .prepare('select total_changes() as count')
      .get();
    const coverage = await mcp.callTool({
      name: 'get_data_coverage',
      arguments: range,
    });
    expect(coverage.isError).toBeFalsy();
    expect(coverage.structuredContent).toMatchObject({
      data: {
        freshness: {
          recordScope: 'requested_range',
          syncScope: 'latest_saved_status_not_range_verification',
          nutrition: {
            state: 'ready',
            latestRecordDate: '2026-10-03',
            lastFetchedAt: '2026-10-20T00:00:00Z',
            syncState: 'failed',
            lastRun: { failedDates: ['2026-10-04'] },
            automatic: {
              lastSuccessAt: '2026-10-20T01:00:00.000Z',
              lastErrorCode: 'SYNC_FAILED',
            },
          },
          yazioWeight: {
            latestRecordDate: '2026-10-02',
            lastFetchedAt: '2026-10-18T00:00:00Z',
            syncState: 'unknown',
          },
          steps: {
            latestRecordDate: '2026-10-01',
            lastFetchedAt: '2026-10-20T00:00:00Z',
            syncState: 'unknown',
          },
          localMeasurements: {
            latestRecordDate: '2026-10-04',
            lastFetchedAt: null,
            lastCheckedAt: null,
            syncState: 'not_applicable',
          },
          transformmateNative: {
            latestRecordDate: null,
            lastFetchedAt: null,
            syncState: 'unknown',
          },
        },
      },
    });
    expect(
      connection.sqlite.prepare('select total_changes() as count').get(),
    ).toEqual(changesBefore);
    await expect(
      getSavedDataFreshness(trainerHeaders, 'owner', range),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      getSavedDataFreshness(headers, 'someone-else', range),
    ).rejects.toMatchObject({ status: 403 });
    const emptyCoverage = await mcp.callTool({
      name: 'get_data_coverage',
      arguments: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(emptyCoverage.structuredContent).toMatchObject({
      data: {
        freshness: {
          nutrition: {
            state: 'ready',
            latestRecordDate: null,
            lastFetchedAt: null,
            syncState: 'failed',
          },
          localMeasurements: {
            latestRecordDate: null,
            syncState: 'not_applicable',
          },
        },
      },
    });
    const coveragePage = mcpOutput.parse(
      (
        await mcp.callTool({
          name: 'get_data_coverage',
          arguments: { ...range, detail: 'daily', limit: 1 },
        })
      ).structuredContent,
    );
    const nextCoverage = mcpOutput.parse(
      (
        await mcp.callTool({
          name: 'get_data_coverage',
          arguments: {
            ...range,
            detail: 'daily',
            limit: 1,
            cursor: coveragePage.next_cursor,
          },
        })
      ).structuredContent,
    );
    expect(nextCoverage.data.freshness).toEqual(coveragePage.data.freshness);
    // A photo-only failure is not a nutrition-data failure, nor a steps/weight success.
    repository.saveStatus('owner', {
      ...failedSync,
      state: 'partial',
      completedDates: ['2026-10-01'],
      failedDates: [],
      photoFailedDates: ['2026-10-01'],
    });
    connection.db
      .update(nutritionSchedule)
      .set({ lastError: 'PHOTO_INCOMPLETE' })
      .where(eq(nutritionSchedule.ownerId, 'owner'))
      .run();
    const photoOnly = await mcp.callTool({
      name: 'get_data_coverage',
      arguments: range,
    });
    expect(photoOnly.structuredContent).toMatchObject({
      data: {
        freshness: {
          nutrition: {
            syncState: 'completed',
            automatic: { lastErrorCode: null },
          },
          steps: { syncState: 'unknown' },
          yazioWeight: { syncState: 'unknown' },
        },
      },
    });
    // Bad status metadata degrades only freshness; it must not erase the saved diary.
    connection.db
      .update(nutritionSyncRuns)
      .set({ status: 'invalid-json' })
      .where(eq(nutritionSyncRuns.ownerId, 'owner'))
      .run();
    const brokenStatus = await mcp.callTool({
      name: 'get_data_coverage',
      arguments: range,
    });
    expect(brokenStatus.structuredContent).toMatchObject({
      data: {
        nutrition: { complete: 1, partial: 1, empty: 1, missing: 1 },
        freshness: {
          nutrition: { state: 'unavailable' },
          steps: { state: 'ready' },
        },
      },
    });
    repository.saveStatus('owner', {
      ...failedSync,
      startedAt: 'invalid-start',
      finishedAt: 'invalid-finish',
    });
    const malformedTimes = await mcp.callTool({
      name: 'get_data_coverage',
      arguments: range,
    });
    expect(malformedTimes.structuredContent).toMatchObject({
      data: {
        nutrition: { complete: 1, partial: 1, empty: 1, missing: 1 },
        freshness: {
          nutrition: { state: 'unavailable' },
          steps: { state: 'ready' },
        },
      },
    });
    repository.saveStatus('owner', failedSync);
    const analytics = await getAnalytics(headers, 'owner', range);
    const nutrition = await mcp.callTool({
      name: 'get_nutrition',
      arguments: { ...range, detail: 'daily', limit: 2 },
    });
    expect(nutrition.isError).toBeFalsy();
    expect(nutrition.structuredContent).toMatchObject({
      data: {
        coverage: { complete: 1, partial: 1, empty: 1, missing: 1 },
        nutrients:
          analytics.nutrition.state === 'ready'
            ? analytics.nutrition.data.summary.nutrients
            : null,
      },
    });
    const second = await mcp.callTool({
      name: 'get_nutrition',
      arguments: {
        ...range,
        detail: 'daily',
        limit: 2,
        cursor: mcpOutput.parse(nutrition.structuredContent).next_cursor,
      },
    });
    expect(second.structuredContent).toMatchObject({
      next_cursor: null,
      data: {
        records: [
          { date: '2026-10-03', quality: 'empty' },
          { date: '2026-10-04', quality: 'missing' },
        ],
      },
    });
    // ChatGPT fans out a single analytics question across all six tools.
    const parallel = await Promise.all(
      mcpTools.map(async (name) => ({
        name,
        result: await mcp.callTool({
          name,
          arguments: name === 'get_profile' ? {} : range,
        }),
      })),
    );
    for (const { name, result } of parallel) {
      expect(result.isError, name).toBeFalsy();
      expect(JSON.stringify(result)).not.toMatch(
        /secret|@example|storageKey|password/,
      );
    }
    // Personal MCP has no HTTP, tool-call or parallelism throttle.
    for (let i = 0; i < 121; i++)
      expect((await mcp.listTools()).tools).toHaveLength(6);
    for (let i = 0; i < 31; i++)
      expect(
        (await mcp.callTool({ name: 'get_profile', arguments: {} })).isError,
      ).toBeFalsy();
    const activity = await readMcpData(
      'get_activity',
      headers,
      'owner',
      mcpHistoryInput.parse({ ...range, detail: 'daily' }),
    );
    expect(activity.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: '2026-10-01', steps: 0 }),
        expect.objectContaining({ date: '2026-10-02', steps: null }),
      ]),
    );
    expect(
      (
        await mcp.callTool({
          name: 'get_nutrition',
          arguments: { ...range, ownerId: 'trainer' },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await mcp.callTool({
          name: 'get_nutrition',
          arguments: { ...range, cursor: 'invalid', detail: 'daily' },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await mcp.callTool({
          name: 'get_nutrition',
          arguments: { from: '2020-01-01', to: '2026-01-01' },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await mcp.callTool({
          name: 'get_nutrition',
          arguments: { from: '2026-01-01', to: '2026-12-31' },
        })
      ).isError,
    ).toBeFalsy();
  } finally {
    await mcp.close();
  }
  const request = (token?: string, body = '{}') =>
    new Request(resource, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body,
    });
  expect((await handleMcp(request())).status).toBe(401);
  expect((await handleMcp(request('invented'))).status).toBe(401);
  expect(
    (await handleMcp(request(tokens.access_token, 'x'.repeat(16385)))).status,
  ).toBe(400);
  expect((await handleMcp(request(tokens.access_token, '[]'))).status).toBe(
    400,
  );
  const issued = connection.db.select().from(oauthAccessToken).get()!;
  connection.db
    .update(oauthAccessToken)
    .set({ scopes: ['offline_access'] })
    .where(eq(oauthAccessToken.id, issued.id))
    .run();
  expect((await handleMcp(request(tokens.access_token))).status).toBe(403);
  connection.db
    .update(oauthAccessToken)
    .set({
      scopes: issued.scopes,
      resources: ['https://other.example.test/mcp'],
    })
    .where(eq(oauthAccessToken.id, issued.id))
    .run();
  expect((await handleMcp(request(tokens.access_token))).status).toBe(401);
  connection.db
    .update(oauthAccessToken)
    .set({ resources: issued.resources })
    .where(eq(oauthAccessToken.id, issued.id))
    .run();
  connection.db
    .update(user)
    .set({ role: 'TRAINER' })
    .where(eq(user.id, 'owner'))
    .run();
  expect((await handleMcp(request(tokens.access_token))).status).toBe(401);
  connection.db
    .update(user)
    .set({ role: 'OWNER' })
    .where(eq(user.id, 'owner'))
    .run();
  expect(
    (
      await handleMcp(
        new Request(resource, {
          method: 'POST',
          headers: { cookie: ownerHeaders.get('cookie')! },
          body: '{}',
        }),
      )
    ).status,
  ).toBe(401);
  // The verifier has no public HTTP route, even with a valid bearer.
  expect(
    (
      await auth.handler(
        new Request(`${base}/api/auth/verify-tempo-token`, {
          method: 'POST',
          body: '{}',
        }),
      )
    ).status,
  ).toBe(404);
  const trainerQuery = await authorizeQuery(trainerHeaders);
  await expect(
    completeMcpConsent(trainerHeaders, trainerQuery, true),
  ).rejects.toBeDefined();
  // Bypass our UI gate: token issuance must still reject TRAINER.
  const trainerConsent = await auth.handler(
    new Request(`${base}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: new Headers({
        ...Object.fromEntries(trainerHeaders),
        'content-type': 'application/json',
      }),
      body: JSON.stringify({ accept: true, oauth_query: trainerQuery }),
    }),
  );
  const accepted = await trainerConsent.json();
  expect(trainerConsent.ok).toBe(true);
  expect(
    (
      await tokenRequest({
        grant_type: 'authorization_code',
        code: new URL(accepted.url).searchParams.get('code')!,
        code_verifier: verifier,
        redirect_uri: 'https://client.example.test/callback',
      })
    ).status,
  ).toBe(403);
  const renewed = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
  });
  expect(renewed.ok).toBe(true);
  const fresh = await renewed.json();
  expect(fresh.refresh_token).not.toBe(tokens.refresh_token);
  const tokenRow = connection.db.select().from(oauthAccessToken).all().at(-1)!;
  connection.db
    .update(oauthAccessToken)
    .set({ expiresAt: new Date(0) })
    .where(eq(oauthAccessToken.id, tokenRow.id))
    .run();
  expect((await handleMcp(request(fresh.access_token))).status).toBe(401);
  connection.db
    .update(oauthAccessToken)
    .set({ expiresAt: tokenRow.expiresAt })
    .where(eq(oauthAccessToken.id, tokenRow.id))
    .run();
  await revokeMcpClient(ownerHeaders, { clientId: client.client_id });
  expect((await handleMcp(request(tokens.access_token))).status).toBe(401);
  expect(
    (
      await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: fresh.refresh_token,
      })
    ).ok,
  ).toBe(false);
  connection.db
    .update(oauthClient)
    .set({ disabled: false })
    .where(eq(oauthClient.clientId, client.client_id))
    .run();
  await auth.api.verifyTempoToken({ body: { token: fresh.access_token } });
  const revoked = await auth.handler(
    new Request(`${base}/api/auth/oauth2/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.client_id,
        client_secret: client.client_secret!,
        token: fresh.access_token,
      }),
    }),
  );
  expect(revoked.ok).toBe(true);
  expect((await handleMcp(request(fresh.access_token))).status).toBe(401);
  await auth.api.verifyTempoToken({ body: { token: tokens.access_token } });
  connection.db.delete(session).where(eq(session.userId, 'owner')).run();
  await auth.api.verifyTempoToken({ body: { token: tokens.access_token } });
  const afterLogout = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: fresh.refresh_token,
  });
  expect(afterLogout.ok).toBe(true);
  const independent = await afterLogout.json();
  await auth.api.verifyTempoToken({
    body: { token: independent.access_token },
  });
  await revokeMcpClient(await signIn('owner'), { clientId: client.client_id });
  expect((await handleMcp(request(independent.access_token))).status).toBe(401);
  expect(
    (
      await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: independent.refresh_token,
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await tokenRequest({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: 'https://client.example.test/callback',
      })
    ).ok,
  ).toBe(false);
}

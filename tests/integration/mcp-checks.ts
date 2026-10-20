import { expect } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { eq } from 'drizzle-orm';
import { account, session, user } from '@/server/db/schema';
import { oauthAccessToken, oauthClient } from '@/server/db/schema/oauth';
import { nutritionDays } from '@/server/db/schema/nutrition';
import { yazioDailySteps } from '@/server/db/schema/yazio-health';
import { getAnalytics } from '@/server/analytics';
import { bindMcpReader } from '@/server/auth/data-session';
import { authorize } from '@/server/auth/guards';
import { handleMcp } from '@/server/mcp/http';
import { mcpHistoryInput, mcpOutput, mcpTools } from '@/contracts/mcp';
import { readMcpData } from '@/server/mcp/data';
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
  const client = await auth.api.adminCreateOAuthClient({
    headers: ownerHeaders,
    body: {
      redirect_uris: ['https://client.example.test/callback'],
      client_name: 'Synthetic MCP',
      scope: 'tempo:read offline_access',
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'client_secret_post',
      require_pkce: true,
    },
  });
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
  const plan = workouts.createPlan('owner', {
    title: 'Synthetic plan',
    description: '',
    startsOn: '2026-10-01',
    endsOn: '2026-10-04',
    workouts: [
      {
        id: 'mcp-squat',
        date: '2026-10-01',
        title: 'Strength',
        exercises: [{ name: 'Squat', sets: [{ reps: 8, weightKg: 40 }] }],
      },
    ],
  });
  workouts.createSession('owner', {
    planId: plan.id,
    plannedWorkoutId: 'mcp-squat',
    date: '2026-10-01',
    title: 'Strength',
    status: 'completed',
    note: '',
    exercises: [{ name: 'Squat', sets: [{ reps: 6, weightKg: 45 }] }],
  });
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
      data: {
        records: [
          {
            kind: 'plan',
            exercises: [{ plannedSets: [{ reps: 8, weightKg: 40 }] }],
          },
        ],
      },
    });
    const nextWorkout = await mcp.callTool({
      name: 'get_workouts',
      arguments: {
        ...range,
        limit: 1,
        detail: 'records',
        cursor: firstWorkout.next_cursor,
      },
    });
    expect(nextWorkout.structuredContent).toMatchObject({
      next_cursor: null,
      data: {
        records: [
          {
            kind: 'session',
            exercises: [{ actualSets: [{ reps: 6, weightKg: 45 }] }],
          },
        ],
      },
    });
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
    for (const name of [
      'get_profile',
      'get_body_metrics',
      'get_activity',
      'get_workouts',
      'get_data_coverage',
    ]) {
      const result = await mcp.callTool({
        name,
        arguments: name === 'get_profile' ? {} : range,
      });
      expect(result.isError, name).toBeFalsy();
      expect(JSON.stringify(result)).not.toMatch(
        /secret|@example|storageKey|password/,
      );
    }
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
  connection.db
    .update(oauthClient)
    .set({ disabled: true })
    .where(eq(oauthClient.clientId, client.client_id))
    .run();
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
  await expect(
    auth.api.verifyTempoToken({ body: { token: tokens.access_token } }),
  ).rejects.toBeDefined();
  expect(
    (
      await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: fresh.refresh_token,
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
  let lastStatus = 0;
  for (let i = 0; i < 121 && lastStatus !== 429; i++)
    lastStatus = (await handleMcp(request())).status;
  expect(lastStatus).toBe(429);
}

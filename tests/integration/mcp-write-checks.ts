import { expect } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { eq } from 'drizzle-orm';
import {
  createMcpClient,
  listMcpClients,
  revokeMcpClient,
  updateMcpClientPermissions,
} from '@/server/mcp/clients';
import { completeMcpConsent, validMcpQuery } from '@/server/mcp/consent';
import { handleMcp } from '@/server/mcp/http';
import { mcpOutput } from '@/contracts/mcp';
import { workoutRepository } from '@/server/workouts/repository';
import { syncRepository } from '@/server/workouts/transformmate/repository';
import { publicationFor } from '@/server/workouts/transformmate/publication';
import { measurementVersion } from '@/server/measurements/version';
import { measurementRepository } from '@/server/measurements/repository';
import { offlineWriteRepository } from '@/server/offline/write-repository';
import { bindMcpPrincipal } from '@/server/auth/data-session';
import { authorize } from '@/server/auth/guards';
import { nutritionSchedule } from '@/server/db/schema/nutrition-schedule';
import { yazioBodyOutbox } from '@/server/db/schema/yazio-body';
import { PATCH as patchClient } from '@/app/api/settings/mcp/route';
import { oauthClient, oauthAccessToken } from '@/server/db/schema/oauth';

export async function assertMcpWrites(
  auth: ReturnType<(typeof import('@/server/auth'))['getAuth']>,
  connection: ReturnType<
    (typeof import('@/server/db/connection'))['openDatabase']
  >,
  ownerHeaders: Headers,
  readonlyClient: Client,
  trainerHeaders: Headers,
) {
  const previousSchedule = connection.db
    .select()
    .from(nutritionSchedule)
    .where(eq(nutritionSchedule.ownerId, 'owner'))
    .get();
  const base = 'http://localhost:3000';
  const resource = `${base}/api/mcp`;
  const callback = 'https://client.example.test/callback';
  const client = await createMcpClient(ownerHeaders, {
    name: 'Synthetic writer',
    callback,
  });
  const verifier = 'w'.repeat(64);
  async function grant(scope: string) {
    const query = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: callback,
      response_type: 'code',
      scope,
      state: randomUUID(),
      resource,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'consent',
    });
    const consent = await auth.handler(
      new Request(`${base}/api/auth/oauth2/authorize?${query}`, {
        headers: ownerHeaders,
      }),
    );
    const location =
      consent.headers.get('location') ?? (await consent.json()).url;
    const signed = new URL(location, base).search.slice(1);
    expect(await validMcpQuery(signed)).toBe(true);
    const target = await completeMcpConsent(ownerHeaders, signed, true);
    const response = await auth.handler(
      new Request(`${base}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.client_id,
          client_secret: client.client_secret,
          grant_type: 'authorization_code',
          code: new URL(target).searchParams.get('code')!,
          code_verifier: verifier,
          redirect_uri: callback,
          resource,
        }),
      }),
    );
    expect(response.ok, await response.clone().text()).toBe(true);
    return response.json();
  }
  const initial = await grant('tempo:read offline_access');
  const originalClient = connection.db
    .select()
    .from(oauthClient)
    .where(eq(oauthClient.clientId, client.client_id))
    .get()!;
  const permissions = {
    clientId: client.client_id,
    writeWorkouts: true,
    writeMeasurements: true,
  };
  await expect(
    updateMcpClientPermissions(trainerHeaders, permissions),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    updateMcpClientPermissions(ownerHeaders, {
      ...permissions,
      clientId: 'someone-elses-client',
    }),
  ).rejects.toMatchObject({ status: 404 });
  const patch = (value: unknown, origin = base) =>
    patchClient(
      new Request(`${base}/api/settings/mcp`, {
        method: 'PATCH',
        headers: new Headers({
          ...Object.fromEntries(ownerHeaders),
          origin,
          'content-type': 'application/json',
        }),
        body: JSON.stringify(value),
      }),
    );
  expect(
    (await patch(permissions, 'https://foreign.example.test')).status,
  ).toBe(403);
  expect(
    (await patch({ ...permissions, callback: 'https://foreign.example.test' }))
      .status,
  ).toBe(400);
  expect((await patch(permissions)).status).toBe(200);
  const upgradedClient = connection.db
    .select()
    .from(oauthClient)
    .where(eq(oauthClient.clientId, client.client_id))
    .get()!;
  expect(upgradedClient).toMatchObject({
    id: originalClient.id,
    clientId: originalClient.clientId,
    clientSecret: originalClient.clientSecret,
    redirectUris: originalClient.redirectUris,
    disabled: false,
  });
  expect(
    (await listMcpClients(ownerHeaders)).clients.find(
      (row) => row.clientId === client.client_id,
    )?.scopes,
  ).toEqual(
    expect.arrayContaining([
      'tempo:workouts:write',
      'tempo:measurements:write',
    ]),
  );
  expect(
    (await auth.api.verifyTempoToken({ body: { token: initial.access_token } }))
      .scopes,
  ).toEqual(['tempo:read', 'offline_access']);
  const refresh = (scope?: string) =>
    auth.handler(
      new Request(`${base}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.client_id,
          client_secret: client.client_secret,
          grant_type: 'refresh_token',
          refresh_token: initial.refresh_token,
          resource,
          ...(scope ? { scope } : {}),
        }),
      }),
    );
  expect(
    (await refresh('tempo:read offline_access tempo:workouts:write')).ok,
  ).toBe(false);
  const renewed = await refresh();
  expect(renewed.ok).toBe(true);
  const renewedTokens = await renewed.json();
  expect(
    (
      await auth.api.verifyTempoToken({
        body: { token: renewedTokens.access_token },
      })
    ).scopes,
  ).toEqual(['tempo:read', 'offline_access']);
  const oldConnection = new Client({
    name: 'before-scope-upgrade',
    version: '1',
  });
  await oldConnection.connect(
    new StreamableHTTPClientTransport(new URL(resource), {
      authProvider: { token: async () => renewedTokens.access_token },
      fetch: async (url, options) => handleMcp(new Request(url, options)),
    }),
  );
  try {
    const count = measurementRepository(connection.db).list('owner').length;
    const challenge = await oldConnection.callTool({
      name: 'create_measurement',
      arguments: {
        requestId: randomUUID(),
        data: {
          measuredAt: '2026-07-13',
          values: [{ metric: 'weight', value: '70', unit: 'kg' }],
          note: null,
        },
      },
    });
    expect(challenge).toMatchObject({
      isError: true,
      _meta: {
        'mcp/www_authenticate': [
          expect.stringContaining(
            'scope="tempo:read tempo:measurements:write"',
          ),
        ],
      },
    });
    expect(measurementRepository(connection.db).list('owner')).toHaveLength(
      count,
    );
  } finally {
    await oldConnection.close();
  }
  // Fresh consent uses the same client ID and secret; only the grant changes.
  const tokens = await grant(
    'tempo:read offline_access tempo:workouts:write tempo:measurements:write',
  );
  const headers = new Headers();
  bindMcpPrincipal(headers, () =>
    auth.api.verifyTempoToken({ body: { token: tokens.access_token } }),
  );
  expect((await authorize(headers, 'workouts:log', 'owner')).ok).toBe(true);
  expect(
    (await authorize(headers, 'measurements:write', 'someone-else')).ok,
  ).toBe(false);
  for (const permission of [
    'nutrition:write',
    'settings:manage',
    'anamnesis:read',
    'trainers:manage',
    'reports:export',
  ] as const)
    expect((await authorize(headers, permission, 'owner')).ok).toBe(false);
  const writer = new Client({ name: 'tempo-writer', version: '1.0.0' });
  await writer.connect(
    new StreamableHTTPClientTransport(new URL(resource), {
      authProvider: { token: async () => tokens.access_token },
      fetch: async (url, options) => handleMcp(new Request(url, options)),
    }),
  );
  const call = (name: string, args: Record<string, unknown>) =>
    writer.callTool({ name, arguments: args });
  const ok = async (name: string, args: Record<string, unknown>) => {
    const result = await call(name, args);
    expect(result.isError, JSON.stringify(result)).toBeFalsy();
    return mcpOutput.parse(result.structuredContent).data;
  };
  try {
    const tools = (await writer.listTools()).tools;
    expect(tools.find((t) => t.name === 'create_workout')).toMatchObject({
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    });
    expect(
      tools.find((t) => t.name === 'get_measurements')?.annotations
        ?.readOnlyHint,
    ).toBe(true);
    const exerciseId = randomUUID();
    const input = {
      requestId: randomUUID(),
      data: {
        date: '2026-07-13',
        title: 'Screenshot session',
        note: 'Historical completed',
        status: 'completed',
        exercises: [
          {
            id: exerciseId,
            name: 'Manual press',
            comment: 'Preserve',
            sets: [{ reps: 10, weightKg: 25 }],
            fatigue: 10,
            failure: 'full',
          },
        ],
      },
    };
    const count = workoutRepository(connection.db).list('owner').workouts
      .length;
    expect(
      (
        await readonlyClient.callTool({
          name: 'create_workout',
          arguments: input,
        })
      ).isError,
    ).toBe(true);
    expect(
      (await call('create_workout', { ...input, ownerId: 'trainer' })).isError,
    ).toBe(true);
    expect(
      workoutRepository(connection.db).list('owner').workouts,
    ).toHaveLength(count);
    const created = await ok('create_workout', input);
    const workout = created.workout as {
      id: string;
      revision: number;
      date: string;
    };
    const foreign = workoutRepository(connection.db).create('trainer', {
      ...input.data,
      status: 'planned',
      exercises: input.data.exercises.map((e) => ({
        name: e.name,
        sets: e.sets,
      })),
    });
    expect(
      (
        await call('update_workout', {
          requestId: randomUUID(),
          id: foreign.id,
          revision: foreign.revision,
          patch: { title: 'Foreign edit' },
        })
      ).isError,
    ).toBe(true);
    expect(
      workoutRepository(connection.db).get('trainer', foreign.id).title,
    ).toBe(input.data.title);
    expect(workout).toMatchObject({
      revision: 3,
      status: 'completed',
      exerciseCount: 1,
    });
    expect(await ok('create_workout', input)).toEqual(created);
    expect(
      workoutRepository(connection.db).list('owner').workouts,
    ).toHaveLength(count + 1);
    expect(
      (
        await call('create_workout', {
          ...input,
          data: { ...input.data, title: 'Changed retry' },
        })
      ).isError,
    ).toBe(true);
    const saved = workoutRepository(connection.db).get('owner', workout.id);
    const link = syncRepository(connection.db)
      .list('owner')
      .find((link) => link.workoutId === workout.id)!;
    expect(link.state.lifecycle).toMatchObject({
      status: 'completed',
      historicalTimeUnknown: true,
    });
    expect(link.state.lifecycle?.startedAt).toBeTruthy();
    expect(link.state.lifecycle?.finishedAt).toBeTruthy();
    expect(link.state.published).toBeFalsy();
    expect(link.state.attempted).toBe(false);
    expect(JSON.stringify(publicationFor(saved))).not.toMatch(
      /fatigue|failure/,
    );
    const details = await ok('get_workout', {
      workoutRef: { kind: 'workout', id: workout.id, date: workout.date },
    });
    expect(details).toMatchObject({
      revision: 3,
      note: 'Historical completed',
    });
    expect(details.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId,
          comment: 'Preserve',
          fatigue: 10,
          failure: 'full',
        }),
      ]),
    );
    expect(
      (
        await call('update_workout', {
          requestId: randomUUID(),
          id: workout.id,
          revision: 3,
          patch: { title: 'Cannot edit completed' },
        })
      ).isError,
    ).toBe(true);
    const feedbackInput = {
      requestId: randomUUID(),
      id: workout.id,
      revision: 3,
      feedback: { exerciseId, fatigue: 8, failure: 'partial' },
    };
    const feedback = await ok('update_exercise_feedback', feedbackInput);
    expect(await ok('update_exercise_feedback', feedbackInput)).toEqual(
      feedback,
    );
    expect(
      (
        await call('update_exercise_feedback', {
          ...feedbackInput,
          requestId: randomUUID(),
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await call('update_exercise_feedback', {
          ...feedbackInput,
          requestId: randomUUID(),
          revision: 4,
          feedback: { ...feedbackInput.feedback, sets: [] },
        })
      ).isError,
    ).toBe(true);
    expect(
      syncRepository(connection.db)
        .list('owner')
        .find((item) => item.id === link.id),
    ).toEqual(link);
    await ok('transition_workout', {
      requestId: randomUUID(),
      id: workout.id,
      revision: 4,
      action: 'resume',
    });
    const patch = {
      requestId: randomUUID(),
      id: workout.id,
      revision: 5,
      patch: {
        title: 'Corrected',
        exercises: [
          { id: exerciseId, sets: [{ reps: 12, weightKg: 25 }] },
          { name: 'Added', sets: [{ reps: 8, weightKg: null }] },
        ],
      },
    };
    const updated = await ok('update_workout', patch);
    expect(updated).toMatchObject({
      workout: { revision: 6, exerciseCount: 2 },
    });
    expect(
      workoutRepository(connection.db).get('owner', workout.id),
    ).toMatchObject({
      note: 'Historical completed',
      exercises: [
        {
          id: exerciseId,
          name: 'Manual press',
          comment: 'Preserve',
          fatigue: 8,
          failure: 'partial',
          sets: [{ reps: 12, weightKg: 25 }],
        },
        { name: 'Added' },
      ],
    });
    expect(await ok('update_workout', patch)).toEqual(updated);
    expect(
      (await call('update_workout', { ...patch, requestId: randomUUID() }))
        .isError,
    ).toBe(true);
    await ok('update_workout', {
      requestId: randomUUID(),
      id: workout.id,
      revision: 6,
      patch: { note: 'Keep exercises' },
    });
    expect(
      workoutRepository(connection.db).get('owner', workout.id).exercises,
    ).toHaveLength(2);
    await ok('transition_workout', {
      requestId: randomUUID(),
      id: workout.id,
      revision: 7,
      action: 'complete',
    });
    expect(
      syncRepository(connection.db)
        .list('owner')
        .find((item) => item.id === link.id)?.state.lifecycle
        ?.historicalTimeUnknown,
    ).toBe(true);
    // Failed completed creation rolls back record, outbox and receipt together.
    expect(
      (
        await call('create_workout', {
          requestId: randomUUID(),
          data: { ...input.data, exercises: [] },
        })
      ).isError,
    ).toBe(true);
    expect(
      workoutRepository(connection.db).list('owner').workouts,
    ).toHaveLength(count + 1);
    connection.db
      .insert(nutritionSchedule)
      .values({ ownerId: 'owner', enabled: true, epoch: 0 })
      .onConflictDoUpdate({
        target: nutritionSchedule.ownerId,
        set: { enabled: true },
      })
      .run();
    // A valid existing workout can exceed the HTTP response limit. Writes still acknowledge and replay successfully.
    const repository = workoutRepository(connection.db);
    let large = repository.create('owner', {
      ...input.data,
      status: 'planned',
      exercises: Array.from({ length: 20 }, (_, i) => ({
        name: `Large exercise ${i}`,
        comment: 'x'.repeat(4000),
        sets: [{ reps: 10, weightKg: 25 }],
      })),
    });
    large = repository.update(
      'owner',
      large.id,
      large.revision,
      {
        date: large.date,
        title: large.title,
        note: large.note,
        status: 'in_progress',
        exercises: large.exercises,
      },
      'start',
    );
    large = repository.update(
      'owner',
      large.id,
      large.revision,
      {
        date: large.date,
        title: large.title,
        note: large.note,
        status: 'completed',
        exercises: large.exercises,
      },
      'complete',
    );
    expect(Buffer.byteLength(JSON.stringify(large))).toBeGreaterThan(64000);
    const largeFeedback = {
      requestId: randomUUID(),
      id: large.id,
      revision: large.revision,
      feedback: {
        exerciseId: large.exercises[0]!.id!,
        fatigue: 7,
        failure: 'none',
      },
    };
    const acknowledgement = await ok('update_exercise_feedback', largeFeedback);
    expect(acknowledgement).toMatchObject({
      workout: {
        id: large.id,
        revision: 4,
        status: 'completed',
        exerciseCount: 20,
      },
      details: { tool: 'get_workout' },
    });
    expect(Buffer.byteLength(JSON.stringify(acknowledgement))).toBeLessThan(
      2048,
    );
    expect(await ok('update_exercise_feedback', largeFeedback)).toEqual(
      acknowledgement,
    );
    const readback = acknowledgement.details as {
      arguments: Record<string, unknown>;
    };
    expect(await ok('get_workout', readback.arguments)).toMatchObject({
      revision: 4,
      records: [
        { exerciseId: large.exercises[0]!.id!, fatigue: 7, failure: 'none' },
      ],
    });
    const resumeLarge = {
      requestId: randomUUID(),
      id: large.id,
      revision: 4,
      action: 'resume',
    };
    const resumed = await ok('transition_workout', resumeLarge);
    expect(resumed).toMatchObject({
      workout: { revision: 5, status: 'in_progress' },
    });
    expect(await ok('transition_workout', resumeLarge)).toEqual(resumed);
    const measurementInput = {
      requestId: randomUUID(),
      data: {
        measuredAt: '2026-07-13',
        values: [{ metric: 'weight', value: '70.5', unit: 'kg' }],
        note: 'Saved through MCP',
      },
    };
    expect(
      (
        await readonlyClient.callTool({
          name: 'create_measurement',
          arguments: measurementInput,
        })
      ).isError,
    ).toBe(true);
    const measurement = (await ok('create_measurement', measurementInput))
      .measurement as { id: string; version: string; sync: unknown[] };
    expect(measurement.sync).toHaveLength(1);
    expect(connection.db.select().from(yazioBodyOutbox).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ownerId: 'owner',
          value: '70.5',
        }),
      ]),
    );
    expect(await ok('create_measurement', measurementInput)).toEqual({
      source: 'LOCAL',
      measurement,
    });
    expect(measurement.version).toBe(
      measurementVersion(
        measurementRepository(connection.db).find('owner', measurement.id)!,
      ),
    );
    const catalog = offlineWriteRepository(connection).catalog('owner');
    expect(catalog.find((row) => row.id === measurement.id)?.version).toBe(
      measurement.version,
    );
    expect(
      await ok('get_measurements', { from: '2026-07-13', to: '2026-07-13' }),
    ).toMatchObject({
      records: [
        {
          id: measurement.id,
          version: measurement.version,
          source: 'LOCAL',
          editable: true,
          note: 'Saved through MCP',
        },
      ],
    });
    const measurementPatch = {
      requestId: randomUUID(),
      id: measurement.id,
      version: measurement.version,
      data: {
        ...measurementInput.data,
        values: [{ metric: 'weight', value: '71', unit: 'kg' }],
      },
    };
    const changed = await ok('update_measurement', measurementPatch);
    expect(await ok('update_measurement', measurementPatch)).toEqual(changed);
    expect(
      (
        await call('update_measurement', {
          ...measurementPatch,
          requestId: randomUUID(),
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await call('update_measurement', {
          ...measurementPatch,
          requestId: randomUUID(),
          id: randomUUID(),
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await call('create_measurement', {
          ...measurementInput,
          data: { ...measurementInput.data, note: 'Changed' },
        })
      ).isError,
    ).toBe(true);
    // Each write scope independently gates operations, regardless of discovery.
    const issued = connection.db
      .select()
      .from(oauthAccessToken)
      .where(eq(oauthAccessToken.clientId, client.client_id))
      .all()
      .find((token) => token.scopes.includes('tempo:workouts:write'))!;
    connection.db
      .update(oauthAccessToken)
      .set({ scopes: ['tempo:read', 'tempo:measurements:write'] })
      .where(eq(oauthAccessToken.id, issued.id))
      .run();
    expect(
      (await call('create_workout', { ...input, requestId: randomUUID() }))
        .isError,
    ).toBe(true);
    await ok('create_measurement', {
      ...measurementInput,
      requestId: randomUUID(),
    });
    connection.db
      .update(oauthAccessToken)
      .set({ scopes: ['tempo:read', 'tempo:workouts:write'] })
      .where(eq(oauthAccessToken.id, issued.id))
      .run();
    expect(
      (
        await call('create_measurement', {
          ...measurementInput,
          requestId: randomUUID(),
        })
      ).isError,
    ).toBe(true);
    await ok('update_exercise_feedback', {
      ...feedbackInput,
      requestId: randomUUID(),
      revision: 8,
    });
    connection.db
      .update(oauthAccessToken)
      .set({ scopes: issued.scopes })
      .where(eq(oauthAccessToken.id, issued.id))
      .run();
    await updateMcpClientPermissions(ownerHeaders, {
      clientId: client.client_id,
      writeWorkouts: false,
      writeMeasurements: true,
    });
    expect((await authorize(headers, 'workouts:log', 'owner')).ok).toBe(false);
    expect((await authorize(headers, 'measurements:write', 'owner')).ok).toBe(
      true,
    );
    const disabled = await call('create_workout', {
      ...input,
      requestId: randomUUID(),
    });
    expect(disabled.isError).toBe(true);
    expect(disabled._meta?.['mcp/www_authenticate']).toBeUndefined();
    expect((await authorize(headers, 'workouts:read', 'owner')).ok).toBe(true);
    connection.db
      .update(oauthClient)
      .set({ disabled: true })
      .where(eq(oauthClient.clientId, client.client_id))
      .run();
    expect(
      (
        await handleMcp(
          new Request(resource, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${tokens.access_token}`,
              'content-type': 'application/json',
            },
            body: '{}',
          }),
        )
      ).status,
    ).toBe(401);
  } finally {
    if (previousSchedule)
      connection.db
        .update(nutritionSchedule)
        .set(previousSchedule)
        .where(eq(nutritionSchedule.ownerId, 'owner'))
        .run();
    else
      connection.db
        .delete(nutritionSchedule)
        .where(eq(nutritionSchedule.ownerId, 'owner'))
        .run();
    await writer.close();
    await revokeMcpClient(ownerHeaders, { clientId: client.client_id });
  }
}

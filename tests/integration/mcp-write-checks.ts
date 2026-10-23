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
import { oauthClient, oauthAccessToken } from '@/server/db/schema/oauth';

export async function assertMcpWrites(
  auth: ReturnType<(typeof import('@/server/auth'))['getAuth']>,
  connection: ReturnType<
    (typeof import('@/server/db/connection'))['openDatabase']
  >,
  ownerHeaders: Headers,
  readonlyClient: Client,
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
    writeWorkouts: true,
    writeMeasurements: true,
  });
  const row = (await listMcpClients(ownerHeaders)).clients.find(
    (row) => row.clientId === client.client_id,
  )!;
  expect(row.scopes).toEqual(
    expect.arrayContaining([
      'tempo:workouts:write',
      'tempo:measurements:write',
    ]),
  );
  const verifier = 'w'.repeat(64);
  const query = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: callback,
    response_type: 'code',
    scope:
      'tempo:read offline_access tempo:workouts:write tempo:measurements:write',
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
  const tokens = await response.json();
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
      exercises: { id: string; fatigue: number }[];
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
      exercises: [{ id: exerciseId, fatigue: 10, failure: 'full' }],
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
    expect(link.state.lifecycle?.status).toBe('completed');
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
      workout: {
        revision: 6,
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
      },
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
      .get()!;
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

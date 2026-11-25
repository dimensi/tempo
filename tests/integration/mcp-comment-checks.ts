import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { expect } from 'vitest';
import type { Client } from '@modelcontextprotocol/client';
import { mcpCommentsInput, mcpOutput } from '@/contracts/mcp';
import { authorize } from '@/server/auth/guards';
import { comments } from '@/server/db/schema/comments';
import { measurementRepository } from '@/server/measurements/repository';
import { readMcpComments } from '@/server/mcp/comments';
import { createComment } from '@/server/comments/service';

/** Extends real-OAuth coverage without adding another integration test case. */
export async function assertCommentTools(
  client: Client,
  connection: ReturnType<
    (typeof import('@/server/db/connection'))['openDatabase']
  >,
  headers: Headers,
  trainerHeaders: Headers,
  workout: { id: string; date: string },
) {
  const repository = measurementRepository(connection.db);
  const measurement = repository.create('owner', {
    measuredAt: workout.date,
    values: [{ metric: 'waist', value: '81', unit: 'cm' }],
    note: null,
  });
  const target = { type: 'workout' as const, id: workout.id };
  const published = Date.parse('2026-11-24T15:00:00Z');
  const rootId = randomUUID();
  const rows = [
    {
      id: rootId,
      targetType: 'workout' as const,
      targetId: workout.id,
      authorId: 'trainer',
      body: 'Снизь вес в последнем подходе.',
      parentId: null,
    },
    {
      id: randomUUID(),
      targetType: 'workout' as const,
      targetId: workout.id,
      authorId: 'owner',
      body: 'Хорошо, учту.',
      parentId: rootId,
    },
    {
      id: randomUUID(),
      targetType: 'measurement' as const,
      targetId: measurement.id,
      authorId: 'trainer',
      body: 'Замер утром.',
      parentId: null,
    },
    {
      id: randomUUID(),
      targetType: 'nutrition_day' as const,
      targetId: workout.date,
      authorId: 'owner',
      body: 'После тренировки.',
      parentId: null,
    },
  ].map((row, index) => ({
    ...row,
    ownerId: 'owner',
    createdAt: published + index,
    updatedAt: published + index + 1000,
  }));
  const foreign = {
    ...rows[0]!,
    id: randomUUID(),
    ownerId: 'trainer',
    body: 'Private foreign discussion',
  };
  connection.db
    .insert(comments)
    .values([...rows, foreign])
    .run();
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBeFalsy();
    return mcpOutput.parse(result.structuredContent);
  };
  const hint = {
    count: 2,
    details: { tool: 'get_comments', arguments: { target } },
  };
  try {
    const range = { from: workout.date, to: workout.date };
    const listed = await call('get_workouts', range);
    expect(listed.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: workout.id, comments: hint }),
      ]),
    );
    const detail = await call('get_workout', {
      workoutRef: { kind: 'workout', ...workout },
    });
    expect(detail.data.comments).toEqual(hint);
    const first = await call('get_comments', { target, limit: 1 });
    expect(first.data).toMatchObject({
      total: 2,
      records: [
        {
          id: rootId,
          target,
          authorId: 'trainer',
          authorName: 'trainer',
          body: rows[0]!.body,
          parentId: null,
          createdAt: new Date(published).toISOString(),
          updatedAt: new Date(published + 1000).toISOString(),
        },
      ],
    });
    expect(first.data.records).toHaveLength(1);
    expect(first.next_cursor).toEqual(expect.any(String));
    const reply = await call('get_comments', {
      target,
      limit: 1,
      cursor: first.next_cursor,
    });
    expect(reply).toMatchObject({
      next_cursor: null,
      data: {
        total: 2,
        records: [
          {
            id: rows[1]!.id,
            authorId: 'owner',
            authorName: 'owner',
            parentId: rootId,
            body: rows[1]!.body,
            createdAt: new Date(published + 1).toISOString(),
          },
        ],
      },
    });
    const all = await call('get_comments', {});
    expect(all.data.total).toBe(4);
    expect((all.data.records as { id: string }[]).map((row) => row.id)).toEqual(
      rows.map((row) => row.id),
    );
    expect(JSON.stringify(all)).not.toContain(foreign.body);
    const measurementTarget = { type: 'measurement', id: measurement.id };
    const measured = await call('get_measurements', range);
    expect(measured.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: measurement.id,
          comments: {
            count: 1,
            details: {
              tool: 'get_comments',
              arguments: { target: measurementTarget },
            },
          },
        }),
      ]),
    );
    expect(
      (await call('get_comments', { target: measurementTarget })).data,
    ).toMatchObject({ total: 1, records: [{ id: rows[2]!.id }] });
    const body = await call('get_body_metrics', range);
    expect(body.data).toMatchObject({
      comments: {
        count: 1,
        details: { tool: 'get_measurements', arguments: range },
      },
      metrics: {
        waist: { first: { id: measurement.id, comments: { count: 1 } } },
      },
    });
    const daily = await call('get_body_metrics', { ...range, detail: 'daily' });
    expect(daily.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: measurement.id,
          comments: {
            count: 1,
            details: {
              tool: 'get_comments',
              arguments: { target: measurementTarget },
            },
          },
        }),
      ]),
    );
    expect(
      (
        await call('get_comments', {
          target: { type: 'workout', id: randomUUID() },
        })
      ).data,
    ).toMatchObject({ total: 0, records: [] });
    expect(
      await client.callTool({
        name: 'get_comments',
        arguments: { cursor: first.next_cursor, target: measurementTarget },
      }),
    ).toMatchObject({ isError: true, content: [{ text: 'invalid_cursor' }] });
    expect(
      await client.callTool({
        name: 'get_comments',
        arguments: { ownerId: 'trainer' },
      }),
    ).toMatchObject({ isError: true });
    await expect(
      readMcpComments(headers, 'trainer', mcpCommentsInput.parse({ target })),
    ).rejects.toMatchObject({ code: 'access_denied' });
    await expect(
      readMcpComments(
        trainerHeaders,
        'owner',
        mcpCommentsInput.parse({ target }),
      ),
    ).rejects.toMatchObject({ code: 'access_denied' });
    expect((await authorize(headers, 'comments:write', 'owner')).ok).toBe(
      false,
    );
    await expect(
      createComment(headers, { ownerId: 'owner', target, body: 'Denied' }),
    ).rejects.toMatchObject({ status: 403 });
  } finally {
    connection.db
      .delete(comments)
      .where(
        inArray(
          comments.id,
          [...rows, foreign].map((row) => row.id),
        ),
      )
      .run();
    repository.remove('owner', measurement.id);
  }
}

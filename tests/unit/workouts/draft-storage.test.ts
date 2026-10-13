import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  readWorkoutDraft,
  storeWorkoutDraft,
  clearWorkoutDrafts,
} from '@/features/workouts/draft-storage';

const identity = 'actor:owner';
const key = `workout-draft:${identity}:session:new:date`;
const requestId = '00000000-0000-4000-8000-000000000001';
const schema = z.object({ text: z.string() }).strict();
let memory: Record<string, string>;
beforeEach(() => {
  memory = {};
  const storage = new Proxy(
    {
      getItem: (name: string) => memory[name] ?? null,
      setItem: (name: string, value: string) => {
        memory[name] = value;
      },
      removeItem: (name: string) => {
        delete memory[name];
      },
    },
    {
      ownKeys: () => Object.keys(memory),
      getOwnPropertyDescriptor: () => ({
        enumerable: true,
        configurable: true,
      }),
    },
  );
  vi.stubGlobal('sessionStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());
describe('bounded authenticated workout drafts', () => {
  it('restores exact resource data and request identity while retaining another draft kind', () => {
    expect(storeWorkoutDraft(key, requestId, { text: 'private' })).toBe(true);
    const plan = `workout-draft:${identity}:plan:revision2`;
    storeWorkoutDraft(plan, requestId, { other: 'plan' });
    expect(readWorkoutDraft(key, identity, schema)?.requestId).toBe(requestId);
    expect(readWorkoutDraft(key, identity, schema)?.value).toEqual({
      text: 'private',
    });
    expect(memory[plan]).toBeDefined();
    expect(
      readWorkoutDraft(`${key}:another-revision`, identity, schema),
    ).toBeNull();
  });
  it('purges malformed, expired and foreign-actor drafts without touching other storage', () => {
    memory['theme'] = 'dark';
    memory['workout-draft:foreign:owner:session'] = '{}';
    memory[key] = JSON.stringify({
      savedAt: Date.now() - 13 * 60 * 60 * 1000,
      requestId,
      value: { text: 'expired' },
    });
    memory[`workout-draft:${identity}:broken`] = 'invalid';
    expect(readWorkoutDraft(key, identity, schema)).toBeNull();
    expect(memory).toEqual({ theme: 'dark' });
  });
  it('caps count and oversized data rather than claiming persistence', () => {
    for (let index = 0; index < 12; index++)
      storeWorkoutDraft(`${key}:${index}`, requestId, { text: 'x' });
    expect(Object.keys(memory)).toHaveLength(8);
    expect(
      storeWorkoutDraft(key, requestId, { text: 'x'.repeat(256_000) }),
    ).toBe(false);
    expect(memory[key]).toBeUndefined();
  });
  it('handles disabled storage for read, write and privacy cleanup', () => {
    vi.stubGlobal('sessionStorage', {
      getItem() {
        throw Error('disabled');
      },
      setItem() {
        throw Error('disabled');
      },
      removeItem() {
        throw Error('disabled');
      },
    });
    expect(storeWorkoutDraft(key, requestId, { text: 'x' })).toBe(false);
    expect(readWorkoutDraft(key, identity, schema)).toBeNull();
    expect(() => clearWorkoutDrafts()).not.toThrow();
  });
});

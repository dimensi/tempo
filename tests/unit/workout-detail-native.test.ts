import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { openDatabase } from '@/server/db/connection';
import { nativeRepository } from '@/server/workouts/transformmate/native-repository';
import type { TransformMateNativeSnapshot } from '@/contracts/transformmate-native';

const snapshot: TransformMateNativeSnapshot = {
  source: 'transformmate',
  remoteTrainingId: 7,
  date: '2026-10-13',
  title: 'Native workout',
  progress: 'completed',
  started: null,
  finished: null,
  remoteUpdatedAt: '2026-10-13T12:00:00Z',
  exercises: [],
};
describe('readonly native workout detail', () => {
  it('fences an identical provider ID by owner and connected account', () => {
    const { db, sqlite } = openDatabase('file::memory:');
    try {
      sqlite.exec(`CREATE TABLE workout_transformmate_native (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, account_scope TEXT NOT NULL,
        remote_training_id INTEGER NOT NULL, date TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
        snapshot TEXT NOT NULL, fetched_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(owner_id, account_scope, remote_training_id));`);
      const repository = nativeRepository(db);
      const account = 'a'.repeat(64),
        otherAccount = 'b'.repeat(64);
      repository.save('owner', account, snapshot, '2026-10-13T12:00:00Z');
      repository.save(
        'other',
        account,
        { ...snapshot, title: 'Other owner' },
        '2026-10-13T12:00:00Z',
      );
      repository.save(
        'owner',
        otherAccount,
        { ...snapshot, title: 'Old account' },
        '2026-10-13T12:00:00Z',
      );
      expect(repository.get('owner', account, 7)?.title).toBe('Native workout');
      expect(repository.get('owner', otherAccount, 7)?.title).toBe(
        'Old account',
      );
      expect(repository.get('other', account, 7)?.title).toBe('Other owner');
      expect(repository.get('unknown', account, 7)).toBeNull();
      expect(repository.get('owner', account, 8)).toBeNull();
      expect(() => repository.get('owner', account, NaN)).toThrow();
      expect(
        sqlite
          .prepare('SELECT revision FROM workout_transformmate_native')
          .all(),
      ).toEqual([{ revision: 1 }, { revision: 1 }, { revision: 1 }]);
    } finally {
      sqlite.close();
    }
  });
});

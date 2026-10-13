import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectAreas, areas } from '../../scripts/ci/selection.mjs';
test('missing history and unknown/core paths retain all targeted gates', () => {
  for (const paths of [
    undefined,
    [],
    ['new-runtime-file.ts'],
    ['src/server/auth/index.ts'],
    ['drizzle/0001.sql'],
    ['src/components/shared/button.tsx'],
    ['src/lib/offline-device.ts'],
    ['src/contracts/offline.ts'],
    ['src/app/offline-application.tsx'],
    ['.github/workflows/ci.yml'],
  ])
    assert.deepEqual(selectAreas(paths).areas, areas);
});
test('explicit manual full preserves exhaustive mode independent of paths', () =>
  assert.deepEqual(selectAreas(['README.md'], 'full'), {
    mode: 'full',
    areas,
    reason: 'Explicit manual full regression',
  }));
test('known docs retain mandatory smoke; known feature paths select their providers', () => {
  assert.deepEqual(selectAreas(['docs/deployment.md']).areas, []);
  assert.deepEqual(selectAreas(['src/features/workouts/editor.tsx']).areas, [
    'workouts',
    'providers',
  ]);
  assert.deepEqual(selectAreas(['src/server/yazio/index.ts']).areas, [
    'nutrition',
    'providers',
  ]);
  assert.deepEqual(
    selectAreas(['src/features/offline/controller.ts']).areas,
    areas,
  );
});

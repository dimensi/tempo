import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
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
test('existing E2E spec paths have explicit area or crosscutting classification', () => {
  const files = readdirSync(new URL('../e2e/', import.meta.url)).filter(
    (file) => file.endsWith('.spec.ts'),
  );
  for (const file of files) {
    const selection = selectAreas([`tests/e2e/${file}`]);
    assert.doesNotMatch(selection.reason, /Core or unclassified/, file);
  }
});
test('exact test aliases scope settings and feature specs without matching future unknown names', () => {
  assert.deepEqual(
    selectAreas(['tests/e2e/settings-navigation.spec.ts']).areas,
    ['shell'],
  );
  assert.deepEqual(
    selectAreas(['tests/e2e/trainer-navigation.spec.ts']).areas,
    ['shell'],
  );
  assert.deepEqual(selectAreas(['tests/e2e/comment-ui.spec.ts']).areas, [
    'comments',
  ]);
  assert.deepEqual(selectAreas(['tests/e2e/diary-photos.spec.ts']).areas, [
    'nutrition',
    'providers',
  ]);
  assert.deepEqual(
    selectAreas(['tests/e2e/overview-nutrition-chart.spec.ts']).areas,
    ['nutrition', 'providers'],
  );
  assert.deepEqual(selectAreas(['tests/e2e/transformmate-ui.spec.ts']).areas, [
    'workouts',
    'providers',
  ]);
  assert.deepEqual(selectAreas(['tests/e2e/steps-goal.spec.ts']).areas, [
    'measurements',
    'reports',
    'shell',
  ]);
  assert.deepEqual(
    selectAreas(['tests/e2e/settings-future.spec.ts']).areas,
    areas,
  );
  assert.deepEqual(
    selectAreas([
      'tests/e2e/settings-navigation.spec.ts',
      'src/server/auth/index.ts',
    ]).areas,
    areas,
  );
});
test('crosscutting specs explicitly retain broad relevant coverage', () => {
  for (const file of [
    'foundation',
    'mobile-inputs',
    'health',
    'overview',
    'collaboration',
    'invite-accept',
  ]) {
    const selection = selectAreas([`tests/e2e/${file}.spec.ts`]);
    assert.deepEqual(selection.areas, areas);
    assert.match(selection.reason, /Crosscutting E2E spec/);
  }
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

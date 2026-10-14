import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserPlan } from '../../scripts/ci/browser-plan.mjs';
import { selectAreas } from '../../scripts/ci/selection.mjs';

for (const paths of [
  undefined,
  [],
  ['src/server/auth/index.ts'],
  ['future/shared-module.ts'],
]) {
  test(`broad relevant coverage for ${JSON.stringify(paths)}`, () => {
    const plan = browserPlan(selectAreas(paths));
    assert.deepEqual(
      plan.map((run) => run.family),
      [
        'isolation',
        'smoke',
        'general',
        'offline',
        'nutrition',
        'nutrition-connection',
        'transformmate',
      ],
    );
    const general = plan.find((run) => run.family === 'general');
    assert.equal(general.files, undefined);
    assert.match(general.grepInvert, /session throttle/);
    assert.equal(plan[1].requiredCases.length, 3);
  });
}
test('unknown future area mapping never silently omits its gates', () => {
  assert.equal(
    browserPlan({ mode: 'selected', areas: ['future-area'] }).length,
    7,
  );
});
test('full keeps genuine auth wait; selected measurements include every mapped spec on both configured viewports', () => {
  const full = browserPlan(selectAreas([], 'full')).find(
    (run) => run.family === 'general',
  );
  assert.equal(full.grepInvert, undefined);
  assert.equal(full.files, undefined);
  const targeted = browserPlan(
    selectAreas(['src/features/measurements/form.tsx']),
  );
  assert.deepEqual(
    targeted.map((run) => run.family),
    ['isolation', 'smoke', 'general'],
  );
  assert.deepEqual(targeted[2].files, ['measurements.spec.ts']);
});

for (const path of [
  'src/features/anamnesis/documents-panel.tsx',
  'src/server/anamnesis/worker.ts',
  'src/app/api/anamnesis/documents/route.ts',
  'src/app/(dashboard)/anamnesis/page.tsx',
  'tests/e2e/anamnesis.spec.ts',
]) {
  test(`Anamnesis mapping retains all spec cases and mandatory smoke: ${path}`, () => {
    const plan = browserPlan(selectAreas([path]));
    assert.deepEqual(
      plan.map((run) => run.family),
      ['isolation', 'smoke', 'general'],
    );
    assert.deepEqual(plan[2].files, ['anamnesis.spec.ts']);
  });
}
test('shared object storage keeps broad coverage including new Anamnesis tests', () => {
  const selection = selectAreas(['src/server/storage/fs.ts']);
  assert.ok(selection.areas.includes('anamnesis'));
  assert.equal(
    browserPlan(selection).find((run) => run.family === 'general').files,
    undefined,
  );
});

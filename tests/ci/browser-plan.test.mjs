import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { browserPlan } from '../../scripts/ci/browser-plan.mjs';
import { selectAreas } from '../../scripts/ci/selection.mjs';

test('video test changes select and execute the video browser spec', () => {
  const selection = selectAreas(['tests/e2e/workout-videos.spec.ts']);
  assert.deepEqual(selection.areas, ['workouts', 'providers']);
  const general = browserPlan(selection).find(
    (run) => run.family === 'general',
  );
  assert.ok(general.files.includes('workout-videos.spec.ts'));
});

test('settings test path retains mandatory gates and the complete shell section', () => {
  const plan = browserPlan(
    selectAreas(['tests/e2e/settings-navigation.spec.ts']),
  );
  assert.deepEqual(
    plan.map((run) => run.family),
    ['isolation', 'smoke', 'general'],
  );
  assert.deepEqual(plan[2].files, [
    'foundation.spec.ts',
    'health.spec.ts',
    'mobile-inputs.spec.ts',
    'trainer-navigation.spec.ts',
    'settings-navigation.spec.ts',
    'invite-accept.spec.ts',
  ]);
  assert.equal(plan[1].requiredCases.length, 3);
});

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
  assert.deepEqual(targeted[2].files, [
    'measurements.spec.ts',
    'steps-goal.spec.ts',
  ]);
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

test('full and offline gates require real enumerated cases after shell retirement', () => {
  const listed = new Map();
  for (const selection of [
    { mode: 'full', areas: [] },
    { mode: 'selected', areas: ['offline'] },
  ]) {
    for (const run of browserPlan(selection).filter((run) =>
      ['smoke', 'offline'].includes(run.family),
    )) {
      if (!listed.has(run.config))
        listed.set(
          run.config,
          JSON.parse(
            execFileSync(
              'pnpm',
              [
                'exec',
                'playwright',
                'test',
                '--config',
                run.config,
                '--list',
                '--reporter=json',
              ],
              { encoding: 'utf8' },
            ),
          ),
        );
      const report = listed.get(run.config);
      assert.equal(report.errors?.length ?? 0, 0);
      const specs = [];
      const visit = (suites) => {
        for (const suite of suites ?? []) {
          specs.push(...(suite.specs ?? []));
          visit(suite.suites);
        }
      };
      visit(report.suites);
      assert.ok(specs.length);
      for (const requirement of run.requiredCases) {
        const { pattern, project } =
          typeof requirement === 'string'
            ? { pattern: requirement }
            : requirement;
        const cases = specs
          .filter((spec) => new RegExp(pattern).test(spec.title))
          .flatMap((spec) => spec.tests)
          .filter((test) => !project || test.projectName === project);
        assert.ok(
          cases.length,
          `${selection.mode} ${run.family}: missing ${pattern}`,
        );
      }
    }
  }
});

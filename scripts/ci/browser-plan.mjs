export function browserPlan(selection) {
  const general = {
    nutrition: ['diary.*spec.ts', 'overview.*spec.ts'],
    workouts: [
      'workouts.spec.ts',
      'workout-videos.spec.ts',
      'transformmate.*spec.ts',
    ],
    measurements: ['measurements.spec.ts', 'steps-goal.spec.ts'],
    analytics: ['analytics.spec.ts'],
    anamnesis: ['anamnesis.spec.ts'],
    reports: ['reports.*spec.ts'],
    comments: ['comment-ui.spec.ts', 'collaboration.spec.ts'],
    shell: [
      'foundation.spec.ts',
      'health.spec.ts',
      'mobile-inputs.spec.ts',
      'trainer-navigation.spec.ts',
      'settings-navigation.spec.ts',
      'invite-accept.spec.ts',
    ],
  };
  const slowAuth =
    'real authenticated session throttle is retried once after its server interval';
  const knownAreas = [...Object.keys(general), 'offline', 'providers'];
  if (selection.areas.some((area) => !knownAreas.includes(area)))
    selection = { ...selection, areas: knownAreas };
  const runs = [
    {
      family: 'isolation',
      config: 'tests/ci/isolation.config.ts',
      isolated: true,
    },
    {
      family: 'smoke',
      isolated: true,
      config: 'tests/smoke/production.config.ts',
      requiredCases: [
        'production real login',
        'account replacement clears the previous reader and notifies the other tab',
        'two foreground tabs send one durable operation once after reconnect',
      ],
    },
  ];
  if (selection.mode === 'full') {
    runs.push({
      family: 'general',
      config: 'playwright.config.ts',
      isolated: true,
    });
  } else {
    const files = [
      ...new Set(selection.areas.flatMap((area) => general[area] ?? [])),
    ];
    if (files.length)
      runs.push({
        family: 'general',
        config: 'playwright.config.ts',
        ...(Object.keys(general).every((area) => selection.areas.includes(area))
          ? {}
          : { files }),
        grepInvert: slowAuth,
        isolated: true,
      });
  }
  if (selection.mode === 'full' || selection.areas.includes('offline'))
    runs.push({
      family: 'offline',
      isolated: true,
      config: 'tests/offline/production.config.ts',
      requiredCases: [
        {
          pattern:
            'normal login and logout do not install or wait for an offline shell',
          project: 'desktop',
        },
      ],
    });
  if (selection.mode === 'full' || selection.areas.includes('providers')) {
    runs.push({
      family: 'nutrition',
      config: 'tests/nutrition-sync/e2e.config.ts',
    });
    runs.push({
      family: 'nutrition-connection',
      vitest: true,
      config: 'tests/ci/yazio.config.ts',
    });
    runs.push({
      family: 'transformmate',
      config: 'tests/transformmate-sync/e2e.config.ts',
      requiredCases: [
        {
          pattern: 'owned preview negative requests coalesce',
          project: 'desktop',
        },
      ],
    });
  }

  return runs;
}

export function browserPlan(selection) {
  const general = {
    nutrition: ['diary.*spec.ts', 'overview.*spec.ts'],
    workouts: ['workouts.spec.ts', 'transformmate.*spec.ts'],
    measurements: ['measurements.spec.ts'],
    analytics: ['analytics.spec.ts'],
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
        'two tabs hide private DOM',
        'refill holds a shared lock',
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
      config: 'tests/offline/production.config.ts',
      requiredCases: [
        { pattern: 'held initial offline install', project: 'desktop' },
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

export const areas = [
  'nutrition',
  'workouts',
  'measurements',
  'analytics',
  'anamnesis',
  'reports',
  'comments',
  'offline',
  'providers',
  'shell',
];
// Exact aliases for existing specs whose names differ from their feature area.
const testAliases = {
  'workout-videos.spec.ts': ['workouts', 'providers'],
  'settings-navigation.spec.ts': ['shell'],
  'trainer-navigation.spec.ts': ['shell'],
  'comment-ui.spec.ts': ['comments'],
  'diary.spec.ts': ['nutrition', 'providers'],
  'diary-navigation.spec.ts': ['nutrition', 'providers'],
  'diary-ui.spec.ts': ['nutrition', 'providers'],
  'diary-photos.spec.ts': ['nutrition', 'providers'],
  'diary-refresh.spec.ts': ['nutrition', 'providers'],
  'diary-macro-chart.spec.ts': ['nutrition', 'providers'],
  'diary-meal-content.spec.ts': ['nutrition', 'providers'],
  'overview-nutrition-chart.spec.ts': ['nutrition', 'providers'],
  'transformmate-ui.spec.ts': ['workouts', 'providers'],
  'transformmate-connection-form.spec.ts': ['workouts', 'providers'],
};
const crosscuttingSpecs = new Set([
  'foundation.spec.ts', // All pages, authentication, logout and role boundaries.
  'mobile-inputs.spec.ts', // Login and forms across all data sections.
  'health.spec.ts', // Nutrition observations, measurements and trainer grants.
  'overview.spec.ts', // Aggregated nutrition, measurements and workouts.
  'collaboration.spec.ts', // Grants/revocation and direct API isolation across sections.
  'invite-accept.spec.ts', // Real invitation acceptance and account/grant boundaries.
]);
export function selectAreas(paths, mode = 'selected') {
  if (mode === 'full')
    return {
      mode,
      areas: [...areas],
      reason: 'Explicit manual full regression',
    };
  if (!paths?.length)
    return {
      mode,
      areas: [...areas],
      reason: 'Missing or empty authoritative diff',
    };
  const selected = new Set();
  for (const path of paths) {
    if (/^(docs\/|README\.md$)/.test(path)) continue;
    const spec = /^tests\/e2e\/([^/]+\.spec\.ts)$/.exec(path)?.[1];
    if (crosscuttingSpecs.has(spec))
      return {
        mode,
        areas: [...areas],
        reason: `Crosscutting E2E spec: ${path}`,
      };
    if (testAliases[spec]) {
      for (const area of testAliases[spec]) selected.add(area);
      continue;
    }
    const match =
      /^src\/features\/(nutrition|workouts|measurements|analytics|anamnesis|reports|comments)\//.exec(
        path,
      );
    if (match) {
      selected.add(match[1]);
      if (['nutrition', 'workouts'].includes(match[1]))
        selected.add('providers');
      continue;
    }
    if (
      /^src\/(?:server|app\/api)\/anamnesis\//.test(path) ||
      /^src\/app\/\(dashboard\)\/anamnesis\//.test(path)
    ) {
      selected.add('anamnesis');
      continue;
    }
    if (/^src\/server\/(nutrition|yazio|jobs)\//.test(path)) {
      selected.add('nutrition');
      selected.add('providers');
      continue;
    }
    if (/^src\/server\/transformmate\//.test(path)) {
      selected.add('workouts');
      selected.add('providers');
      continue;
    }
    if (/^src\/features\/offline\//.test(path)) {
      return {
        mode,
        areas: [...areas],
        reason: `Offline privacy/lifecycle path: ${path}`,
      };
    }
    const testArea =
      /^tests\/(?:e2e\/)?(nutrition|workouts|measurements|analytics|anamnesis|reports|comments|offline)/.exec(
        path,
      );
    if (testArea) {
      if (testArea[1] === 'offline')
        return {
          mode,
          areas: [...areas],
          reason: `Offline privacy/lifecycle tests: ${path}`,
        };
      selected.add(testArea[1]);
      if (['nutrition', 'workouts'].includes(testArea[1]))
        selected.add('providers');
      continue;
    }
    return {
      mode,
      areas: [...areas],
      reason: `Core or unclassified path: ${path}`,
    };
  }
  return {
    mode,
    areas: areas.filter((area) => selected.has(area)),
    reason: selected.size
      ? 'Known area paths'
      : 'Documentation only; mandatory smoke retained',
  };
}

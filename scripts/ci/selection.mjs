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

export function requireCompleteReport(report) {
  requirePassingReport(report);
  const selected = report.isolation?.selectedCases;
  const executed = report.isolation?.cases;
  const key = (entry) =>
    JSON.stringify([entry.file, entry.line, entry.title, entry.project]);
  if (
    !selected?.length ||
    !executed?.length ||
    report.errors?.length ||
    report.isolation.errors?.length ||
    report.stats.skipped !== 0 ||
    report.stats.flaky !== 0 ||
    report.stats.expected !== selected.length ||
    new Set(selected.map(key)).size !== selected.length ||
    JSON.stringify(selected.map(key).sort()) !==
      JSON.stringify(executed.map(key).sort()) ||
    executed.some((entry) => entry.status !== 'expected')
  )
    throw new Error(
      'Merge requires every enumerated E2E case to pass with no skips, failures or flaky retries',
    );
  const visit = (suites) => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? [])
        for (const test of spec.tests ?? [])
          if (test.results?.length !== 1 || test.results[0].status !== 'passed')
            throw new Error('Merge E2E cases must pass on their only attempt');
      visit(suite.suites);
    }
  };
  visit(report.suites);
}

export function requirePassingReport(report, requiredCases = []) {
  const stats = report.stats ?? {
    expected: report.numPassedTests,
    unexpected: report.numFailedTests,
  };
  if (!(stats.expected > 0) || stats.unexpected > 0)
    throw new Error('Failed or empty test stage');
  const specs = [];
  const visit = (suites) => {
    for (const suite of suites ?? []) {
      specs.push(...(suite.specs ?? []));
      visit(suite.suites);
    }
  };
  visit(report.suites);
  for (const requirement of requiredCases) {
    const { pattern, project } =
      typeof requirement === 'string' ? { pattern: requirement } : requirement;
    const matches = specs.filter((spec) =>
      new RegExp(pattern).test(spec.title),
    );
    const tests = matches
      .flatMap((spec) => spec.tests)
      .filter((test) => !project || test.projectName === project);
    if (
      !tests.length ||
      tests.some(
        (test) => !test.results?.some((result) => result.status === 'passed'),
      )
    )
      throw new Error(`Selected case missing, skipped or failed: ${pattern}`);
  }
  return stats;
}

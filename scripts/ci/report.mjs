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

export function caseTitlePattern(cases) {
  const titles = [...new Set(cases.map((entry) => entry.title))];
  if (!titles.length) throw new Error('Case title selection is empty');
  return (
    '(?:' +
    titles
      .map((title) => title.replace(/[.*+?^{}()|[\]\\$]/g, '\\$&'))
      .join('|') +
    ')$'
  );
}

// Keep viewport variants of a scenario in the same shard. Each of the bounded
// workers runs desktop AND mobile, with cases split inside each viewport.
export function partitionCases(cases, concurrency) {
  if (![1, 2, 3, 4].includes(concurrency))
    throw new Error('Browser concurrency must be between 1 and 4');
  const scenarios = new Map();
  for (const entry of cases) {
    const key = JSON.stringify([entry.file, entry.line, entry.title]);
    if (!scenarios.has(key)) scenarios.set(key, []);
    scenarios.get(key).push(entry);
  }
  const groups = Array.from(
    { length: Math.min(concurrency, scenarios.size) },
    () => [],
  );
  let index = 0;
  for (const variants of scenarios.values())
    groups[index++ % groups.length].push(...variants);
  return groups;
}

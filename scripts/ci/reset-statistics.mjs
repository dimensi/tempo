export const resetPhases = [
  'stop',
  'sqlite',
  'filesystem',
  'next',
  'start',
  'total',
];
export function summarizeResets(samples) {
  const result = { count: samples.length, milliseconds: {} };
  for (const phase of resetPhases) {
    const values = samples.map((sample) => sample[phase]).sort((a, b) => a - b);
    if (values.some((value) => !Number.isFinite(value) || value < 0))
      throw new Error('Invalid reset timing');
    const percentile = (p) =>
      values.length ? values[Math.ceil(p * values.length) - 1] : null;
    result.milliseconds[phase] = {
      p50: percentile(0.5),
      p95: percentile(0.95),
      sum: values.reduce((a, b) => a + b, 0),
    };
  }
  return result;
}

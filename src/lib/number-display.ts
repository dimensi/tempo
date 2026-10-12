import Decimal from 'decimal.js';

const DisplayDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});
function parse(value: string | number | null): Decimal | null {
  if (value === null || (typeof value === 'number' && !Number.isFinite(value)))
    return null;
  if (
    typeof value === 'string' &&
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
  )
    return null;
  try {
    const decimal = new DisplayDecimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}
/**
 * Presentation only: half-up to 2 fractional digits; tiny/large values use
 * 3 significant digits in scientific notation. Delta magnitude < 0.005 is ≈ 0.
 * Null/invalid/nonfinite input returns null; callers supply missing text and units.
 * Never use the returned text for arithmetic or persistence.
 */
export function formatDecimal(
  value: string | number | null,
  options: { kind?: 'value' | 'delta' } = {},
): string | null {
  const decimal = parse(value);
  if (!decimal) return null;
  if (decimal.isZero()) return '0';
  const magnitude = decimal.abs();
  if (options.kind === 'delta' && magnitude.lt('0.005')) return '≈ 0';
  // Bound text width without converting exact decimal strings to binary numbers.
  if (magnitude.lt('0.005') || magnitude.gte('1000000000')) {
    const [coefficient, exponent] = decimal.toExponential(2).split('e');
    return `${coefficient!.replace(/\.?0+$/, '').replace('.', ',')} × 10^${Number(exponent)}`;
  }
  const [integer, fraction] = decimal.toDecimalPlaces(2).toFixed().split('.');
  return `${integer!.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f')}${fraction ? `,${fraction}` : ''}`;
}
/** Charts require binary numbers; unplottable values remain gaps, never zero. */
export function toChartNumber(value: string | number | null): number | null {
  const decimal = parse(value);
  if (!decimal) return null;
  const number = decimal.toNumber();
  return Number.isFinite(number) && (number !== 0 || decimal.isZero())
    ? number
    : null;
}

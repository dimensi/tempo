import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { formatDecimal, toChartNumber } from '@/lib/number-display';

describe('decimal presentation without binary conversion', () => {
  it('shows source residuals consistently without changing exact subtraction', () => {
    const original = '3.4499999999999997';
    expect(formatDecimal(original)).toBe('3,45');
    expect(formatDecimal('6.1499999999999995')).toBe('6,15');
    const delta = new Decimal('3.45').minus(original).toString();
    expect(delta).toBe('3e-16');
    expect(formatDecimal(delta, { kind: 'delta' })).toBe('≈ 0');
    expect(delta).toBe('3e-16');
    expect(formatDecimal('-5e-16', { kind: 'delta' })).toBe('≈ 0');
    expect(formatDecimal('0.005', { kind: 'delta' })).toBe('0,01');
    expect(formatDecimal('-0.015', { kind: 'delta' })).toBe('-0,02');
  });
  it('keeps missing/invalid numbers distinct from actual zero', () => {
    for (const input of [null, '', 'invalid', 'NaN', 'Infinity', Infinity, NaN])
      expect(formatDecimal(input)).toBeNull();
    expect(formatDecimal('0')).toBe('0');
    expect(formatDecimal('-0')).toBe('0');
    expect(formatDecimal('0.000001')).toBe('1 × 10^-6');
    expect(formatDecimal('-0.000001')).toBe('-1 × 10^-6');
  });
  it('bounds large values and preserves decimal rounding without Infinity', () => {
    expect(formatDecimal('1234567.895')).toBe('1\u202f234\u202f567,9');
    expect(formatDecimal('100000000000000000000.1')).toBe('1 × 10^20');
    expect(formatDecimal('1.235e400')).toBe('1,24 × 10^400');
    expect(toChartNumber('1e400')).toBeNull();
    expect(toChartNumber('1e-400')).toBeNull();
    expect(toChartNumber('0')).toBe(0);
    expect(toChartNumber('3.45')).toBe(3.45);
    expect(toChartNumber(Infinity)).toBeNull();
  });
});

import Decimal from 'decimal.js';
import { z } from 'zod';
import { bodyDateTimeSchema } from '@/contracts/yazio-body';

// Provider-local calendar dates; offset/ISO variants have no established semantics.
export function yazioObservationDate(value: string): string | null {
  if (z.iso.date().safeParse(value).success) return value;
  return bodyDateTimeSchema.safeParse(value).success
    ? value.slice(0, 10)
    : null;
}

function bodyDecimal(value: string | number): Decimal | null {
  const text = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return null;
  const decimal = new Decimal(text);
  return decimal.gt(0) && decimal.lte('9999.999') ? decimal : null;
}

// A read/comparison projection only. Never replace the stored provider value.
export function canonicalYazioBodyValue(value: string | number): string | null {
  const decimal = bodyDecimal(value);
  if (!decimal) return null;
  if (decimal.decimalPlaces() <= 3) return decimal.toFixed();
  const candidate = decimal.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
  const number = Number(value);
  return candidate.gt(0) &&
    decimal.eq(String(number)) &&
    Math.fround(candidate.toNumber()) === number
    ? candidate.toFixed()
    : null;
}

export function sameYazioBodyValue(
  a: string | number,
  b: string | number,
): boolean {
  const first = bodyDecimal(a),
    second = bodyDecimal(b);
  if (!first || !second) return false;
  return new Decimal(canonicalYazioBodyValue(a) ?? first.toFixed()).eq(
    canonicalYazioBodyValue(b) ?? second.toFixed(),
  );
}

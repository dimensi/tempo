// Чистые функции конвейера импорта: без БД и сети, полностью покрыты
// юнит-тестами. Порядок проверок автоподтверждения зафиксирован ТЗ 4.4.

import {
  anamnesisDecimal,
  type AnamnesisObservationValue,
  type ExtractionCandidate,
  type MedicalReferenceRange,
} from '@/contracts/anamnesis';
import type { CatalogIndex } from './markers';
import { matchMarker } from './markers';

export type ReviewReason =
  | 'unknown_source_kind'
  | 'ambiguous_marker'
  | 'missing_origin'
  | 'missing_date'
  | 'unknown_unit'
  | 'contradiction'
  | 'possible_duplicate'
  | 'value_type';

export type DatePrecision = 'datetime' | 'date' | 'month' | 'unknown';

// --- Единицы измерения -----------------------------------------------------

const canonicalUnits: Record<string, string> = {
  'нг/мл': 'ng/mL',
  'ng/ml': 'ng/mL',
  'мкг/л': 'μg/L',
  'мкг/дл': 'μg/dL',
  'ug/l': 'μg/L',
  'µg/l': 'μg/L',
  'нмоль/л': 'nmol/L',
  'nmol/l': 'nmol/L',
  'мкмоль/л': 'μmol/L',
  'umol/l': 'μmol/L',
  'µmol/l': 'μmol/L',
  'ммоль/л': 'mmol/L',
  'mmol/l': 'mmol/L',
  'ед/л': 'U/L',
  'ед.': 'U/L',
  'u/l': 'U/L',
  'е/л': 'U/L',
  'г/л': 'g/L',
  'g/l': 'g/L',
  'мг/дл': 'mg/dL',
  'mg/dl': 'mg/dL',
  '%': '%',
};

// Канонически равные единицы: пересчёт не меняет числового значения.
const equalUnitGroups: string[][] = [['ng/mL', 'μg/L']];

export function canonicalUnit(unit: string | null): string | null {
  if (unit === null) return null;
  return canonicalUnits[unit.trim().toLowerCase()] ?? null;
}

export function unitsCanonicallyEqual(a: string, b: string): boolean {
  const ca = canonicalUnit(a) ?? a.trim();
  const cb = canonicalUnit(b) ?? b.trim();
  if (ca === cb) return true;
  return equalUnitGroups.some(
    (group) => group.includes(ca) && group.includes(cb),
  );
}

// --- Значения ---------------------------------------------------------------

const comparatorSymbols: Array<[RegExp, 'lt' | 'lte' | 'gt' | 'gte']> = [
  [/^>=/, 'gte'],
  [/^≥/, 'gte'],
  [/^≤/, 'lte'],
  [/^<=/, 'lte'],
  [/^</, 'lt'],
  [/^>/, 'gt'],
];

export function parseCandidateValue(
  candidate: Pick<ExtractionCandidate, 'value' | 'comparator'>,
): AnamnesisObservationValue | null {
  let raw = candidate.value.trim();
  let comparator = candidate.comparator;
  for (const [pattern, symbol] of comparatorSymbols) {
    if (pattern.test(raw)) {
      raw = raw.replace(pattern, '').trim();
      comparator = symbol;
      break;
    }
  }
  const decimal = raw.replace(',', '.');
  if (anamnesisDecimal.safeParse(decimal).success)
    return { kind: 'numeric', value: decimal, comparator };
  if (raw.length >= 1 && raw.length <= 500) return { kind: 'text', value: raw };
  return null;
}

// Происхождение: значение обязано явно присутствовать в тексте источника.
export function valueProvenance(
  value: AnamnesisObservationValue,
  rawText: string,
): boolean {
  const text = rawText.replace(/,/g, '.');
  if (value.kind === 'text')
    return text.toLowerCase().includes(value.value.trim().toLowerCase());
  const escaped = value.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9.])${escaped}($|[^0-9.])`).test(text);
}

// --- Даты -------------------------------------------------------------------

export function parseCollectedAt(raw: string | null): {
  collectedAt: string | null;
  precision: DatePrecision;
} {
  if (!raw) return { collectedAt: null, precision: 'unknown' };
  const value = raw.trim();
  const datetime = value.match(
    /^(\d{2})[.](\d{2})[.](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (datetime) {
    const iso = toIsoDate(datetime[1]!, datetime[2]!, datetime[3]!);
    return iso
      ? {
          collectedAt: `${iso}T${datetime[4]!}:${datetime[5]!}${datetime[6] ? `:${datetime[6]}` : ''}`,
          precision: 'datetime',
        }
      : { collectedAt: null, precision: 'unknown' };
  }
  const date = value.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})$/);
  if (date) {
    const iso = toIsoDate(date[1]!, date[2]!, date[3]!);
    return iso
      ? { collectedAt: iso, precision: 'date' }
      : { collectedAt: null, precision: 'unknown' };
  }
  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (
    isoDate &&
    validDate(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]))
  )
    return { collectedAt: value, precision: 'date' };
  const month = value.match(/^(\d{2})[.\-/](\d{4})$/);
  if (month && Number(month[1]!) >= 1 && Number(month[1]!) <= 12)
    return {
      collectedAt: `${month[2]!}-${month[1]!.padStart(2, '0')}`,
      precision: 'month',
    };
  const isoMonth = value.match(/^(\d{4})-(\d{2})$/);
  if (isoMonth && Number(isoMonth[2]!) >= 1 && Number(isoMonth[2]!) <= 12)
    return { collectedAt: value, precision: 'month' };
  return { collectedAt: null, precision: 'unknown' };
}

function toIsoDate(day: string, month: string, year: string): string | null {
  const iso = `${year}-${month}-${day}`;
  return validDate(Number(year), Number(month), Number(day)) ? iso : null;
}

function validDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    year >= 1900 &&
    year <= 2100
  );
}

// --- Референсные интервалы ---------------------------------------------------

export function parseReference(
  reference: ExtractionCandidate['reference'],
): MedicalReferenceRange | null {
  if (!reference) return null;
  const clean = (value: string | null) => {
    if (value === null) return null;
    const decimal = value
      .trim()
      .replace(',', '.')
      .replace(/[[\]()]/g, '');
    return anamnesisDecimal.safeParse(decimal).success ? decimal : null;
  };
  const lower = clean(reference.lower);
  const upper = clean(reference.upper);
  if (lower === null && upper === null) return null;
  return {
    lower,
    upper,
    lowerInclusive: reference.lowerInclusive ?? true,
    upperInclusive: reference.upperInclusive ?? true,
    originalText: reference.originalText,
  };
}

export function assessReference(
  value: AnamnesisObservationValue,
  range: MedicalReferenceRange | null,
): 'below' | 'within' | 'above' | 'unknown' {
  if (!range || value.kind !== 'numeric' || value.comparator !== 'eq')
    return 'unknown';
  const numeric = Number(value.value);
  if (range.lower !== null) {
    const lower = Number(range.lower);
    if (numeric < lower || (numeric === lower && !range.lowerInclusive))
      return 'below';
  }
  if (range.upper !== null) {
    const upper = Number(range.upper);
    if (numeric > upper || (numeric === upper && !range.upperInclusive))
      return 'above';
  }
  return 'within';
}

// --- Подготовка кандидата ----------------------------------------------------

export interface PreparedCandidate {
  candidate: ExtractionCandidate;
  markerId: string | null;
  value: AnamnesisObservationValue | null;
  originalUnit: string | null;
  normalizedValue: string | null;
  normalizedUnit: string | null;
  unitKnown: boolean;
  collectedAt: string | null;
  datePrecision: DatePrecision;
  referenceRange: MedicalReferenceRange | null;
  referenceAssessment: 'below' | 'within' | 'above' | 'unknown';
  provenance: boolean;
  reviewReason: ReviewReason | null;
  autoVerifiable: boolean;
}

export function prepareCandidate(
  candidate: ExtractionCandidate,
  index: CatalogIndex,
  preferredUnits: ReadonlyMap<string, string | null>,
): PreparedCandidate {
  const marker = matchMarker(index, candidate.name);
  const value = parseCandidateValue(candidate);
  const originalUnit = candidate.unit?.trim() || null;
  const canonical = canonicalUnit(originalUnit);
  const unitKnown = canonical !== null || originalUnit === null;
  const { collectedAt, precision } = parseCollectedAt(candidate.collectedAt);
  // Историческое значение не наследует референс текущего результата:
  // доверять референсу от провайдера для historical_result нельзя.
  const referenceRange =
    candidate.sourceKind === 'historical_result'
      ? null
      : parseReference(candidate.reference);
  const provenance =
    value !== null && valueProvenance(value, candidate.rawText);

  let normalizedValue: string | null = null;
  let normalizedUnit: string | null = null;
  if (value?.kind === 'numeric' && canonical) {
    const preferred = marker.markerId
      ? preferredUnits.get(marker.markerId)
      : undefined;
    normalizedValue = value.value;
    normalizedUnit =
      preferred && unitsCanonicallyEqual(canonical, preferred)
        ? preferred
        : canonical;
  }

  const referenceAssessment = value
    ? assessReference(value, referenceRange)
    : 'unknown';

  // Первое нарушенное обязательное условие становится причиной проверки.
  let reviewReason: ReviewReason | null = null;
  if (marker.ambiguous) reviewReason = 'ambiguous_marker';
  else if (!value) reviewReason = 'value_type';
  else if (!provenance) reviewReason = 'missing_origin';
  else if (!unitKnown) reviewReason = 'unknown_unit';
  else if (!collectedAt) reviewReason = 'missing_date';

  return {
    candidate,
    markerId: marker.markerId,
    value,
    originalUnit,
    normalizedValue,
    normalizedUnit,
    unitKnown,
    collectedAt,
    datePrecision: precision,
    referenceRange,
    referenceAssessment,
    provenance,
    reviewReason,
    autoVerifiable: reviewReason === null,
  };
}

// --- Дедупликация внутри документа (уровень 2) -------------------------------

export function candidateDedupKey(prepared: PreparedCandidate): string {
  const value =
    prepared.value === null
      ? 'unparsed'
      : prepared.value.kind === 'numeric'
        ? `n:${prepared.value.comparator}:${prepared.value.value}`
        : `t:${prepared.value.value.trim().toLowerCase()}`;
  return [
    prepared.markerId ?? `unknown:${prepared.candidate.name.toLowerCase()}`,
    prepared.collectedAt ?? 'no-date',
    value,
    prepared.normalizedUnit ?? prepared.originalUnit ?? 'no-unit',
    prepared.candidate.sourceKind,
  ].join('|');
}

// Одинаковые результат, дата и роль на повторяющихся страницах объединяются;
// исходные страницы сохраняются как дополнительные источники.
export function groupDuplicateCandidates(
  prepared: PreparedCandidate[],
): PreparedCandidate[][] {
  const groups = new Map<string, PreparedCandidate[]>();
  for (const item of prepared) {
    const key = candidateDedupKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}

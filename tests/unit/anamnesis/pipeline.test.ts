import { describe, expect, it } from 'vitest';
import {
  assessReference,
  canonicalUnit,
  groupDuplicateCandidates,
  parseCandidateValue,
  parseCollectedAt,
  parseReference,
  prepareCandidate,
  unitsCanonicallyEqual,
  valueProvenance,
} from '@/server/anamnesis/pipeline';
import { catalogSelfIndex } from '@/server/anamnesis/markers';
import type { ExtractionCandidate } from '@/contracts/anamnesis';

const index = catalogSelfIndex();
const preferred = new Map<string, string | null>([['vitamin-d-25oh', 'нг/мл']]);

function candidate(
  overrides: Partial<ExtractionCandidate> = {},
): ExtractionCandidate {
  return {
    name: '25-OH Витамин D',
    rawText: '25-OH Витамин D 41,2 нг/мл',
    pageNumber: 1,
    value: '41,2',
    comparator: 'eq',
    unit: 'нг/мл',
    collectedAt: '15.01.2027',
    sourceKind: 'current_result',
    reference: {
      lower: '30',
      upper: '100',
      lowerInclusive: true,
      upperInclusive: true,
      originalText: '30 – 100 нг/мл',
    },
    ...overrides,
  };
}

describe('parseCandidateValue', () => {
  it('normalizes comma decimals', () => {
    expect(parseCandidateValue({ value: '41,2', comparator: 'eq' })).toEqual({
      kind: 'numeric',
      value: '41.2',
      comparator: 'eq',
    });
  });
  it('detects comparator symbols overriding the declared one', () => {
    expect(
      parseCandidateValue({ value: '>100', comparator: 'eq' }),
    ).toMatchObject({
      kind: 'numeric',
      value: '100',
      comparator: 'gt',
    });
    expect(
      parseCandidateValue({ value: '≤ 5', comparator: 'eq' }),
    ).toMatchObject({
      comparator: 'lte',
    });
  });
  it('falls back to text values', () => {
    expect(
      parseCandidateValue({ value: 'Не обнаружено', comparator: 'eq' }),
    ).toEqual({
      kind: 'text',
      value: 'Не обнаружено',
    });
  });
});

describe('valueProvenance', () => {
  it('finds numeric values with comma normalization', () => {
    expect(
      valueProvenance(
        { kind: 'numeric', value: '41.2', comparator: 'eq' },
        'Витамин D 41,2 нг/мл',
      ),
    ).toBe(true);
  });
  it('rejects values absent from the source text', () => {
    expect(
      valueProvenance(
        { kind: 'numeric', value: '99.99', comparator: 'eq' },
        'Витамин D 41,2 нг/мл',
      ),
    ).toBe(false);
  });
  it('does not match partial digit sequences', () => {
    expect(
      valueProvenance(
        { kind: 'numeric', value: '5.3', comparator: 'eq' },
        'результат 41,2 от 15.01.2027',
      ),
    ).toBe(false);
  });
});

describe('parseCollectedAt', () => {
  it('parses laboratory date formats', () => {
    expect(parseCollectedAt('15.01.2027')).toEqual({
      collectedAt: '2027-01-15',
      precision: 'date',
    });
    expect(parseCollectedAt('10.06.2026 14:30')).toEqual({
      collectedAt: '2026-06-10T14:30',
      precision: 'datetime',
    });
    expect(parseCollectedAt('2026-04')).toEqual({
      collectedAt: '2026-04',
      precision: 'month',
    });
    expect(parseCollectedAt('04.2026')).toEqual({
      collectedAt: '2026-04',
      precision: 'month',
    });
  });
  it('rejects impossible dates and garbage', () => {
    expect(parseCollectedAt('31.02.2026').collectedAt).toBeNull();
    expect(parseCollectedAt('сентябрь').collectedAt).toBeNull();
    expect(parseCollectedAt(null).collectedAt).toBeNull();
  });
});

describe('units', () => {
  it('maps russian units to canonical', () => {
    expect(canonicalUnit('Ед/л')).toBe('U/L');
    expect(canonicalUnit('мкмоль/л')).toBe('μmol/L');
    expect(canonicalUnit('нг/мл')).toBe('ng/mL');
  });
  it('treats unknown units as unknown', () => {
    expect(canonicalUnit('кат/л')).toBeNull();
  });
  it('knows canonically equal groups', () => {
    expect(unitsCanonicallyEqual('ng/mL', 'μg/L')).toBe(true);
    expect(unitsCanonicallyEqual('U/L', 'Ед/л')).toBe(true);
    expect(unitsCanonicallyEqual('ng/mL', 'pmol/L')).toBe(false);
  });
});

describe('assessReference', () => {
  const range = {
    lower: '30',
    upper: '100',
    lowerInclusive: true,
    upperInclusive: true,
    originalText: '30 – 100',
  };
  it('assesses below, within and above', () => {
    expect(
      assessReference(
        { kind: 'numeric', value: '28.4', comparator: 'eq' },
        range,
      ),
    ).toBe('below');
    expect(
      assessReference(
        { kind: 'numeric', value: '41.2', comparator: 'eq' },
        range,
      ),
    ).toBe('within');
    expect(
      assessReference(
        { kind: 'numeric', value: '120', comparator: 'eq' },
        range,
      ),
    ).toBe('above');
  });
  it('respects exclusivity', () => {
    expect(
      assessReference(
        { kind: 'numeric', value: '100', comparator: 'eq' },
        { ...range, upperInclusive: false },
      ),
    ).toBe('above');
  });
  it('returns unknown without range, comparators or text values', () => {
    expect(
      assessReference({ kind: 'numeric', value: '5', comparator: 'eq' }, null),
    ).toBe('unknown');
    expect(
      assessReference({ kind: 'numeric', value: '5', comparator: 'gt' }, range),
    ).toBe('unknown');
    expect(
      assessReference({ kind: 'text', value: 'не обнаружено' }, range),
    ).toBe('unknown');
  });
});

describe('parseReference', () => {
  it('parses boundaries and keeps original text', () => {
    expect(
      parseReference({
        lower: '30',
        upper: '100,0',
        lowerInclusive: null,
        upperInclusive: null,
        originalText: '30 – 100 нг/мл',
      }),
    ).toEqual({
      lower: '30',
      upper: '100.0',
      lowerInclusive: true,
      upperInclusive: true,
      originalText: '30 – 100 нг/мл',
    });
  });
  it('drops ranges without any valid boundary', () => {
    expect(
      parseReference({
        lower: 'тридцать',
        upper: null,
        lowerInclusive: null,
        upperInclusive: null,
        originalText: 'мусор',
      }),
    ).toBeNull();
  });
});

describe('prepareCandidate', () => {
  it('auto-verifies a confidently extracted result', () => {
    const prepared = prepareCandidate(candidate(), index, preferred);
    expect(prepared.autoVerifiable).toBe(true);
    expect(prepared.reviewReason).toBeNull();
    expect(prepared.markerId).toBe('vitamin-d-25oh');
    expect(prepared.normalizedUnit).toBe('нг/мл');
  });

  it('auto-verifies out-of-range values — reference deviation is not a recognition issue', () => {
    const prepared = prepareCandidate(
      candidate({ value: '120', rawText: 'Витамин D 120 нг/мл' }),
      index,
      preferred,
    );
    expect(prepared.autoVerifiable).toBe(true);
    expect(prepared.referenceAssessment).toBe('above');
  });

  it('keeps unknown assessment when no reference is given', () => {
    const prepared = prepareCandidate(
      candidate({ reference: null }),
      index,
      preferred,
    );
    expect(prepared.autoVerifiable).toBe(true);
    expect(prepared.referenceAssessment).toBe('unknown');
  });

  it('sends unmatched markers to review', () => {
    const prepared = prepareCandidate(
      candidate({ name: 'Креатинин' }),
      index,
      preferred,
    );
    expect(prepared.autoVerifiable).toBe(false);
    expect(prepared.reviewReason).toBe('ambiguous_marker');
  });

  it('sends unknown units to review', () => {
    const prepared = prepareCandidate(
      candidate({ unit: 'кат/л', rawText: 'Витамин D 41,2 кат/л' }),
      index,
      preferred,
    );
    expect(prepared.reviewReason).toBe('unknown_unit');
  });

  it('sends missing dates to review', () => {
    const prepared = prepareCandidate(
      candidate({ collectedAt: null }),
      index,
      preferred,
    );
    expect(prepared.reviewReason).toBe('missing_date');
  });

  it('sends values missing from the source to review', () => {
    const prepared = prepareCandidate(
      candidate({ rawText: 'Витамин D нг/мл без значения' }),
      index,
      preferred,
    );
    expect(prepared.reviewReason).toBe('missing_origin');
  });

  it('does not inherit the current reference for historical results', () => {
    const prepared = prepareCandidate(
      candidate({
        value: '28,4',
        rawText: 'Витамин D 28,4 нг/мл',
        collectedAt: '10.06.2026',
        sourceKind: 'historical_result',
        reference: null,
      }),
      index,
      preferred,
    );
    expect(prepared.autoVerifiable).toBe(true);
    expect(prepared.referenceRange).toBeNull();
    expect(prepared.referenceAssessment).toBe('unknown');
  });
});

describe('groupDuplicateCandidates', () => {
  it('merges the repeated vitamin D page but keeps the historical result apart', () => {
    const current1 = prepareCandidate(candidate(), index, preferred);
    const current3 = prepareCandidate(
      candidate({ pageNumber: 3 }),
      index,
      preferred,
    );
    const historical = prepareCandidate(
      candidate({
        value: '28,4',
        rawText: 'Витамин D 28,4 нг/мл',
        collectedAt: '10.06.2026',
        sourceKind: 'historical_result',
        reference: null,
      }),
      index,
      preferred,
    );
    const groups = groupDuplicateCandidates([current1, historical, current3]);
    expect(groups).toHaveLength(2);
    const merged = groups.find((group) => group.length > 1);
    expect(merged).toBeDefined();
    expect(
      merged!.every((item) => item.candidate.sourceKind === 'current_result'),
    ).toBe(true);
    expect(merged!.map((item) => item.candidate.pageNumber).sort()).toEqual([
      1, 3,
    ]);
  });

  it('separates same-day values that differ', () => {
    const first = prepareCandidate(candidate(), index, preferred);
    const second = prepareCandidate(
      candidate({ value: '40', rawText: 'Витамин D 40 нг/мл' }),
      index,
      preferred,
    );
    expect(groupDuplicateCandidates([first, second])).toHaveLength(2);
  });
});

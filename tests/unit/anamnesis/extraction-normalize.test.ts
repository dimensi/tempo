import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { normalizeSourceKinds } =
  await import('@/server/anamnesis/extraction-normalize');

describe('normalizeSourceKinds', () => {
  const candidate = (overrides: Record<string, unknown>) => ({
    name: 'АЛТ',
    rawText: 'АЛТ 30,1 Ед/л',
    pageNumber: 1,
    value: '30,1',
    comparator: 'eq',
    unit: 'Ед/л',
    collectedAt: '15.01.2027',
    sourceKind: 'current_result',
    reference: null,
    ...overrides,
  });

  it('passes valid payloads through unchanged', () => {
    const { result, forcedReviewIndexes } = normalizeSourceKinds({
      laboratory: 'Синтетическая лаборатория',
      title: null,
      issuedAt: null,
      observations: [candidate({})],
    });
    expect(forcedReviewIndexes).toEqual([]);
    expect(result.observations[0]!.sourceKind).toBe('current_result');
    expect(result.observations[0]!.unit).toBe('Ед/л');
  });

  it('coerces non-string units, dates and unknown comparators', () => {
    const { result } = normalizeSourceKinds({
      laboratory: null,
      title: null,
      issuedAt: null,
      observations: [
        candidate({
          unit: 42,
          collectedAt: { weird: true },
          comparator: 'около',
        }),
      ],
    });
    expect(result.observations[0]!.unit).toBeNull();
    expect(result.observations[0]!.collectedAt).toBeNull();
    expect(result.observations[0]!.comparator).toBe('eq');
  });

  it('keeps unknown source kinds but flags them for mandatory review', () => {
    const { result, forcedReviewIndexes } = normalizeSourceKinds({
      laboratory: null,
      title: null,
      issuedAt: null,
      observations: [
        candidate({ sourceKind: 'смесь результатов' }),
        candidate({ sourceKind: 'historical_result' }),
      ],
    });
    expect(forcedReviewIndexes).toEqual([0]);
    expect(result.observations[0]!.sourceKind).toBe('current_result');
    expect(result.observations[1]!.sourceKind).toBe('historical_result');
  });
});

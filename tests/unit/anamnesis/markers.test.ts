import { describe, expect, it } from 'vitest';
import {
  anamnesisMatchKey,
  buildCatalogIndex,
  catalogSelfIndex,
  matchMarker,
} from '@/server/anamnesis/markers';

describe('anamnesis marker catalog', () => {
  it('has unambiguous normalized aliases', () => {
    expect(() => catalogSelfIndex()).not.toThrow();
  });

  it('matches laboratory spellings from the reference document', () => {
    const index = catalogSelfIndex();
    expect(matchMarker(index, '25-OH Витамин D')).toEqual({
      markerId: 'vitamin-d-25oh',
      ambiguous: false,
    });
    expect(matchMarker(index, 'АЛТ').markerId).toBe('alt');
    expect(matchMarker(index, 'АСТ').markerId).toBe('ast');
    expect(matchMarker(index, 'Альфа-амилаза панкреатическая').markerId).toBe(
      'pancreatic-amylase',
    );
    expect(matchMarker(index, 'Билирубин общий').markerId).toBe(
      'total-bilirubin',
    );
  });

  it('is case and punctuation insensitive', () => {
    expect(anamnesisMatchKey('Витамин D (25-OH)')).toBe(
      anamnesisMatchKey('витамин d 25-oh'),
    );
  });

  it('marks unknown names as ambiguous', () => {
    const index = buildCatalogIndex([
      { markerId: 'alt', alias: 'алт' },
      { markerId: 'ast', alias: 'аст' },
    ]);
    expect(matchMarker(index, 'Креатинин')).toEqual({
      markerId: null,
      ambiguous: true,
    });
  });

  it('rejects colliding aliases across markers', () => {
    expect(() =>
      buildCatalogIndex([
        { markerId: 'alt', alias: 'аланинаминотрансфераза' },
        { markerId: 'ast', alias: 'АЛаНИНаминоТрансфераза' },
      ]),
    ).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import {
  anamnesisDecimal,
  medicalObservationCorrectionSchema,
  medicalReportRequestSchema,
  anamnesisGrantInputSchema,
  extractionResultSchema,
} from '@/contracts/anamnesis';

describe('anamnesis decimal strings', () => {
  it.each(['41.2', '-1.5', '0', '1234567.123456'])('accepts %s', (value) =>
    expect(anamnesisDecimal.safeParse(value).success).toBe(true),
  );
  it.each(['41,2', '1e3', 'abc', '', '0.1234567', '12345678'])(
    'rejects %s',
    (value) => expect(anamnesisDecimal.safeParse(value).success).toBe(false),
  );
});

describe('medicalObservationCorrectionSchema', () => {
  const base = {
    expectedRevision: 1,
    markerId: 'vitamin-d-25oh',
    value: { kind: 'numeric', value: '41.2', comparator: 'eq' },
    originalUnit: 'нг/мл',
    collectedAt: '2027-01-15',
    datePrecision: 'date',
    referenceRange: null,
  };
  it('accepts a full correction', () => {
    expect(medicalObservationCorrectionSchema.safeParse(base).success).toBe(
      true,
    );
  });
  it('requires a matching revision', () => {
    expect(
      medicalObservationCorrectionSchema.safeParse({
        ...base,
        expectedRevision: 0,
      }).success,
    ).toBe(false);
  });
  it('rejects mismatched precision and date', () => {
    expect(
      medicalObservationCorrectionSchema.safeParse({
        ...base,
        collectedAt: '2026-09',
        datePrecision: 'date',
      }).success,
    ).toBe(false);
  });
});

describe('medicalReportRequestSchema', () => {
  it('requires at least one marker', () => {
    expect(
      medicalReportRequestSchema.safeParse({
        markerIds: [],
        from: null,
        to: null,
      }).success,
    ).toBe(false);
  });
  it('bounds the marker list', () => {
    expect(
      medicalReportRequestSchema.safeParse({
        markerIds: Array.from({ length: 51 }, () => 'alt'),
        from: null,
        to: null,
      }).success,
    ).toBe(false);
  });
});

describe('anamnesisGrantInputSchema', () => {
  it('accepts trainer and enabled flag', () => {
    expect(
      anamnesisGrantInputSchema.safeParse({
        trainerId: '0d11a2b3-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
        enabled: true,
      }).success,
    ).toBe(true);
  });
});

describe('extractionResultSchema', () => {
  it('requires rawText origin for each candidate', () => {
    const result = extractionResultSchema.safeParse({
      laboratory: null,
      title: null,
      issuedAt: null,
      observations: [
        {
          name: 'АЛТ',
          rawText: '',
          pageNumber: 1,
          value: '30,1',
          comparator: 'eq',
          unit: 'Ед/л',
          collectedAt: '15.01.2027',
          sourceKind: 'current_result',
          reference: null,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

// Нормализация ответа провайдера до строгой схемы. Отдельный модуль без
// серверных импортов — пригоден для юнит-тестов.

import { z } from 'zod';
import {
  anamnesisSourceKinds,
  extractionResultSchema,
  type ExtractionResult,
} from '@/contracts/anamnesis';

const lenientCandidateSchema = z.object({
  name: z.string(),
  rawText: z.string(),
  pageNumber: z.number(),
  value: z.string(),
  comparator: z.string(),
  unit: z.unknown().nullable(),
  collectedAt: z.unknown().nullable(),
  sourceKind: z.string(),
  reference: z.unknown().nullable(),
});

const lenientResultSchema = z.object({
  laboratory: z.unknown().nullable(),
  title: z.unknown().nullable(),
  issuedAt: z.unknown().nullable(),
  observations: z.array(lenientCandidateSchema),
});

// Неизвестная роль результата не валит весь импорт: запись сохраняется
// как current_result, но принудительно уходит в ручную проверку —
// возвращаются индексы таких наблюдений.
const comparators = ['eq', 'lt', 'lte', 'gt', 'gte'] as const;

export function normalizeSourceKinds(input: unknown): {
  result: ExtractionResult;
  forcedReviewIndexes: number[];
} {
  const parsed = lenientResultSchema.parse(input);
  const forcedReviewIndexes: number[] = [];
  const observations = parsed.observations.map((candidate, index) => {
    if (!anamnesisSourceKinds.includes(candidate.sourceKind as never))
      forcedReviewIndexes.push(index);
    return {
      name: candidate.name,
      rawText: candidate.rawText,
      pageNumber: candidate.pageNumber,
      value: candidate.value,
      comparator: (comparators as readonly string[]).includes(
        candidate.comparator,
      )
        ? candidate.comparator
        : 'eq',
      unit: typeof candidate.unit === 'string' ? candidate.unit : null,
      collectedAt:
        typeof candidate.collectedAt === 'string'
          ? candidate.collectedAt
          : null,
      sourceKind: anamnesisSourceKinds.includes(candidate.sourceKind as never)
        ? candidate.sourceKind
        : ('current_result' as const),
      reference:
        candidate.reference && typeof candidate.reference === 'object'
          ? candidate.reference
          : null,
    };
  });
  return {
    result: extractionResultSchema.parse({
      laboratory:
        typeof parsed.laboratory === 'string' ? parsed.laboratory : null,
      title: typeof parsed.title === 'string' ? parsed.title : null,
      issuedAt: typeof parsed.issuedAt === 'string' ? parsed.issuedAt : null,
      observations,
    }),
    forcedReviewIndexes,
  };
}

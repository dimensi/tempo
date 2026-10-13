import 'server-only';
import { readServerEnv } from '@/server/env';
import {
  extractionResultSchema,
  type ExtractionResult,
} from '@/contracts/anamnesis';

export interface ExtractionRequestPage {
  pageNumber: number;
  lines: string[];
  imageJpeg: Buffer | null;
}

export interface AnamnesisExtractionProvider {
  readonly name: string;
  extract(input: {
    sha256: string;
    pages: ExtractionRequestPage[];
  }): Promise<ExtractionResult>;
}

// transient — временный сбой (сеть, 5xx): воркер повторит задание.
export class AnamnesisProviderError extends Error {
  constructor(
    public readonly code: 'NOT_CONFIGURED' | 'UPSTREAM' | 'BAD_RESPONSE',
    public readonly transient: boolean,
  ) {
    super('Anamnesis extraction provider failed');
  }
}

const SYSTEM_PROMPT = [
  'Ты извлекаешь результаты лабораторных исследований из страниц документа.',
  'Верни строго JSON без пояснений и без markdown-обёрток:',
  '{"laboratory": string|null, "title": string|null, "issuedAt": string|null, "observations": array}.',
  'Каждый элемент observations: {"name": название показателя как в документе,',
  '"rawText": дословный фрагмент строки результата со значением и единицей,',
  '"pageNumber": номер страницы начиная с 1, "value": значение как напечатано',
  '(например "41,2" или ">100"), "comparator": "eq"|"lt"|"lte"|"gt"|"gte",',
  '"unit": единица или null, "collectedAt": дата исследования из документа или null',
  '(формат ДД.ММ.ГГГГ или ДД.ММ.ГГГГ ЧЧ:ММ), "sourceKind": "current_result" для',
  'текущих результатов или "historical_result" для колонок предыдущих измерений,',
  '"reference": {"lower": string|null, "upper": string|null, "lowerInclusive": boolean|null,',
  '"upperInclusive": boolean|null, "originalText": референсный интервал как напечатано} или null.}',
  'Референс указывай только из той же строки результата. Для исторических значений',
  'референс не наследуется от текущего. Не выдумывай значения: каждый результат',
  'обязан опираться на видимый текст или изображение страницы.',
].join(' ');

function parseModelJson(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(stripped);
}

function glmProvider(config: {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}): AnamnesisExtractionProvider {
  return {
    name: 'glm',
    async extract({ pages }) {
      const content: unknown[] = [
        {
          type: 'text',
          text: `Страницы документа (номер и текст):\n${pages
            .map(
              (page) =>
                `— страница ${page.pageNumber} —\n${page.lines.join('\n') || '(текстового слоя нет, смотри изображение)'}`,
            )
            .join('\n\n')}`,
        },
      ];
      for (const page of pages)
        if (page.imageJpeg)
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${page.imageJpeg.toString('base64')}`,
            },
          });
      const body = JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      });
      let lastError: 'UPSTREAM' | 'BAD_RESPONSE' = 'UPSTREAM';
      for (let attempt = 0; attempt < 2; attempt++) {
        let response: Response;
        try {
          response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body,
            signal: AbortSignal.timeout(config.timeoutMs),
          });
        } catch {
          lastError = 'UPSTREAM';
          continue;
        }
        if (response.status >= 500 || response.status === 429) {
          lastError = 'UPSTREAM';
          continue;
        }
        if (!response.ok) throw new AnamnesisProviderError('UPSTREAM', false);
        const payload: unknown = await response.json().catch(() => null);
        const text =
          payload &&
          typeof payload === 'object' &&
          'choices' in payload &&
          Array.isArray((payload as { choices: unknown }).choices)
            ? ((
                payload as {
                  choices: Array<{ message?: { content?: unknown } }>;
                }
              ).choices[0]?.message?.content ?? null)
            : null;
        if (typeof text !== 'string' || !text.trim()) {
          lastError = 'BAD_RESPONSE';
          continue;
        }
        try {
          return extractionResultSchema.parse(parseModelJson(text));
        } catch {
          lastError = 'BAD_RESPONSE';
        }
      }
      throw new AnamnesisProviderError(lastError, lastError === 'UPSTREAM');
    },
  };
}

function unconfiguredProvider(): AnamnesisExtractionProvider {
  return {
    name: 'unconfigured',
    async extract() {
      throw new AnamnesisProviderError('NOT_CONFIGURED', false);
    },
  };
}

// Детерминированный ответ для контрольного файла: включается переменной
// окружения с точным sha256 (E2E); на остальные файлы не распространяется.
export function fixtureExtractionResult(): ExtractionResult {
  return extractionResultSchema.parse({
    laboratory: 'Синтетическая лаборатория',
    title: 'Синтетические результаты исследований',
    issuedAt: '15.01.2027',
    observations: [
      {
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
      },
      {
        name: '25-OH Витамин D',
        rawText: 'Витамин D 10.06.2026 28,4 нг/мл',
        pageNumber: 1,
        value: '28,4',
        comparator: 'eq',
        unit: 'нг/мл',
        collectedAt: '10.06.2026',
        sourceKind: 'historical_result',
        reference: null,
      },
      {
        name: 'АЛТ',
        rawText: 'Аланинаминотрансфераза (АЛТ) 30,1 Ед/л',
        pageNumber: 2,
        value: '30,1',
        comparator: 'eq',
        unit: 'Ед/л',
        collectedAt: '15.01.2027',
        sourceKind: 'current_result',
        reference: null,
      },
      {
        name: 'АСТ',
        rawText: 'Аспартатаминотрансфераза (АСТ) 25,3 Ед/л',
        pageNumber: 2,
        value: '25,3',
        comparator: 'eq',
        unit: 'Ед/л',
        collectedAt: '15.01.2027',
        sourceKind: 'current_result',
        reference: null,
      },
      {
        name: 'Альфа-амилаза панкреатическая',
        rawText: 'Альфа-амилаза панкреатическая 52,0 Ед/л',
        pageNumber: 2,
        value: '52,0',
        comparator: 'eq',
        unit: 'Ед/л',
        collectedAt: '15.01.2027',
        sourceKind: 'current_result',
        reference: null,
      },
      {
        name: 'Билирубин общий',
        rawText: 'Билирубин общий 9,1 мкмоль/л',
        pageNumber: 2,
        value: '9,1',
        comparator: 'eq',
        unit: 'мкмоль/л',
        collectedAt: '15.01.2027',
        sourceKind: 'current_result',
        reference: null,
      },
      {
        name: '25-OH Витамин D',
        rawText: '25-OH Витамин D 41,2 нг/мл',
        pageNumber: 3,
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
      },
    ],
  });
}

export function anamnesisExtractionProvider(
  env = readServerEnv(),
): AnamnesisExtractionProvider {
  const base = env.ANAMNESIS_LLM_API_KEY
    ? glmProvider({
        baseUrl: env.ANAMNESIS_LLM_BASE_URL,
        apiKey: env.ANAMNESIS_LLM_API_KEY,
        model: env.ANAMNESIS_LLM_MODEL,
        timeoutMs: env.ANAMNESIS_LLM_TIMEOUT_MS,
      })
    : unconfiguredProvider();
  const fixtureSha = env.ANAMNESIS_EXTRACTION_FIXTURE_SHA256;
  if (!fixtureSha) return base;
  return {
    name: `${base.name}+fixture`,
    async extract(input) {
      if (input.sha256 === fixtureSha) return fixtureExtractionResult();
      return base.extract(input);
    },
  };
}

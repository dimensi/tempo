import 'server-only';
import { z } from 'zod';
import { readServerEnv } from '@/server/env';
import {
  extractionResultSchema,
  type ExtractionResult,
  type FailedAnamnesisPage,
} from '@/contracts/anamnesis';

export interface ExtractionRequestPage {
  pageNumber: number;
  lines: string[];
  imagePng: Buffer | null;
}

export interface AnamnesisExtractionProvider {
  readonly name: string;
  // Провайдер возвращает сырой ответ модели: приведение к контракту и
  // мягкая нормализация выполняются в extraction-normalize.
  extract(input: {
    sha256: string;
    pages: ExtractionRequestPage[];
  }): Promise<{ result: unknown; failedPages: FailedAnamnesisPage[] }>;
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
  'Каждый элемент observations: {"specimen": "urine" для мочи, "blood" для крови/сыворотки/плазмы или null,',
  '"name": название показателя как в документе,',
  'Материал specimen бери из строки или заголовка этой страницы; не угадывай его по единице или названию анализа.',
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
  'Колонка «Результат» содержит текущие результаты; их дата — дата взятия биоматериала в шапке.',
  'Колонка «Пр. рез-т» содержит исторические результаты с датами, напечатанными рядом с ними.',
  'Не подменяй дату текущего результата датой из исторической колонки.',
  'Референсные значения, пороги дефицита/токсичности и пояснения не являются наблюдениями.',
  'Извлекай обе колонки: для строки с текущим и прежним результатом нужны два observations.',
  'Единица в общей колонке строки относится и к текущему, и к историческому значению этой строки.',
  'Сохраняй кириллицу в названиях показателей: не заменяй русские буквы похожими латинскими.',
  'unit — только краткое обозначение единицы измерения из документа (не более 30 символов).',
  'Расшифровки, метод исследования и пояснения оставляй в rawText, не добавляй их в unit.',
  'Если единица отсутствует, верни unit: null; не придумывай и не обрезай обозначение.',
  'Знак comparator относится только к самому результату: знаки из референсной колонки к нему не переносятся.',
].join(' ');

function parseModelJson(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(stripped);
}

const PAGE_MAX_TOKENS = 16384;
// The provider's constrained decoder cannot compile the full validation schema.
// Keep field shapes/enums on the wire; apply all original bounds locally below.
const extractionJsonSchema: unknown = JSON.parse(
  JSON.stringify(
    z.toJSONSchema(extractionResultSchema),
    (key, value: unknown) =>
      [
        '$schema',
        'minimum',
        'maximum',
        'minLength',
        'maxLength',
        'minItems',
        'maxItems',
      ].includes(key)
        ? undefined
        : value,
  ),
);

function openRouterProvider(config: {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}): AnamnesisExtractionProvider {
  async function extractPage(
    page: ExtractionRequestPage,
  ): Promise<ExtractionResult> {
    const content: unknown[] = [
      {
        type: 'text',
        text: `Распознай только страницу ${page.pageNumber}. Каждый напечатанный результат верни один раз. Не продолжай таблицу и не дополняй отсутствующие строки. Если данных нет, верни пустой observations. pageNumber у всех результатов должен быть ${page.pageNumber}.\n${page.lines.join('\n') || '(текстового слоя нет, смотри изображение)'}`,
      },
    ];
    if (page.imagePng)
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${page.imagePng.toString('base64')}`,
        },
      });
    const request = {
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content },
      ],
      temperature: 0,
      max_tokens: PAGE_MAX_TOKENS,
      provider: { require_parameters: true },
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'laboratory_page',
          strict: true,
          schema: extractionJsonSchema,
        },
      },
    };
    let lastError: 'UPSTREAM' | 'BAD_RESPONSE' = 'UPSTREAM';
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      let payload: unknown;
      try {
        response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
        if (response.status >= 500 || response.status === 429) {
          lastError = 'UPSTREAM';
          continue;
        }
        if (!response.ok) throw new AnamnesisProviderError('UPSTREAM', false);
        payload = await response.json();
      } catch (error) {
        if (error instanceof AnamnesisProviderError) throw error;
        lastError = error instanceof SyntaxError ? 'BAD_RESPONSE' : 'UPSTREAM';
        continue;
      }
      if (!payload || typeof payload !== 'object') {
        lastError = 'BAD_RESPONSE';
        continue;
      }
      if ('error' in payload) {
        const error = payload.error as { code?: unknown } | null;
        const code = Number(error?.code);
        if (code === 429 || code >= 500) {
          lastError = 'UPSTREAM';
          continue;
        }
        throw new AnamnesisProviderError('UPSTREAM', false);
      }
      const choice =
        'choices' in payload && Array.isArray(payload.choices)
          ? (payload.choices[0] as
              | { finish_reason?: unknown; message?: { content?: unknown } }
              | undefined)
          : undefined;
      // A valid JSON prefix is not a completed extraction. Never persist truncated output.
      if (
        choice?.finish_reason === 'length' ||
        choice?.finish_reason === 'content_filter'
      )
        throw new AnamnesisProviderError('BAD_RESPONSE', false);
      if (
        choice?.finish_reason !== 'stop' ||
        typeof choice.message?.content !== 'string'
      ) {
        lastError = 'BAD_RESPONSE';
        continue;
      }
      try {
        const parsed = extractionResultSchema.safeParse(
          parseModelJson(choice.message.content),
        );
        if (
          !parsed.success ||
          parsed.data.observations.some(
            (item) => item.pageNumber !== page.pageNumber,
          )
        ) {
          const issues = parsed.success
            ? [{ path: 'observations.pageNumber', code: 'wrong_page' }]
            : parsed.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                code: issue.code,
                ...('maximum' in issue ? { maximum: issue.maximum } : {}),
                ...('minimum' in issue ? { minimum: issue.minimum } : {}),
              }));
          // Only schema paths and bounds: never log medical text or model output.
          console.warn('Anamnesis extraction validation failed', {
            pageNumber: page.pageNumber,
            issues,
          });
          if (attempt === 0)
            content.push({
              type: 'text',
              text: `Предыдущий ответ не прошёл проверку: ${JSON.stringify(issues)}. Повторно извлеки эту же страницу, исправив указанные поля и соблюдая minimum/maximum. Для строк это длина в символах. Не обрезай результаты и не выдумывай данные.`,
            });
          lastError = 'BAD_RESPONSE';
          continue;
        }
        return parsed.data;
      } catch {
        lastError = 'BAD_RESPONSE';
      }
    }
    throw new AnamnesisProviderError(lastError, lastError === 'UPSTREAM');
  }
  return {
    name: 'openrouter',
    async extract({ pages }) {
      const results: ExtractionResult[] = [];
      const failedPages: FailedAnamnesisPage[] = [];
      for (const page of pages) {
        if (!page.lines.length && !page.imagePng) {
          failedPages.push({
            pageNumber: page.pageNumber,
            code: 'UNREADABLE_PAGE',
          });
          continue;
        }
        try {
          results.push(await extractPage(page));
        } catch (error) {
          if (
            !(error instanceof AnamnesisProviderError) ||
            error.code === 'NOT_CONFIGURED'
          )
            throw error;
          failedPages.push({ pageNumber: page.pageNumber, code: error.code });
        }
      }
      const combined = extractionResultSchema.safeParse({
        laboratory:
          results.find((result) => result.laboratory !== null)?.laboratory ??
          null,
        title: results.find((result) => result.title !== null)?.title ?? null,
        issuedAt:
          results.find((result) => result.issuedAt !== null)?.issuedAt ?? null,
        observations: results.flatMap((result) => result.observations),
      });
      if (!combined.success)
        throw new AnamnesisProviderError('BAD_RESPONSE', false);
      return { result: combined.data, failedPages };
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
        specimen: 'blood',
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
        specimen: 'blood',
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
        specimen: 'blood',
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
        specimen: 'blood',
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
        specimen: 'blood',
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
        specimen: 'blood',
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
        specimen: 'blood',
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
  const base = env.OPENROUTER_API_KEY
    ? openRouterProvider({
        baseUrl: env.ANAMNESIS_LLM_BASE_URL,
        apiKey: env.OPENROUTER_API_KEY,
        model: env.ANAMNESIS_LLM_MODEL,
        timeoutMs: env.ANAMNESIS_LLM_TIMEOUT_MS,
      })
    : unconfiguredProvider();
  const fixtureSha = env.ANAMNESIS_EXTRACTION_FIXTURE_SHA256;
  if (!fixtureSha) return base;
  return {
    name: `${base.name}+fixture`,
    async extract(input) {
      if (input.sha256 === fixtureSha)
        return { result: fixtureExtractionResult(), failedPages: [] };
      return base.extract(input);
    },
  };
}

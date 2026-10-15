import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readServerEnv } from '@/server/env';
import {
  anamnesisExtractionProvider,
  fixtureExtractionResult,
} from '@/server/anamnesis/providers';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'file::memory:',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 's'.repeat(48),
} as const;
const input = {
  sha256: 'a'.repeat(64),
  pages: [
    { pageNumber: 1, lines: [], imagePng: Buffer.from('synthetic-image') },
  ],
};
const emptyResult = {
  laboratory: null,
  title: null,
  issuedAt: null,
  observations: [],
};
afterEach(() => vi.unstubAllGlobals());

describe('OpenRouter anamnesis extraction', () => {
  it('sends private page images and requests JSON from the selected vision model', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify(emptyResult) },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const provider = anamnesisExtractionProvider(
      readServerEnv({
        ...baseEnv,
        OPENROUTER_API_KEY: 'synthetic-openrouter-key',
      }),
    );
    expect(provider.name).toBe('openrouter');
    await expect(provider.extract(input)).resolves.toEqual(emptyResult);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(options.headers.Authorization).toBe(
      'Bearer synthetic-openrouter-key',
    );
    const body = JSON.parse(options.body);
    expect(body.model).toBe('google/gemini-3.8-flash');
    expect(body.max_tokens).toBe(16384);
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true, name: 'laboratory_page' },
    });
    expect(JSON.stringify(body.response_format)).not.toContain('maxItems');
    expect(JSON.stringify(body.response_format)).not.toContain('maxLength');
    expect(body.messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: {
        url:
          'data:image/png;base64,' +
          input.pages[0]!.imagePng.toString('base64'),
      },
    });
  });

  it('does not use an old subscription key when the OpenRouter key is absent', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const provider = anamnesisExtractionProvider(
      readServerEnv({
        ...baseEnv,
        ANAMNESIS_LLM_API_KEY: 'old-subscription-key',
      }),
    );
    await expect(provider.extract(input)).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an endpoint outside OpenRouter', () => {
    expect(() =>
      readServerEnv({
        ...baseEnv,
        ANAMNESIS_LLM_BASE_URL: 'https://api.z.ai/api/coding/paas/v4',
      }),
    ).toThrow();
  });

  it('does not retry a rejected key or switch providers', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const provider = anamnesisExtractionProvider(
      readServerEnv({
        ...baseEnv,
        OPENROUTER_API_KEY: 'synthetic-openrouter-key',
      }),
    );
    await expect(provider.extract(input)).rejects.toMatchObject({
      code: 'UPSTREAM',
      transient: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('recognizes pages separately and merges their observations with original page numbers', async () => {
    const candidate = fixtureExtractionResult().observations[0]!;
    const first = {
      ...emptyResult,
      laboratory: 'Synthetic lab',
      observations: [{ ...candidate, pageNumber: 1 }],
    };
    const second = {
      ...emptyResult,
      observations: [{ ...candidate, pageNumber: 2 }],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(first) },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(second) },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetch);
    const provider = anamnesisExtractionProvider(
      readServerEnv({ ...baseEnv, OPENROUTER_API_KEY: 'synthetic-key' }),
    );
    const result = await provider.extract({
      ...input,
      pages: [...input.pages, { ...input.pages[0]!, pageNumber: 2 }],
    });
    expect(result).toEqual({
      ...emptyResult,
      laboratory: 'Synthetic lab',
      observations: [...first.observations, ...second.observations],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [index, call] of fetch.mock.calls.entries()) {
      const body = JSON.parse(call[1].body);
      expect(
        body.messages[1].content.filter(
          (item: { type: string }) => item.type === 'image_url',
        ),
      ).toHaveLength(1);
      expect(body.messages[1].content[0].text).toContain(
        `страницу ${index + 1}`,
      );
    }
  });

  it('rejects a length-truncated completion without retrying or accepting its valid JSON prefix', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: 'length',
            message: { content: JSON.stringify(emptyResult) },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const provider = anamnesisExtractionProvider(
      readServerEnv({ ...baseEnv, OPENROUTER_API_KEY: 'synthetic-key' }),
    );
    await expect(provider.extract(input)).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
      transient: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not return a partial document when a later page fails', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(emptyResult) },
            },
          ],
        }),
      )
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const provider = anamnesisExtractionProvider(
      readServerEnv({ ...baseEnv, OPENROUTER_API_KEY: 'synthetic-key' }),
    );
    await expect(
      provider.extract({
        ...input,
        pages: [...input.pages, { ...input.pages[0]!, pageNumber: 2 }],
      }),
    ).rejects.toMatchObject({ code: 'UPSTREAM' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('classifies a body timeout after HTTP 200 as an upstream failure', async () => {
    const fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new DOMException('Synthetic timeout', 'TimeoutError');
      },
    }));
    vi.stubGlobal('fetch', fetch);
    const provider = anamnesisExtractionProvider(
      readServerEnv({ ...baseEnv, OPENROUTER_API_KEY: 'synthetic-key' }),
    );
    await expect(provider.extract(input)).rejects.toMatchObject({
      code: 'UPSTREAM',
      transient: true,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('handles an error envelope received with HTTP 200 as a provider failure', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () => Response.json({ error: { code: 503 } }));
    vi.stubGlobal('fetch', fetch);
    const provider = anamnesisExtractionProvider(
      readServerEnv({ ...baseEnv, OPENROUTER_API_KEY: 'synthetic-key' }),
    );
    await expect(provider.extract(input)).rejects.toMatchObject({
      code: 'UPSTREAM',
      transient: true,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

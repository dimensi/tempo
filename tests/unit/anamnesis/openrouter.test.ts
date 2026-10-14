import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readServerEnv } from '@/server/env';
import { anamnesisExtractionProvider } from '@/server/anamnesis/providers';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'file::memory:',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 's'.repeat(48),
} as const;
const input = {
  sha256: 'a'.repeat(64),
  pages: [
    { pageNumber: 1, lines: [], imageJpeg: Buffer.from('synthetic-image') },
  ],
};
afterEach(() => vi.unstubAllGlobals());

describe('OpenRouter anamnesis extraction', () => {
  it('sends private page images and requests JSON from the selected vision model', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          { message: { content: JSON.stringify({ observations: [] }) } },
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
    await expect(provider.extract(input)).resolves.toEqual({
      observations: [],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(options.headers.Authorization).toBe(
      'Bearer synthetic-openrouter-key',
    );
    const body = JSON.parse(options.body);
    expect(body.model).toBe('google/gemini-2.5-flash-lite');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: {
        url:
          'data:image/jpeg;base64,' +
          input.pages[0]!.imageJpeg.toString('base64'),
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
});

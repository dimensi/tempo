import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, expect, it, vi } from 'vitest';

const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }));
vi.mock('node:https', () => ({ request: network.request }));
const { fetchCdnImage } = await import('@/server/nutrition/images');
const answers = [
  { address: '104.26.8.211', family: 4 },
  { address: '2606:4700:20::681a:8d3', family: 6 },
];
const image = Buffer.from([255, 216, 255, 0]);

beforeEach(() => {
  vi.clearAllMocks();
  network.lookup.mockResolvedValue(answers);
});

it.each([true, false])(
  'downloads a validated image with Node DNS all=%s and no CDN credentials',
  async (all) => {
    network.request.mockImplementation((_url, options, onResponse) => {
      expect(options.headers).toEqual({
        Accept: 'image/jpeg,image/png,image/webp',
      });
      const request = new EventEmitter() as EventEmitter & { end(): void };
      request.end = () => {
        options.lookup(
          'images.yazio-cdn.com',
          { all },
          (error: unknown, result: unknown, family?: number) => {
            expect(error).toBeNull();
            // Node 22's family selection expects an array for all=true. A
            // single-address callback caused ERR_INVALID_IP_ADDRESS in production.
            if (all) expect(result).toEqual(answers);
            else {
              expect(result).toBe(answers[0]!.address);
              expect(family).toBe(4);
            }
            const response = Object.assign(new PassThrough(), {
              statusCode: 200,
              headers: { 'content-type': 'image/jpeg' },
            });
            onResponse(response);
            response.end(image);
          },
        );
      };
      return request;
    });
    await expect(
      fetchCdnImage('https://images.yazio-cdn.com/test.jpg'),
    ).resolves.toEqual({ bytes: image, mime: 'image/jpeg' });
    expect(network.lookup).toHaveBeenCalledWith('images.yazio-cdn.com', {
      all: true,
    });
  },
);

it('rejects mixed public/private DNS results before opening HTTPS', async () => {
  network.lookup.mockResolvedValue([
    answers[0],
    { address: '127.0.0.1', family: 4 },
  ]);
  await expect(
    fetchCdnImage('https://images.yazio-cdn.com/test.jpg'),
  ).rejects.toThrow('Invalid image address');
  expect(network.request).not.toHaveBeenCalled();
});

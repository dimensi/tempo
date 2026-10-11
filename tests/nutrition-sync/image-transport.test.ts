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

function respond(
  statusCode: number,
  headers: Record<string, string>,
  bytes: Buffer,
) {
  return (
    _url: URL,
    _options: unknown,
    callback: (response: unknown) => void,
  ) => {
    const req = new EventEmitter() as EventEmitter & { end(): void };
    req.end = () => {
      const res = Object.assign(new PassThrough(), {
        statusCode,
        headers,
        complete: true,
      });
      callback(res);
      res.end(bytes);
    };
    return req;
  };
}
function interrupted() {
  const req = new EventEmitter() as EventEmitter & { end(): void };
  req.end = () =>
    req.emit(
      'error',
      Object.assign(new Error('Interrupted'), { code: 'ABORT_ERR' }),
    );
  return req;
}
it('recovers an interrupted image in bounded pinned segments with a stable strong ETag', async () => {
  const bytes = Buffer.alloc(9000);
  image.copy(bytes);
  network.request
    .mockImplementationOnce(interrupted)
    .mockImplementationOnce(
      respond(
        206,
        {
          'content-type': 'image/jpeg',
          'content-range': 'bytes 0-8191/9000',
          'content-length': '8192',
          etag: '"version-one"',
        },
        bytes.subarray(0, 8192),
      ),
    )
    .mockImplementationOnce(
      respond(
        206,
        {
          'content-type': 'image/jpeg',
          'content-range': 'bytes 8192-8999/9000',
          'content-length': '808',
          etag: '"version-one"',
        },
        bytes.subarray(8192),
      ),
    );
  await expect(
    fetchCdnImage('https://images.yazio-cdn.com/test.jpg'),
  ).resolves.toEqual({ bytes, mime: 'image/jpeg' });
  const options = network.request.mock.calls[2]![1];
  expect(options.agent).toBe(false);
  expect(options.headers['If-Range']).toBe('"version-one"');
  expect(options.headers.Authorization).toBeUndefined();
  expect(network.lookup).toHaveBeenCalledTimes(1);
});
it.each([
  [
    'changed object',
    {
      'content-type': 'image/jpeg',
      'content-range': 'bytes 8192-8999/9000',
      'content-length': '808',
      etag: '"changed"',
    },
  ],
  [
    'wrong offset',
    {
      'content-type': 'image/jpeg',
      'content-range': 'bytes 8193-8999/9000',
      'content-length': '807',
      etag: '"version-one"',
    },
  ],
])(
  'rejects %s during recovery without returning a mixed image',
  async (_label, headers) => {
    network.request
      .mockImplementationOnce(interrupted)
      .mockImplementationOnce(
        respond(
          206,
          {
            'content-type': 'image/jpeg',
            'content-range': 'bytes 0-8191/9000',
            'content-length': '8192',
            etag: '"version-one"',
          },
          Buffer.alloc(8192),
        ),
      )
      .mockImplementationOnce(respond(206, headers, Buffer.alloc(808)));
    await expect(
      fetchCdnImage('https://images.yazio-cdn.com/test.jpg'),
    ).rejects.toThrow('Invalid image range response');
  },
);
it.each([302, 403, 429])(
  'does not recover denied or redirected HTTP %s',
  async (status) => {
    network.request.mockImplementationOnce(
      respond(status, { 'content-type': 'image/jpeg' }, image),
    );
    await expect(
      fetchCdnImage('https://images.yazio-cdn.com/test.jpg'),
    ).rejects.toThrow('Image request failed');
    expect(network.request).toHaveBeenCalledTimes(1);
  },
);
it('bounds recovery request count before downloading an oversized object', async () => {
  network.request
    .mockImplementationOnce(interrupted)
    .mockImplementationOnce(
      respond(
        206,
        {
          'content-type': 'image/jpeg',
          'content-range': 'bytes 0-8191/524289',
          'content-length': '8192',
          etag: '"version-one"',
        },
        Buffer.alloc(8192),
      ),
    );
  await expect(
    fetchCdnImage('https://images.yazio-cdn.com/test.jpg'),
  ).rejects.toThrow('Invalid image range response');
  expect(network.request).toHaveBeenCalledTimes(2);
});

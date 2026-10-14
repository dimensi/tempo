import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));

const { validateObjectKey, storageNamespaceKey } =
  await import('@/server/storage/keys');
const { fsObjectStorage } = await import('@/server/storage/fs');
const { s3ObjectStorage } = await import('@/server/storage/s3');
const { analyzeAnamnesisPdf } = await import('@/server/anamnesis/pdf');

it('parses a PDF read from the S3 Node stream', async () => {
  const pdf = readFileSync('tests/fixtures/anamnesis/synthetic-lab.pdf');
  const send = vi.spyOn(S3Client.prototype, 'send').mockResolvedValueOnce({
    Body: Readable.from([pdf.subarray(0, 100), pdf.subarray(100)]),
  } as never);
  try {
    const storage = s3ObjectStorage({
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'test',
      accessKeyId: 'synthetic',
      secretAccessKey: 'synthetic',
    });
    const bytes = await storage.get('anamnesis/owner-1/synthetic.pdf');
    const pages = await analyzeAnamnesisPdf(bytes);
    expect(pages).toHaveLength(3);
    expect(pages[0]!.width).toBeGreaterThan(0);
  } finally {
    send.mockRestore();
  }
});

describe('object storage keys', () => {
  it('accepts namespaced keys with extension', () => {
    expect(() =>
      validateObjectKey('anamnesis/0d11a2b3-4c5d/44dd72c6.pdf'),
    ).not.toThrow();
    expect(storageNamespaceKey('media', 'owner-1', 'abc.jpg')).toBe(
      'media/owner-1/abc.jpg',
    );
  });

  it.each([
    ['../secret'],
    ['anamnesis/../../etc/passwd'],
    ['anamnesis/owner/abc.pdf/extra-segment.pdf/../..'],
    ['/absolute/path.pdf'],
    ['anamnesis//owner.pdf'],
    ['anamnesis/owner/'],
    [''],
    ['anamneses/owner/ОБЪЕКТ.pdf'],
    ['anamnesis/owner/объект.pdf'],
    ['anamnesis\\owner\\file.pdf'],
    ['anamnesis/owner/file.pdf\njunk'],
    ['anamnesis/owner/file.pdf trailing'],
    ['.'.repeat(401)],
  ])('rejects malformed key %s', (key) => {
    expect(() => validateObjectKey(key as string)).toThrow(
      /Invalid storage key/,
    );
  });

  it('blocks a safe prefix with an unsafe tail', () => {
    // Паттерн анкерирован: валидный префикс не легализует хвост.
    expect(() => validateObjectKey('anamnesis/ok.pdf/../../root')).toThrow();
    expect(() => validateObjectKey('media/ok.pdf/ОБЪЕКТ.pdf')).toThrow();
    expect(() => validateObjectKey('media/ok.pdf trailing')).toThrow();
    expect(() => validateObjectKey('media/ok.pdf/x ')).toThrow();
  });
});

describe('fs object storage containment', () => {
  const root = mkdtempSync(join(tmpdir(), 'object-storage-'));
  const storage = fsObjectStorage({ rootDir: root });

  it('round-trips objects and overwrites on put', async () => {
    await storage.put('anamnesis/owner-1/aaa.pdf', new Uint8Array([1, 2, 3]));
    expect(await storage.get('anamnesis/owner-1/aaa.pdf')).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await storage.put('anamnesis/owner-1/aaa.pdf', new Uint8Array([9]));
    expect(await storage.get('anamnesis/owner-1/aaa.pdf')).toEqual(
      new Uint8Array([9]),
    );
    await storage.remove('anamnesis/owner-1/aaa.pdf');
    await storage.remove('anamnesis/owner-1/aaa.pdf');
    await expect(storage.get('anamnesis/owner-1/aaa.pdf')).rejects.toThrow();
  });

  it.each([
    ['../escape.pdf'],
    ['anamnesis/../../escape.pdf'],
    ['/absolute.pdf'],
    ['anamnesis/owner/x.pdf/..'],
  ])('refuses %s on every operation', async (key) => {
    await expect(storage.put(key, new Uint8Array([1]))).rejects.toThrow(
      /Invalid storage key/,
    );
    await expect(storage.get(key)).rejects.toThrow(/Invalid storage key/);
    await expect(storage.remove(key)).rejects.toThrow(/Invalid storage key/);
  });

  it('keeps writes inside the storage root', async () => {
    await storage.put('anamnesis/owner-2/bbb.pdf', new Uint8Array([7]));
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(
      join(root, 'object-storage', 'anamnesis', 'owner-2', 'bbb.pdf'),
    );
    expect(bytes).toEqual(Buffer.from([7]));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
});

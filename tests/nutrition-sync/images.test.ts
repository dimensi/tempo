import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { validateCdnUrl, isPublicAddress, validateImage, MAX_IMAGE_BYTES } =
  await import('@/server/nutrition/images');
it('permits the HTTPS CDN only and rejects private/reserved DNS addresses', () => {
  expect(validateCdnUrl('https://images.yazio-cdn.com/a.jpg').hostname).toBe(
    'images.yazio-cdn.com',
  );
  for (const url of [
    'http://images.yazio-cdn.com/a',
    'https://images.yazio-cdn.com.evil.test/a',
    'https://127.0.0.1/a',
    'https://user@images.yazio-cdn.com/a',
    'https://images.yazio-cdn.com:8443/a',
  ])
    expect(() => validateCdnUrl(url)).toThrow();
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
  ])
    expect(isPublicAddress(ip)).toBe(false);
  expect(isPublicAddress('8.8.8.8')).toBe(true);
});
it('requires bounded image bytes and matching MIME/magic bytes', () => {
  expect(
    validateImage(Buffer.from([255, 216, 255, 0]), 'image/jpeg'),
  ).toHaveLength(4);
  expect(() => validateImage(Buffer.from('<svg/>'), 'image/svg+xml')).toThrow();
  expect(() => validateImage(Buffer.from('<html/>'), 'image/jpeg')).toThrow();
  expect(() =>
    validateImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/jpeg'),
  ).toThrow();
});

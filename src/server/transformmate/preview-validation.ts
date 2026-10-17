import 'server-only';
export function selectPreviewUrl(value: string | null): URL | null {
  if (!value || !/^https:\/\/transformmate\.pht\.space(?:[/?]|$)/.test(value))
    return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'transformmate.pht.space' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash
      ? url
      : null;
  } catch {
    return null;
  }
}
export function matchesSignature(bytes: Uint8Array, type: string) {
  if (type === 'image/jpeg')
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png')
    return [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    );
  const text = (start: number, end: number) =>
    new TextDecoder().decode(bytes.slice(start, end));
  if (type === 'image/webp')
    return text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP';
  return (
    text(4, 8) === 'ftyp' && (text(8, 12) === 'avif' || text(8, 12) === 'avis')
  );
}

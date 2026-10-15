import { deflateSync } from 'node:zlib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { analyzeAnamnesisPdf } from '@/server/anamnesis/pdf';

// Synthetic quadrants: raw bitmap rows are red/green, then blue/yellow.
// A PDF can transform that bitmap independently of its embedded pixel order.
function scannedPdf(matrix: string, rotation = 0): Uint8Array {
  const pixels = deflateSync(
    Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]),
  );
  const commands = Buffer.from(`q ${matrix} cm /Im0 Do Q`);
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Rotate ${rotation} /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Interpolate false /Length ${pixels.length} >>\nstream\n`,
      ),
      pixels,
      Buffer.from('\nendstream'),
    ]),
    Buffer.concat([
      Buffer.from(`<< /Length ${commands.length} >>\nstream\n`),
      commands,
      Buffer.from('\nendstream'),
    ]),
  ];
  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(
      Buffer.from(`${i + 1} 0 obj\n`),
      object,
      Buffer.from('\nendobj\n'),
    );
  }
  const xref = Buffer.concat(chunks).length;
  chunks.push(
    Buffer.from(
      `xref\n0 6\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
        .join(
          '',
        )}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
    ),
  );
  return new Uint8Array(Buffer.concat(chunks));
}

async function corners(matrix: string, rotation = 0) {
  const [page] = await analyzeAnamnesisPdf(scannedPdf(matrix, rotation));
  const image = await loadImage(page!.imagePng!);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ].map(([x, y]) =>
    Array.from(
      context.getImageData(
        Math.floor(x! * image.width),
        Math.floor(y! * image.height),
        1,
        1,
      ).data,
    ).slice(0, 3),
  );
}
const red = [255, 0, 0],
  green = [0, 255, 0],
  blue = [0, 0, 255],
  yellow = [255, 255, 0];
describe('OCR renders the PDF page transformation', () => {
  it('preserves an ordinary image matrix', async () => {
    expect(await corners('100 0 0 100 0 0')).toEqual([
      red,
      green,
      blue,
      yellow,
    ]);
  });
  it('applies a negative vertical matrix instead of sending raw reflected pixels', async () => {
    expect(await corners('100 0 0 -100 0 100')).toEqual([
      blue,
      yellow,
      red,
      green,
    ]);
  });
  it('applies page rotation as well as image placement', async () => {
    expect(await corners('100 0 0 100 0 0', 90)).toEqual([
      blue,
      red,
      yellow,
      green,
    ]);
  });
});

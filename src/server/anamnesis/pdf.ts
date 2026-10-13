import 'server-only';
import { getDocumentProxy } from 'unpdf';
import jpeg from 'jpeg-js';
import { readServerEnv } from '@/server/env';

// Порог «пригодного» текстового слоя: короткие обрывки текста OCR не отменяют.
const MIN_TEXT_LAYER_CHARS = 50;
// Целевой размер длинной стороны страницы для vision-запроса.
const OCR_IMAGE_MAX_DIMENSION = 1800;

export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfPageAnalysis {
  pageNumber: number;
  width: number | null;
  height: number | null;
  items: PdfTextItem[];
  lines: string[];
  hasTextLayer: boolean;
  imageJpeg: Buffer | null;
}

// pdfjs OPS.paintImageXObject — стабильная константа библиотеки.
const PAINT_IMAGE_XOBJECT = 85;
const IMAGE_KIND = {
  GRAYSCALE_1BPP: 1,
  RGB_24BPP: 2,
  RGBA_32BPP: 3,
} as const;

interface RawImage {
  width: number;
  height: number;
  kind: number;
  data: Uint8ClampedArray;
}

export async function analyzeAnamnesisPdf(
  bytes: Uint8Array,
): Promise<PdfPageAnalysis[]> {
  const pdf = await getDocumentProxy(bytes);
  const pages: PdfPageAnalysis[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      items.push({
        text: item.str,
        x: viewport.width ? item.transform[4]! / viewport.width : 0,
        y: viewport.height ? 1 - item.transform[5]! / viewport.height : 0,
        width: viewport.width ? (item.width ?? 0) / viewport.width : 0,
        height: viewport.height ? (item.height ?? 0) / viewport.height : 0,
      });
    }
    const totalChars = items.reduce(
      (sum, item) => sum + item.text.trim().length,
      0,
    );
    const hasTextLayer = totalChars >= MIN_TEXT_LAYER_CHARS;
    const lines = buildLines(items);
    let imageJpeg: Buffer | null = null;
    if (!hasTextLayer) {
      const raw = await extractDominantImage(page);
      if (raw) imageJpeg = encodeJpeg(raw);
    }
    pages.push({
      pageNumber,
      width: viewport.width || null,
      height: viewport.height || null,
      items: hasTextLayer ? items : [],
      lines,
      hasTextLayer,
      imageJpeg,
    });
  }
  return pages;
}

function buildLines(items: PdfTextItem[]): string[] {
  const rows = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    const key = Math.round(item.y * 1000);
    const row = rows.get(key);
    if (row) row.push(item);
    else rows.set(key, [item]);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) =>
      row
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean);
}

async function extractDominantImage(page: {
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs: { get: (id: string, callback: (data: RawImage) => void) => void };
  commonObjs: { get: (id: string, callback: (data: RawImage) => void) => void };
}): Promise<RawImage | null> {
  const opList = await page.getOperatorList();
  const candidates: Promise<RawImage>[] = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    if (opList.fnArray[i] !== PAINT_IMAGE_XOBJECT) continue;
    const name = opList.argsArray[i]![0];
    if (typeof name !== 'string') continue;
    const objs = name.startsWith('g_') ? page.commonObjs : page.objs;
    candidates.push(
      new Promise<RawImage>((resolveImage) => objs.get(name, resolveImage)),
    );
  }
  const images = await Promise.all(candidates);
  return (
    images.sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null
  );
}

function encodeJpeg(image: RawImage): Buffer {
  const { data: rgba, width, height } = toRgba(image);
  const factor = Math.max(
    1,
    Math.ceil(Math.max(width, height) / OCR_IMAGE_MAX_DIMENSION),
  );
  const targetWidth = Math.max(1, Math.floor(width / factor));
  const targetHeight = Math.max(1, Math.floor(height / factor));
  const output = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const source = ((y * factor + dy) * width + x * factor + dx) * 4;
          r += rgba[source]!;
          g += rgba[source + 1]!;
          b += rgba[source + 2]!;
          count++;
        }
      }
      const target = (y * targetWidth + x) * 4;
      output[target] = r / count;
      output[target + 1] = g / count;
      output[target + 2] = b / count;
      output[target + 3] = 255;
    }
  }
  return jpeg.encode(
    { data: output, width: targetWidth, height: targetHeight },
    80,
  ).data;
}

function toRgba(image: RawImage): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const { width, height, kind, data } = image;
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (kind === IMAGE_KIND.RGB_24BPP) {
    for (let i = 0, j = 0; i < width * height; i++, j += 4) {
      rgba[j] = data[i * 3]!;
      rgba[j + 1] = data[i * 3 + 1]!;
      rgba[j + 2] = data[i * 3 + 2]!;
      rgba[j + 3] = 255;
    }
  } else if (kind === IMAGE_KIND.RGBA_32BPP) {
    for (let i = 0, j = 0; i < width * height; i++, j += 4) {
      rgba[j] = data[i * 4]!;
      rgba[j + 1] = data[i * 4 + 1]!;
      rgba[j + 2] = data[i * 4 + 2]!;
      rgba[j + 3] = 255;
    }
  } else {
    // GRAYSCALE_1BPP: биты упакованы по строкам с добивкой до байта.
    const rowBytes = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
        const value = bit ? 255 : 0;
        const j = (y * width + x) * 4;
        rgba[j] = value;
        rgba[j + 1] = value;
        rgba[j + 2] = value;
        rgba[j + 3] = 255;
      }
    }
  }
  return { data: rgba, width, height };
}

// Загруженный файл проверяется по содержимому, а не по заявленному MIME.
export type AnamnesisUploadIssue =
  'EMPTY' | 'TOO_LARGE' | 'NOT_PDF' | 'TOO_MANY_PAGES' | 'CORRUPT';

export class AnamnesisUploadError extends Error {
  constructor(public readonly issue: AnamnesisUploadIssue) {
    super('Anamnesis upload rejected');
  }
}

export async function validateAnamnesisPdf(
  bytes: Uint8Array,
  limits: { maxBytes: number; maxPages: number } = anamnesisUploadLimits(),
): Promise<number> {
  if (!bytes.length) throw new AnamnesisUploadError('EMPTY');
  if (bytes.byteLength > limits.maxBytes)
    throw new AnamnesisUploadError('TOO_LARGE');
  const header = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    Math.min(bytes.byteLength, 1024),
  );
  if (!header.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
    if (!header.toString('latin1').includes('%PDF-'))
      throw new AnamnesisUploadError('NOT_PDF');
  }
  try {
    const pdf = await getDocumentProxy(bytes);
    if (pdf.numPages > limits.maxPages)
      throw new AnamnesisUploadError('TOO_MANY_PAGES');
    return pdf.numPages;
  } catch (error) {
    if (error instanceof AnamnesisUploadError) throw error;
    throw new AnamnesisUploadError('CORRUPT');
  }
}

export function anamnesisUploadLimits(env = readServerEnv()) {
  return {
    maxBytes: env.ANAMNESIS_IMPORT_MAX_BYTES,
    maxPages: env.ANAMNESIS_IMPORT_MAX_PAGES,
  };
}

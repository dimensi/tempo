import 'server-only';
import { getDocumentProxy, renderPageAsImage } from 'unpdf';
import { readServerEnv } from '@/server/env';

// Порог «пригодного» текстового слоя: короткие обрывки текста OCR не отменяют.
const MIN_TEXT_LAYER_CHARS = 50;
// Целевой размер длинной стороны страницы для vision-запроса.
const OCR_IMAGE_MAX_DIMENSION = 2400;

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
  imagePng: Buffer | null;
}

export async function analyzeAnamnesisPdf(
  bytes: Uint8Array,
): Promise<PdfPageAnalysis[]> {
  const pdf = await getDocumentProxy(bytes);
  const pages: PdfPageAnalysis[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    try {
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
      const imagePng = hasTextLayer
        ? null
        : Buffer.from(
            await renderPageAsImage(pdf, pageNumber, {
              canvasImport: () => import('@napi-rs/canvas'),
              scale:
                OCR_IMAGE_MAX_DIMENSION /
                Math.max(viewport.width, viewport.height),
            }),
          );
      pages.push({
        pageNumber,
        width: viewport.width || null,
        height: viewport.height || null,
        items: hasTextLayer ? items : [],
        lines,
        hasTextLayer,
        imagePng,
      });
    } catch {
      pages.push({
        pageNumber,
        width: null,
        height: null,
        items: [],
        lines: [],
        hasTextLayer: false,
        imagePng: null,
      });
    }
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

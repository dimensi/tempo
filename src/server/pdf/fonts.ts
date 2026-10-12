import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ReportError } from '@/server/pdf/errors';

export type ReportFonts = {
  sans: Uint8Array;
  bold: Uint8Array;
  serif: Uint8Array;
};

export async function readReportFonts(): Promise<ReportFonts> {
  try {
    // Static asset paths are traced into standalone; no host-font fallback.
    const [sans, bold, serif] = await Promise.all([
      readFile(join(process.cwd(), 'src/server/pdf/fonts/DejaVuSans.ttf')),
      readFile(join(process.cwd(), 'src/server/pdf/fonts/DejaVuSans-Bold.ttf')),
      readFile(join(process.cwd(), 'src/server/pdf/fonts/DejaVuSerif.ttf')),
      readFile(join(process.cwd(), 'src/server/pdf/fonts/LICENSE')),
    ]);
    if ([sans, bold, serif].some((font) => font.length > 2 * 1024 * 1024))
      throw new Error('Font budget');
    return { sans, bold, serif };
  } catch {
    throw new ReportError('RUNTIME', 503);
  }
}

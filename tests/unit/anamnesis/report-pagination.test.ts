import { describe, it, expect, vi } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import type { MedicalMarker, MedicalObservation } from '@/contracts/anamnesis';
vi.mock('server-only', () => ({}));
vi.mock('@/server/anamnesis/repository', () => ({}));
vi.mock('@/server/anamnesis/worker', () => ({}));
vi.mock(
  '@/features/anamnesis',
  async () => import('@/config/anamnesis-messages'),
);
const { renderMedicalReportHtml } =
  await import('@/server/anamnesis/report-template');
const { prepareMedicalReport, renderMedicalPdfReport } =
  await import('@/server/anamnesis/report-renderer');
const { readReportFonts } = await import('@/server/pdf/fonts');
function dataset(count: number, rows: number, long = false) {
  return Array.from({ length: count }, (_, markerIndex) => ({
    marker: {
      id: `marker-${markerIndex}`,
      code: `M${markerIndex}`,
      name: `Синтетический показатель ${markerIndex} ${long ? 'Длинное название '.repeat(12) : ''}`,
      shortName: null,
      category: 'other',
      description: null,
      preferredUnit: null,
      definitionVersion: 1,
    } as MedicalMarker,
    observations: Array.from(
      { length: rows },
      (_, rowIndex) =>
        ({
          id: `row-${markerIndex}-${rowIndex}`,
          ownerId: 'synthetic',
          markerId: `marker-${markerIndex}`,
          originalName: 'Контроль',
          value: {
            kind: 'numeric',
            value: `${markerIndex}${rowIndex}.123456`,
            comparator: 'eq',
          },
          originalUnit: 'Ед/л',
          normalizedValue: null,
          normalizedUnit: null,
          collectedAt: `2026-09-${String((rowIndex % 28) + 1).padStart(2, '0')}`,
          datePrecision: 'date',
          laboratoryName: 'Синтетическая лаборатория',
          referenceRange: {
            lower: '0',
            upper: '100',
            lowerInclusive: true,
            upperInclusive: true,
            originalText: long ? 'Длинный референс '.repeat(12) : '0–100',
          },
          referenceAssessment: 'unknown',
          verification: 'user_verified',
          extractionVersion: '1',
          revision: 1,
          createdAt: 1,
          updatedAt: 1,
        }) as MedicalObservation,
    ),
  }));
}
describe('compact medical report real PDF', () => {
  it('puts five markers and ten observations on one A4 with embedded Cyrillic fonts', async () => {
    const data = dataset(5, 2);
    const source = renderMedicalReportHtml(
      { markerIds: data.map((item) => item.marker.id), dateKeys: null },
      data,
      await readReportFonts(),
    );
    const prepared = await prepareMedicalReport(source);
    expect(prepared.pageCount).toBe(1);
    const bytes = await renderMedicalPdfReport(prepared.html);
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    try {
      const { totalPages, text } = await extractText(pdf, { mergePages: true });
      expect(totalPages).toBe(1);
      for (const item of data) {
        expect(text).toContain(item.marker.name.trim());
        for (const row of item.observations)
          expect(text).toContain(row.value.value.replace('.', ','));
      }
      const raw = Buffer.from(bytes).toString('latin1');
      expect(raw).toContain('/FontFile2');
      expect(raw).toContain('DejaVuSans');
    } finally {
      await pdf.loadingTask.destroy();
    }
  }, 30000);
  it('continues long groups with cloned headings, no missing rows or empty sheets', async () => {
    const data = dataset(2, 40, true);
    const prepared = await prepareMedicalReport(
      renderMedicalReportHtml(
        { markerIds: data.map((item) => item.marker.id), dateKeys: null },
        data,
        await readReportFonts(),
      ),
    );
    expect(prepared.pageCount).toBeGreaterThan(1);
    expect((prepared.html.match(/class="observation-row"/g) ?? []).length).toBe(
      80,
    );
    const bytes = await renderMedicalPdfReport(prepared.html);
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    try {
      const { totalPages, text } = await extractText(pdf);
      expect(totalPages).toBe(prepared.pageCount);
      for (const page of text) {
        expect(page).toContain('Синтетический показатель');
        expect(page).toContain('Референс');
        expect(page).toMatch(/\d+,123456/);
      }
    } finally {
      await pdf.loadingTask.destroy();
    }
  }, 30000);
});

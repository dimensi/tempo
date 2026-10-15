import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import {
  medicalMarkerSchema,
  medicalObservationSchema,
} from '@/contracts/anamnesis';
import { renderMedicalReportHtml } from '@/server/anamnesis/report-template';
import {
  prepareMedicalReport,
  renderMedicalPdfReport,
} from '@/server/anamnesis/report-renderer';
import { readReportFonts } from '@/server/pdf/fonts';
const output = process.argv[2];
assert.ok(output, 'Pass a disposable PDF output path');
assert.notEqual(process.getuid?.(), 0, 'Smoke must use the non-root runtime');
const dataset = Array.from({ length: 5 }, (_, index) => ({
  marker: medicalMarkerSchema.parse({
    id: `marker-${index}`,
    code: `M${index}`,
    name: `Синтетический показатель ${index}`,
    shortName: null,
    category: 'other',
    description: null,
    preferredUnit: null,
    definitionVersion: 1,
  }),
  observations: Array.from({ length: 2 }, (_, row) =>
    medicalObservationSchema.parse({
      id: `00000000-0000-4000-8000-${String(index * 2 + row).padStart(12, '0')}`,
      ownerId: '00000000-0000-4000-8000-000000000099',
      markerId: `marker-${index}`,
      originalName: 'Контроль',
      value: {
        kind: 'numeric',
        value: `${index * 2 + row}.123456`,
        comparator: 'eq',
      },
      originalUnit: 'Ед/л',
      normalizedValue: null,
      normalizedUnit: null,
      collectedAt: `2026-09-${row + 10}`,
      datePrecision: 'date',
      laboratoryName: null,
      referenceRange: {
        lower: '0',
        upper: '100',
        lowerInclusive: true,
        upperInclusive: true,
        originalText: '0–100',
      },
      referenceAssessment: 'unknown',
      verification: 'user_verified',
      extractionVersion: '1',
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    }),
  ),
}));
const prepared = await prepareMedicalReport(
  renderMedicalReportHtml(
    { markerIds: dataset.map((item) => item.marker.id), dateKeys: null },
    dataset,
    await readReportFonts(),
  ),
);
assert.equal(prepared.pageCount, 1);
assert.equal(
  (prepared.html.match(/class="observation-row"/g) ?? []).length,
  10,
);
const bytes = await renderMedicalPdfReport(prepared.html);
assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
assert.ok(Buffer.from(bytes).includes(Buffer.from('/FontFile2')));
await writeFile(output, bytes);
console.log(
  'Compact medical PDF: five groups, ten measurements, one A4, embedded font; non-root Chromium passed',
);

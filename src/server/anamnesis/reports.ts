import 'server-only';
import { anamnesisRepository, anamnesisId } from './repository';
import { observationDto } from './dto';
import {
  formatAnamnesisValue,
  medicalReportRequestSchema,
  type MedicalMarker,
  type MedicalObservation,
} from '@/contracts/anamnesis';
import { ReportError } from '@/server/pdf/errors';
import { readReportFonts } from '@/server/pdf/fonts';
import { anamnesisMessages as m } from '@/features/anamnesis';
import { renderMedicalPdfReport } from './report-renderer';
import type { ObjectStorage } from '@/server/storage';
import { anamnesisReportStorageKey } from './worker';

export const medicalReportCsp =
  "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
}

const medicalReportStyles = `
@page{size:A4 portrait;margin:0}
:root{--paper:#F8F7F2;--ink:#202C28;--muted:#55645D;--brand:#225C45;--rule:#D4DAD1;--wash:#E8EDE4;--below:#236AA8;--above:#B45309;--unknown:#55645D}
*{box-sizing:border-box;animation:none!important;transition:none!important}
html,body{margin:0;padding:0}
body{font-family:'Report Sans',sans-serif;font-size:10pt;line-height:1.32;color:var(--ink);print-color-adjust:exact;-webkit-print-color-adjust:exact}
.report-page{position:relative;width:210mm;height:297mm;background:var(--paper);break-inside:avoid}
.report-page:not(:last-child){break-after:page}
.page-header{position:absolute;top:10mm;left:11.3mm;right:11.3mm;min-height:10mm;border-bottom:.25mm solid var(--brand);display:flex;justify-content:space-between;align-items:baseline;gap:6mm;padding-bottom:2mm}
.page-header h1{font-family:'Report Serif',serif;font-size:20pt;line-height:1.15;font-weight:400}
.page-header .header-date{font-size:9pt;color:var(--muted);text-align:right}
.page-body{position:absolute;left:11.3mm;top:24mm;width:187.4mm;height:252mm;display:flow-root}
.page-footer{position:absolute;top:282mm;left:11.3mm;right:11.3mm;height:9mm;padding-top:2mm;border-top:.25mm solid var(--rule);display:flex;justify-content:space-between;font-size:7.5pt;color:var(--muted)}
#report-source{width:187.4mm}
h2,p{margin:0}
.marker-summary{margin-bottom:4mm;padding:3mm;background:var(--wash);break-inside:avoid}
.marker-summary .summary-value{font-size:16pt;font-weight:700}
.marker-summary .summary-caption{font-size:8pt;color:var(--muted);margin-top:1mm}
.range-bar{position:relative;height:3.2mm;margin-top:2mm;background:linear-gradient(to right,var(--rule),var(--rule))}
.range-bar .band{position:absolute;top:0;bottom:0;background:var(--brand);opacity:.35}
.range-bar .point{position:absolute;top:-1mm;width:1.6mm;height:5.2mm;background:var(--ink)}
.range-caption{font-size:7.5pt;color:var(--muted);margin-top:1mm}
.table-header,.observation-row{display:grid;grid-template-columns:34mm minmax(0,1fr) 32mm 42mm;column-gap:2.5mm;align-items:baseline;padding:1.2mm 0;border-bottom:.2mm solid var(--rule)}
.table-header{font-size:8pt;color:var(--muted);border-bottom:.35mm solid var(--rule)}
.observation-row{break-inside:avoid}
.observation-row .date{white-space:nowrap}
.observation-row .value{text-align:right;font-variant-numeric:tabular-nums lining-nums;white-space:nowrap;font-weight:700}
.observation-row .meta{font-size:8pt;color:var(--muted)}
.assessment-below{color:var(--below)}
.assessment-above{color:var(--above)}
.assessment-unknown{color:var(--unknown)}
.section-notes{margin-top:3mm;font-size:8pt;color:var(--muted)}
.numeric{font-variant-numeric:tabular-nums lining-nums}
`;

function dateLabel(value: string | null): string {
  if (!value) return m.unknownDate;
  const date = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (date)
    return `${date[3]}.${date[2]}.${date[1]}${value.length > 10 ? ` ${value.slice(11, 16)}` : ''}`;
  const month = value.match(/^(\d{4})-(\d{2})$/);
  if (month) return `${month[2]}.${month[1]}`;
  return value;
}

function rangeBar(observation: MedicalObservation): string {
  const range = observation.referenceRange;
  if (!range || observation.value.kind !== 'numeric') return '';
  const lower = range.lower === null ? null : Number(range.lower);
  const upper = range.upper === null ? null : Number(range.upper);
  if (lower === null && upper === null) return '';
  const numeric = Number(observation.value.value);
  const low = lower ?? Math.min(numeric * 0.8, upper! * 0.5);
  const high = upper ?? Math.max(numeric * 1.2, lower! * 1.5);
  if (!(high > low)) return '';
  const clamp = (value: number) =>
    Math.max(2, Math.min(98, ((value - low) / (high - low)) * 100));
  const bandStart = lower === null ? 0 : clamp(lower);
  const bandEnd = upper === null ? 100 : clamp(upper);
  return `<div class="range-bar" role="img" aria-label="${escapeHtml(m.referenceRange)}"><span class="band" style="left:${bandStart}%;width:${Math.max(0, bandEnd - bandStart)}%"></span><span class="point" style="left:${clamp(numeric)}%"></span></div><p class="range-caption">${escapeHtml(range.originalText)} · ${escapeHtml(m.assessment[observation.referenceAssessment])}</p>`;
}

export function renderMedicalReportHtml(
  request: { markerIds: string[]; from: string | null; to: string | null },
  dataset: Array<{ marker: MedicalMarker; observations: MedicalObservation[] }>,
  fonts: { sans: Uint8Array; bold: Uint8Array; serif: Uint8Array },
): string {
  const fontFaces = `@font-face{font-family:'Report Sans';src:url(data:font/ttf;base64,${Buffer.from(fonts.sans).toString('base64')});font-weight:400}@font-face{font-family:'Report Sans';src:url(data:font/ttf;base64,${Buffer.from(fonts.bold).toString('base64')});font-weight:700}@font-face{font-family:'Report Serif';src:url(data:font/ttf;base64,${Buffer.from(fonts.serif).toString('base64')});font-weight:400}`;
  const period =
    request.from || request.to
      ? `${request.from ? dateLabel(request.from) : '…'} — ${request.to ? dateLabel(request.to) : '…'}`
      : m.wholePeriod;
  const sections = dataset
    .map(({ marker, observations }) => {
      const last = observations[observations.length - 1] ?? null;
      const unit = last?.normalizedUnit ?? last?.originalUnit ?? '';
      const lastValue = last ? formatAnamnesisValue(last.value) : m.noData;
      return `<section class="marker-section" data-title="${escapeHtml(marker.name)}" data-header="${escapeHtml(period)}" data-footer="${escapeHtml(m.reportFooter)}">${
        last
          ? `<div class="marker-summary"><span class="summary-value numeric">${escapeHtml(lastValue)} ${escapeHtml(unit)}</span><p class="summary-caption">${escapeHtml(m.lastMeasurement)}: ${escapeHtml(dateLabel(last.collectedAt))}</p>${rangeBar(last)}</div>`
          : `<div class="marker-summary"><p class="summary-caption">${escapeHtml(m.noData)}</p></div>`
      }<div class="table-header"><span>${escapeHtml(m.dateColumn)}</span><span></span><span>${escapeHtml(m.valueColumn)}</span><span>${escapeHtml(m.referenceColumn)}</span></div>${observations
        .map(
          (observation) =>
            `<div class="observation-row"><span class="date numeric">${escapeHtml(dateLabel(observation.collectedAt))}</span><span class="meta">${escapeHtml(observation.laboratoryName ?? '')}</span><span class="value numeric">${escapeHtml(formatAnamnesisValue(observation.value))} ${escapeHtml(observation.normalizedUnit ?? observation.originalUnit ?? '')}</span><span class="meta ${observation.referenceAssessment !== 'within' && observation.referenceRange ? `assessment-${observation.referenceAssessment}` : ''}">${escapeHtml(observation.referenceRange ? observation.referenceRange.originalText : m.assessment.unknown)}</span></div>`,
        )
        .join(
          '',
        )}<div class="section-notes"><p>${escapeHtml(m.reportDisclaimer)}</p></div></section>`;
    })
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(m.reportTitle)}</title><style>${fontFaces}${medicalReportStyles}</style></head><body><div id="report-source">${sections}</div></body></html>`;
}

let active = false;
export async function withMedicalReportSlot<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (active) throw new ReportError('BUSY', 429);
  active = true;
  try {
    return await operation();
  } finally {
    active = false;
  }
}

export interface MedicalReportDeps {
  storage: ObjectStorage;
  render?: typeof renderMedicalPdfReport;
}

// Генерация и сохранение отчёта. Список показателей уже проверен грантами
// вызывающим сервисом; сам отчёт не содержит оригиналов документов.
export async function generateMedicalReport(
  deps: MedicalReportDeps,
  ownerId: string,
  createdBy: string,
  input: unknown,
): Promise<{ id: string; filename: string; sizeBytes: number }> {
  const request = medicalReportRequestSchema.parse(input);
  const repo = anamnesisRepository();
  const markers = repo
    .listMarkers()
    .filter((marker) => request.markerIds.includes(marker.id));
  if (markers.length !== request.markerIds.length)
    throw new ReportError('INVALID', 422);
  const observations = repo
    .listObservations(ownerId, {
      markerIds: request.markerIds,
      from: request.from ?? undefined,
      to: request.to ?? undefined,
    })
    .map(observationDto);
  const dataset = markers.map((marker) => ({
    marker,
    observations: observations.filter((row) => row.markerId === marker.id),
  }));
  if (!observations.length) throw new ReportError('NO_DATA', 404);
  const fonts = await readReportFonts();
  const html = renderMedicalReportHtml(request, dataset, fonts);
  if (Buffer.byteLength(html) > 4 * 1024 * 1024)
    throw new ReportError('OVERSIZED', 413);
  const render = deps.render ?? renderMedicalPdfReport;
  const bytes = await render(html);
  const id = anamnesisId();
  const filename = `anamnesis-${request.from ?? 'all'}-${request.to ?? 'all'}.pdf`;
  await deps.storage.put(
    anamnesisReportStorageKey(id),
    bytes,
    'application/pdf',
  );
  const row = repo.insertReport({
    id,
    ownerId,
    createdBy,
    markerIdsJson: request.markerIds,
    dateFrom: request.from,
    dateTo: request.to,
    status: 'ready',
    storageKey: anamnesisReportStorageKey(id),
    filename,
    sizeBytes: bytes.byteLength,
    createdAt: Date.now(),
  });
  return { id: row.id, filename: row.filename, sizeBytes: row.sizeBytes };
}

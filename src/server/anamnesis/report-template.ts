import 'server-only';
import {
  formatAnamnesisValue,
  type MedicalReportRequest,
  type MedicalMarker,
  type MedicalObservation,
} from '@/contracts/anamnesis';
import { anamnesisMessages as m } from '@/config/anamnesis-messages';

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
.page-header h1{margin:0;font-family:'Report Serif',serif;font-size:20pt;line-height:1.15;font-weight:400}
.page-header .header-date{font-size:9pt;color:var(--muted);text-align:right}
.page-body{position:absolute;left:11.3mm;top:24mm;width:187.4mm;height:252mm;display:flow-root}
.page-footer{position:absolute;top:282mm;left:11.3mm;right:11.3mm;height:9mm;padding-top:2mm;border-top:.25mm solid var(--rule);display:flex;justify-content:space-between;font-size:7.5pt;color:var(--muted)}
#report-source{width:187.4mm}
h2,p{margin:0}
.source-kind{display:block;font-size:7pt;color:var(--muted)}.marker-heading{font-size:11pt;margin:4mm 0 1mm;overflow-wrap:anywhere}.table-header,.observation-row{display:grid;grid-template-columns:34mm minmax(0,1fr) 26mm 52mm;column-gap:2.5mm;align-items:baseline;padding:1.2mm 0;border-bottom:.2mm solid var(--rule)}
.table-header{font-size:8pt;color:var(--muted);border-bottom:.35mm solid var(--rule)}
.observation-row{break-inside:avoid}.observation-row>span{min-width:0;overflow-wrap:anywhere}
.observation-row .date{white-space:nowrap}
.observation-row .value{text-align:right;font-variant-numeric:tabular-nums lining-nums;overflow-wrap:anywhere;font-weight:700}
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

export function renderMedicalReportHtml(
  request: MedicalReportRequest,
  dataset: Array<{
    marker: MedicalMarker;
    observations: Array<MedicalObservation & { historical?: boolean }>;
  }>,
  fonts: { sans: Uint8Array; bold: Uint8Array; serif: Uint8Array },
): string {
  const fontFaces = `@font-face{font-family:'Report Sans';src:url(data:font/ttf;base64,${Buffer.from(fonts.sans).toString('base64')});font-weight:400}@font-face{font-family:'Report Sans';src:url(data:font/ttf;base64,${Buffer.from(fonts.bold).toString('base64')});font-weight:700}@font-face{font-family:'Report Serif';src:url(data:font/ttf;base64,${Buffer.from(fonts.serif).toString('base64')});font-weight:400}`;
  const period =
    request.dateKeys === null
      ? m.wholePeriod
      : request.dateKeys.length > 3
        ? `${m.workspace.selectedDates}: ${request.dateKeys.length}`
        : request.dateKeys
            .map((key) => (key === 'undated' ? m.unknownDate : dateLabel(key)))
            .join(', ');
  const sections = dataset
    .filter((item) => item.observations.length > 0)
    .map(({ marker, observations }) => {
      return `<section class="marker-section" data-title="${escapeHtml(marker.name)}" data-header="${escapeHtml(period)}" data-footer="${escapeHtml(m.reportFooter)}"><div class="table-header"><span>${escapeHtml(m.dateColumn)}</span><span>${escapeHtml(m.valueColumn)}</span><span>${escapeHtml(m.markers.unit)}</span><span>${escapeHtml(m.referenceColumn)}</span></div>${observations.map((observation) => `<div class="observation-row"><span class="date numeric">${escapeHtml(dateLabel(observation.collectedAt))}${observation.historical ? `<small class="source-kind">${escapeHtml(m.reportHistoricalResult)}</small>` : ''}</span><span class="value numeric">${escapeHtml(formatAnamnesisValue(observation.value))}</span><span>${escapeHtml(observation.normalizedUnit ?? observation.originalUnit ?? '')}</span><span class="meta">${escapeHtml(observation.referenceRange?.originalText ?? m.assessment.unknown)}</span></div>`).join('')}</section>`;
    })
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${medicalReportCsp}"><title>${escapeHtml(m.reportTitle)}</title><style>${fontFaces}${medicalReportStyles}</style></head><body><div id="report-source">${sections}</div></body></html>`;
}

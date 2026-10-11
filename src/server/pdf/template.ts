import 'server-only';
import type { NutritionTotals } from '@/contracts/nutrition';
import { periodDates, type ReportRequest } from '@/contracts/reports';
import { reportMessages as m } from '@/features/reports';
import type { ReportDataset } from '@/server/pdf/source';
import { summarizeDays } from '@/server/pdf/summary';

export const reportCsp =
  "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
}
function value(value: string | null) {
  return value === null ? m.unknown : escapeHtml(value);
}
function totals(values: NutritionTotals, known?: NutritionTotals) {
  return `<dl class="totals">${(['calories', 'protein', 'fat', 'carbs'] as const).map((key) => `<div><dt>${m[key]}</dt><dd>${value(values[key])}${values[key] === null && known ? `<small>${m.partial}: ${value(known[key])}</small>` : ''}</dd></div>`).join('')}</dl>`;
}
export function renderReportHtml(
  request: ReportRequest,
  dataset: ReportDataset,
  font: Uint8Array,
): string {
  const dates = periodDates(request.start, request.end);
  const summary = summarizeDays(dataset.days, dates.length);
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${reportCsp}"><title>${m.title}</title><style>
@font-face{font-family:Report;src:url(data:font/ttf;base64,${Buffer.from(font).toString('base64')}) format('truetype');font-weight:100 900;font-display:block}
@page{size:A4;margin:14mm 12mm 16mm}*{box-sizing:border-box}body{font-family:Report,sans-serif;color:#17263a;font-size:10pt;line-height:1.45;margin:0;overflow-wrap:anywhere}h1{font-size:22pt}h2{font-size:16pt;break-after:avoid}h3{font-size:12pt;break-after:avoid}p{orphans:3;widows:3}small{display:block;color:#536275;font-size:8pt}dl{margin:8px 0}.totals{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.totals>div{border:1px solid #ccd4de;padding:8px;break-inside:avoid}dt{font-size:8pt;color:#536275}dd{margin:2px 0;font-size:11pt}.day+.day{break-before:page}.entry{border-bottom:1px solid #dde3ea;padding:8px 0;break-inside:avoid}.entry .totals{font-size:9pt}.muted{color:#536275}.photo{margin:12px 0;break-inside:avoid}.photo img{display:block;width:100%;height:65mm;object-fit:contain}.photo figcaption{font-size:8pt}.intro{border-bottom:2px solid #28736b;padding-bottom:8px}.summary{break-inside:avoid}.day{padding-top:8px} @media screen{body{max-width:800px;padding:20px;margin:auto;background:#fff}.day{margin-top:32px}}@media(max-width:480px){.totals{grid-template-columns:repeat(2,minmax(0,1fr))}} 
</style></head><body><header class="intro"><h1>${m.title}</h1><p>${request.start} — ${request.end}</p><p class="muted">${m.authoritative}</p></header><section class="summary"><h2>${m.summary}</h2><p>${m.completeness}: ${summary.availableDays} / ${summary.expectedDays}</p>${totals(summary.totals, summary.knownTotals)}</section>
${dates
  .map((date) => {
    const day = dataset.days.find((candidate) => candidate.date === date);
    return `<section class="day"><h2>${date}</h2>${day ? `<p class="muted">${m.fetched}: ${escapeHtml(day.fetchedAt)}</p><h3>${m.totals}</h3>${totals(day.totals, day.knownTotals)}<details open><summary>${m.sourceOfficial}</summary>${totals(day.officialTotals)}<p>${m.delta}</p>${totals(day.delta)}</details>` : `<p>${m.missing}</p>`}
${(['breakfast', 'lunch', 'dinner', 'snack'] as const)
  .map((kind) => {
    const meal = day?.meals.find((candidate) => candidate.kind === kind);
    const photos = dataset.photos.filter(
      (photo) => photo.date === date && photo.daytime === kind,
    );
    if (!meal && !photos.length) return '';
    return `<section><h3>${m[kind]}</h3>${meal ? totals(meal.totals, meal.knownTotals) : ''}${meal?.entries.length ? meal.entries.map((entry) => `<article class="entry"><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.diaryDateTime)}</small><p>${m.quantity}: ${value(entry.amount)} ${escapeHtml(entry.baseUnit ?? '')}${entry.serving ? ` · ${escapeHtml(entry.serving)}` : ''}${entry.consumedPortions ? ` · ${escapeHtml(entry.consumedPortions)}` : ''}</p>${totals(entry.totals)}${entry.issues.length ? `<small>${m.issues}: ${entry.issues.map(escapeHtml).join(', ')}</small>` : ''}</article>`).join('') : `<p>${m.empty}</p>`}${photos.map((photo) => `<figure class="photo"><img src="${photo.dataUri}" alt="${m.photos}: ${m[kind]}"><figcaption>${m[kind]} · ${date}</figcaption></figure>`).join('')}</section>`;
  })
  .join('')}</section>`;
  })
  .join('')}</body></html>`;
}

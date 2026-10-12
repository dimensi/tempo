import 'server-only';
import { formatDecimal } from '@/lib/number-display';
import {
  meals,
  type NutritionEntry,
  type NutritionTotals,
} from '@/contracts/nutrition';
import { periodDates, type ReportRequest } from '@/contracts/reports';
import { reportMessages as m } from '@/features/reports';
import type { ReportDataset } from '@/server/pdf/source';
import type { ReportFonts } from '@/server/pdf/fonts';
import { summarizeDays } from '@/server/pdf/summary';
import { macroShares, mealShares } from '@/server/pdf/shares';
import { reportStyles } from '@/server/pdf/styles';

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
const keys = ['calories', 'protein', 'fat', 'carbs'] as const;
const names = {
  calories: m.energy,
  protein: m.proteinName,
  fat: m.fatName,
  carbs: m.carbsName,
};
const labels = {
  calories: m.kcal,
  protein: m.protein,
  fat: m.fat,
  carbs: m.carbs,
};
const unknownTotals: NutritionTotals = {
  calories: null,
  protein: null,
  fat: null,
  carbs: null,
};
const value = (raw: string | null) =>
  escapeHtml(formatDecimal(raw) ?? m.unavailable);
const percentage = (tenths: number) =>
  `${Math.floor(tenths / 10)},${tenths % 10}%`;
export function diaryDateLabel(date: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .format(new Date(`${date}T12:00:00Z`))
    .replace(/\s*г\.$/, '');
}
function totals(values: NutritionTotals, known?: NutritionTotals): string {
  const shares = macroShares(values);
  return `<section class="summary-block"><div class="section-title-row"><h2>${m.diaryTotals}</h2><span class="share-caption">${m.energyShare}</span></div>${macroChart(values)}<div class="daily-totals">${keys.map((key, index) => `<div class="summary-row" data-nutrient="${key}"><span>${names[key]}</span><strong class="summary-value number numeric">${value(values[key])}</strong><span class="summary-unit">${key === 'calories' ? m.kcal : m.grams}</span><span class="energy-share number numeric">${index === 0 || shares === null ? m.unavailable : percentage(shares.tenths[index - 1]!)}</span>${values[key] === null && known?.[key] !== null && known?.[key] !== undefined ? `<small class="partial">${m.partial}: ${value(known[key])} ${key === 'calories' ? m.kcal : m.grams}</small>` : ''}</div>`).join('')}</div><p class="small-note">${m.macroExplanation}${shares ? ` ${m.macroEnergy}: ${value(shares.energy)} ${m.kcal}.` : ''}</p></section>`;
}
function macroChart(values: NutritionTotals): string {
  const shares = macroShares(values);
  if (shares === null) return '';
  const macroKeys = ['protein', 'fat', 'carbs'] as const;
  return `<div class="bar macro-bar" role="img" aria-label="${m.macroRatio}: ${shares.tenths.map(percentage).join(' · ')}">${macroKeys.map((key, index) => `<span class="segment" data-nutrient="${key}" style="width:${shares.tenths[index]! / 10}%"></span>`).join('')}</div>`;
}
function entryMetadata(entry: NutritionEntry): string {
  const parts = [entry.diaryDateTime.slice(11)];
  parts.push(
    entry.massG === null
      ? m.massMissing
      : `${formatDecimal(entry.massG)} ${m.grams}`,
  );
  if (entry.volumeMl !== null)
    parts.push(`${formatDecimal(entry.volumeMl)} ${m.millilitres}`);
  if (entry.baseUnit === 'package' || entry.serving === 'package')
    parts.push(m.package);
  if (entry.consumedPortions !== null)
    parts.push(`${formatDecimal(entry.consumedPortions)} ${m.portions}`);
  if (
    entry.serving &&
    /^[\p{L} -]+$/u.test(entry.serving) &&
    entry.serving !== 'package'
  )
    parts.push(entry.serving);
  return parts.map(escapeHtml).join(' · ');
}
function food(entry: NutritionEntry): string {
  return `<article class="entry" data-entry-id="${escapeHtml(entry.id)}"><div class="entry-name">${escapeHtml(entry.name)}</div><p class="entry-meta">${entryMetadata(entry)}</p><div class="nutrients">${keys.map((key) => `<div class="nutrient" data-nutrient="${key}"><div class="nutrient-label">${labels[key]}</div><div class="nutrient-value number numeric">${value(entry.totals[key])}</div></div>`).join('')}</div>${entry.issues.length ? `<p class="entry-issues">${m.entryIssue}</p>` : ''}</article>`;
}
function introduction(title: string, subtitle: string): string {
  return `<div class="intro"><h1>${title}</h1><p class="subtitle">${escapeHtml(subtitle)}</p></div>`;
}
function explanation(fetchedAt?: string): string {
  return `<section class="summary-block"><div class="explanation"><strong>${m.howToRead}</strong><p>${m.displayExplanation}</p><p>${m.noGoals}</p></div>${fetchedAt ? `<p class="source-updated">${m.updated}: ${escapeHtml(new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(fetchedAt)))} UTC</p>` : ''}</section>`;
}

export function renderReportHtml(
  request: ReportRequest,
  dataset: ReportDataset,
  fonts: ReportFonts,
): string {
  const dates = periodDates(request.start, request.end);
  const summary = summarizeDays(dataset.days, dates.length);
  const fontFaces = `<style>@font-face{font-family:'Report Sans';src:url(data:font/ttf;base64,${Buffer.from(fonts.sans).toString('base64')});font-weight:400}@font-face{font-family:'Report Sans';src:url(data:font/ttf;base64,${Buffer.from(fonts.bold).toString('base64')});font-weight:700}@font-face{font-family:'Report Serif';src:url(data:font/ttf;base64,${Buffer.from(fonts.serif).toString('base64')});font-weight:400}${reportStyles}</style>`;
  const overview =
    dates.length === 1
      ? ''
      : `<section class="day-source" data-overview="true" data-header="${escapeHtml(`${diaryDateLabel(request.start)} — ${diaryDateLabel(request.end)}`)}" data-footer="${m.summary}"><div class="day-summary">${introduction(m.periodTitle, `${diaryDateLabel(request.start)} — ${diaryDateLabel(request.end)} · ${m.completeness}: ${summary.availableDays} / ${summary.expectedDays}`)}${totals(summary.totals, summary.knownTotals)}${explanation()}</div></section>`;
  const sections = dates
    .map((date, index) => {
      const day = dataset.days.find((candidate) => candidate.date === date);
      const dayTotals = day?.totals ?? unknownTotals;
      const distribution = day ? mealShares(day) : null;
      const mealTable = day
        ? `<section class="summary-block meal-distribution"><h2>${m.distribution}</h2>${distribution?.percentages ? `<div class="bar meal-bar" role="img" aria-label="${m.distribution}">${meals.map((kind, mealIndex) => `<span class="segment" data-meal="${kind}" style="width:${distribution.percentages![mealIndex] ?? 0}%"></span>`).join('')}</div><p class="small-note">${distribution.recordedOnly ? m.recordedCalorieShare : m.dayCalorieShare}</p>` : `<p class="small-note">${m.noCalorieDistribution}</p>`}<div class="meal-summary-table"><div class="meal-summary-row meal-summary-head"><span></span><span></span>${keys.map((key) => `<span class="number" data-nutrient="${key}">${labels[key]}</span>`).join('')}</div>${meals
            .map((kind, mealIndex) => {
              const meal = day.meals.find(
                (candidate) => candidate.kind === kind,
              )!;
              const share = distribution?.percentages?.[mealIndex];
              return `<div class="meal-summary-row" data-meal="${kind}"><span class="meal-summary-name"><span class="meal-marker"></span>${m[kind]}</span><span class="meal-share numeric">${share === null || share === undefined ? m.unavailable : `${share}%`}</span>${keys.map((key) => `<span class="number numeric" data-nutrient="${key}">${value(meal.totals[key])}</span>`).join('')}</div>`;
            })
            .join('')}</div></section>`
        : '';
      const details = meals
        .map((kind) => {
          const meal = day?.meals.find((candidate) => candidate.kind === kind);
          const photo = dataset.photos.find(
            (candidate) =>
              candidate.date === date && candidate.daytime === kind,
          );
          if (!meal?.entries.length && !photo) return '';
          return `<section class="meal-block" data-meal="${kind}" data-name="${m[kind]}"><div class="meal-heading"><h2>${m[kind]}</h2><span class="meal-calories numeric">${value(meal?.totals.calories ?? null)} ${m.kcal}</span></div><div class="meal-body${photo ? ' meal-body--with-photo' : ''}">${photo ? `<figure class="meal-photo"><img src="${photo.dataUri}" alt="${m.photos}: ${m[kind]}"></figure>` : ''}<div class="entries">${meal?.entries.length ? meal.entries.map(food).join('') : `<p class="empty">${m.empty}</p>`}</div></div></section>`;
        })
        .join('');
      return `<section class="day-source" data-date="${date}" data-header="${escapeHtml(diaryDateLabel(date))}" data-footer="${m.dayFooter}"><div class="day-summary">${introduction(m.dayTitle, `${diaryDateLabel(date)}${dates.length > 1 ? ` · ${index + 1} / ${dates.length}` : ''}`)}${day ? (day.meals.every((meal) => meal.entries.length === 0) ? `<section class="summary-block empty">${m.empty}</section>` : '') : `<section class="summary-block empty">${m.missing}</section>`}${totals(dayTotals, day?.knownTotals)}${mealTable}${explanation(day?.fetchedAt)}</div><div class="day-details">${details}</div><section class="notes"><h2>${m.notesTitle}</h2><p>${m.notesText}</p></section></section>`;
    })
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${reportCsp}"><title>${m.diary}</title>${fontFaces}</head><body><main id="report-source" data-title="${m.detailsTitle}" data-subtitle="${m.detailsSubtitle}" data-continued="${m.continued}" data-brand="${m.diary}" data-details-footer="${m.detailsFooter}">${overview}${sections}</main></body></html>`;
}

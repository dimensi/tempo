import { hasNutritionMealContent } from '@/lib/nutrition-meal-content';
import { formatDecimal } from '@/lib/number-display';
import {
  meals,
  type NutritionDay,
  type NutritionEntry,
  type NutritionTotals,
} from '@/contracts/nutrition';
import { periodDates, type ReportRequest } from '@/contracts/reports';
import { reportMessages as m } from '@/config/reports';
import type { ReportDataset, ReportFonts } from '@/contracts/reports';
import { summarizeDays } from '@/lib/reports/summary';
import { macroShares, mealShares } from '@/lib/reports/shares';
import { reportStyles, reportPreviewStyles } from '@/lib/reports/styles';
import { summarizeSteps, stepsProgress } from '@/lib/reports/steps';

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
function stepsMetric(
  raw: string | null,
  goal: number | null,
  label: string,
  coverage?: string,
): string {
  const progress = stepsProgress(raw, goal);
  const displayed =
    raw === null
      ? m.unavailable
      : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(
          Number(raw),
        );
  return `<div class="steps-column"><p class="total-label">${label}</p><strong class="steps-value number">${escapeHtml(displayed)}</strong>${goal !== null ? `<p class="steps-caption">${m.currentStepsGoal}: ${escapeHtml(new Intl.NumberFormat('ru-RU').format(goal))}</p>` : ''}${progress ? `<p class="steps-caption goal-progress">${progress.percent}% ${m.goalProgress}</p><div class="steps-track" role="img" aria-label="${progress.percent}% ${m.goalProgress}"><span style="width:${progress.width}%"></span></div>` : ''}${coverage ? `<p class="steps-caption">${coverage}</p>` : ''}</div>`;
}
function totals(
  values: NutritionTotals,
  known?: NutritionTotals,
  steps = '',
): string {
  const shares = macroShares(values);
  return `<section class="summary-block daily-totals">${steps}${keys.map((key, index) => `<div class="total-column" data-nutrient="${key}"><p class="total-label">${names[key]}</p><strong class="summary-value number"><span class="numeric">${value(values[key])}</span> <span class="summary-unit">${key === 'calories' ? m.kcal : m.grams}</span></strong><p class="total-caption">${index === 0 ? m.totalDay : `<span class="energy-share number numeric">${shares === null ? m.unavailable : percentage(shares.tenths[index - 1]!)}</span> ${m.macroEnergyShare}`}</p>${values[key] === null && known?.[key] !== null && known?.[key] !== undefined ? `<p class="partial">${m.partial}: ${value(known[key])} ${key === 'calories' ? m.kcal : m.grams}</p>` : ''}</div>`).join('')}</section>`;
}
function charts(
  values: NutritionTotals,
  day?: NutritionDay,
  visibleMeals = meals as readonly (typeof meals)[number][],
): string {
  const shares = macroShares(values);
  const distribution = day ? mealShares(day) : null;
  const macroKeys = ['protein', 'fat', 'carbs'] as const;
  return `<section class="summary-block charts"><div class="chart"><h2>${m.macroRatio}</h2>${shares ? `<div class="bar macro-bar" role="img" aria-label="${m.macroRatio}">${macroKeys.map((key, index) => `<span class="segment" data-nutrient="${key}" style="width:${shares.widths[index]}%"></span>`).join('')}</div>` : ''}<div class="legend">${macroKeys.map((key, index) => `<span class="legend-item" data-nutrient="${key}"><i class="marker"></i>${names[key]} <span class="numeric">${shares ? percentage(shares.tenths[index]!) : m.unavailable}</span></span>`).join('')}</div></div>${day && visibleMeals.length ? `<div class="chart"><h2>${m.distribution}</h2>${distribution?.widths ? `<div class="bar meal-bar" role="img" aria-label="${m.distribution}">${meals.map((kind, index) => (visibleMeals.includes(kind) ? `<span class="segment" data-meal="${kind}" style="width:${distribution.widths![index] ?? 0}%"></span>` : '')).join('')}</div>` : ''}<div class="legend legend--meals">${meals.map((kind, index) => (visibleMeals.includes(kind) ? `<span class="legend-item" data-meal="${kind}"><i class="marker"></i>${m[kind]} <span class="numeric">${distribution?.percentages?.[index] === null || distribution?.percentages?.[index] === undefined ? m.unavailable : `${distribution.percentages[index]}%`}</span></span>` : '')).join('')}</div>${distribution?.recordedOnly ? `<p class="small-note">${m.recordedCalorieShare}</p>` : ''}</div>` : ''}</section>`;
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
  if (entry.amount !== null && entry.massG === null && entry.volumeMl === null)
    parts.push(`${m.quantity}: ${formatDecimal(entry.amount)}`);
  const serving =
    entry.baseUnit === 'package' || entry.serving === 'package'
      ? m.package
      : entry.serving && /^[\p{L} -]+$/u.test(entry.serving)
        ? entry.serving
        : null;
  if (serving || entry.servingQuantity !== null)
    parts.push(
      `${serving ?? m.sourceServing}${entry.servingQuantity === null ? '' : ` × ${formatDecimal(entry.servingQuantity)}`}`,
    );
  if (entry.consumedPortions !== null)
    parts.push(`${formatDecimal(entry.consumedPortions)} ${m.portions}`);
  return parts.map(escapeHtml).join(' · ');
}
function food(entry: NutritionEntry): string {
  return `<article class="entry" data-entry-id="${escapeHtml(entry.id)}"><div class="entry-info"><div class="entry-name">${escapeHtml(entry.name)}</div><p class="entry-meta">${entryMetadata(entry)}</p>${entry.issues.length ? `<p class="entry-issues">${m.entryIssue}</p>` : ''}</div>${keys.map((key) => `<div class="nutrient-value number numeric" data-nutrient="${key}">${value(entry.totals[key])}</div>`).join('')}</article>`;
}
function columnHeaders(): string {
  return `<div class="table-header"><span class="heading-space"></span>${keys.map((key) => `<span data-nutrient="${key}">${labels[key]}</span>`).join('')}</div>`;
}
function notes(values: NutritionTotals, fetchedAt?: string): string {
  const shares = macroShares(values);
  return `<section class="notes"><p>${m.macroExplanation}${shares ? ` ${m.macroEnergy}: ${value(shares.energy)} ${m.kcal}.` : ''} ${m.compactNotes}</p>${fetchedAt ? `<p>${m.updated}: ${escapeHtml(new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(fetchedAt)))} UTC.</p>` : ''}</section>`;
}
function fontBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192)
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}
export function renderReportHtml(
  request: ReportRequest,
  dataset: ReportDataset,
  fonts?: ReportFonts,
): string {
  const dates = periodDates(request.start, request.end);
  const summary = summarizeDays(dataset.days, dates.length);
  const stepSummary = summarizeSteps(dataset.steps);
  if (request.format === 'pdf' && !fonts) throw new Error('PDF fonts required');
  const embeddedFonts =
    request.format === 'pdf'
      ? `@font-face{font-family:'Report Sans';src:url(data:font/ttf;base64,${fontBase64(fonts!.sans)});font-weight:400}@font-face{font-family:'Report Sans';src:url(data:font/ttf;base64,${fontBase64(fonts!.bold)});font-weight:700}@font-face{font-family:'Report Serif';src:url(data:font/ttf;base64,${fontBase64(fonts!.serif)});font-weight:400}`
      : '';
  const fontFaces = `<style>${embeddedFonts}${reportStyles}${request.format === 'html' ? reportPreviewStyles : ''}</style>`;
  const previewHeader = (title: string, label: string) =>
    request.format === 'html'
      ? `<header class="preview-header"><h1>${escapeHtml(title)}</h1><span>${escapeHtml(label)}</span></header>`
      : '';
  const overview =
    dates.length === 1
      ? ''
      : `<section class="day-source" data-overview="true" data-title="${m.periodTitle}" data-header="${escapeHtml(`${diaryDateLabel(request.start)} — ${diaryDateLabel(request.end)}`)}" data-footer="${m.summary}">${previewHeader(m.periodTitle, `${diaryDateLabel(request.start)} — ${diaryDateLabel(request.end)}`)}<div class="day-start"><p class="counts">${m.completeness}: ${summary.availableDays} / ${summary.expectedDays}</p>${totals(summary.totals, summary.knownTotals, stepsMetric(stepSummary.average, null, m.averageSteps, m.stepsCoverage(stepSummary.observedDays, dates.length)))}${stepSummary.progress ? `<p class="steps-caption goal-progress">${stepSummary.progress.percent}% ${m.goalProgress}</p>` : ''}${charts(summary.totals)}</div><div class="day-meals"></div>${notes(summary.totals)}</section>`;
  const sections = dates
    .map((date) => {
      const day = dataset.days.find((candidate) => candidate.date === date);
      const steps =
        dataset.steps.find((candidate) => candidate.date === date)?.steps ??
        null;
      const dayTotals = day?.totals ?? unknownTotals;
      const photos = dataset.photos.filter((photo) => photo.date === date);
      const entries =
        day?.meals.reduce((sum, meal) => sum + meal.entries.length, 0) ?? 0;
      const visibleMeals = meals.filter((kind) =>
        hasNutritionMealContent(
          day?.meals.find((meal) => meal.kind === kind),
          photos.some((photo) => photo.daytime === kind),
        ),
      );
      const mealsWithData = visibleMeals.length;
      const details = visibleMeals
        .map((kind) => {
          const meal = day?.meals.find((candidate) => candidate.kind === kind);
          const photo = photos
            .filter((candidate) => candidate.daytime === kind)
            .sort(
              (a, b) =>
                Number(b.source === 'yazio') - Number(a.source === 'yazio') ||
                b.observedAt.localeCompare(a.observedAt) ||
                a.id.localeCompare(b.id),
            )[0];
          if (!meal && !photo) return '';
          return `<section class="meal-block" data-meal="${kind}" data-name="${m[kind]}"><div class="meal-heading"><h2>${m[kind]}</h2>${keys.map((key) => `<span class="meal-total number numeric" data-nutrient="${key}">${value(meal?.totals[key] ?? null)}</span>`).join('')}</div><div class="meal-body">${photo ? (photo.dataUri ? `<figure class="meal-media"><img src="${photo.dataUri}" alt="${m.photos}: ${m[kind]}"></figure>` : `<p class="small-note">${m.offlineMissingPhoto}</p>`) : ''}<div class="meal-entries">${meal?.entries.map(food).join('') ?? ''}</div></div></section>`;
        })
        .join('');
      return `<section class="day-source" data-date="${date}" data-title="${m.diary}" data-header="${escapeHtml(diaryDateLabel(date))}" data-footer="${m.dayFooter}">${previewHeader(m.diary, diaryDateLabel(date))}<div class="day-start"><p class="counts">${m.mealCount}: ${mealsWithData} · ${m.entryCount}: ${entries} · ${m.photoCount}: ${photos.length}</p>${mealsWithData === 0 ? `<p class="empty">${!day ? m.missing : m.empty}</p>` : ''}${totals(dayTotals, day?.knownTotals, stepsMetric(steps === null ? null : String(steps), dataset.steps.find((step) => step.date === date)?.goal ?? null, m.steps))}${charts(dayTotals, day, visibleMeals)}</div><div class="day-meals">${details ? columnHeaders() : ''}${details}</div>${notes(dayTotals, day?.fetchedAt)}</section>`;
    })
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${reportCsp}"><title>${m.diary}</title>${fontFaces}</head><body${request.format === 'html' ? ' class="report-preview"' : ''}><main id="report-source" data-continued="${m.continued}">${overview}${sections}</main></body></html>`;
}

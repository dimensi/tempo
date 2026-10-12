import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MantineProvider } from '@mantine/core';
import { DiaryView } from '@/features/nutrition';
import {
  displayValue,
  noticeableDifferences,
  displayIssue,
  entryAmounts,
} from '@/features/nutrition/ui/presentation';
import { day, entry } from './fixture';

describe('diary presentation', () => {
  it('distinguishes unknown, zero and exact residuals', () => {
    expect(displayValue(null, 'г')).toBe('нет данных');
    expect(displayValue('0', 'г')).toBe('0 г');
    expect(displayValue('1.23456789e-12')).toBe('1,23 × 10^-12');
    expect(displayValue('3e-16', 'г', 'delta')).toBe('≈ 0 г');
    expect(displayIssue('mass-unavailable')).toContain('Масса не указана');
    expect(displayIssue('Неизвестен белок')).toBe('Неизвестен белок');
    expect(entryAmounts(entry)).toContainEqual(['Масса', 'нет данных']);
    expect(entryAmounts(entry)).toContainEqual(['Объём', '250 мл']);
  });
  it('warns only at the exact displayed threshold, including signed and scientific decimals', () => {
    for (const value of [
      '0',
      '3e-16',
      '-0.00499999999999999999999999999999999999999',
    ])
      expect(
        noticeableDifferences({
          calories: value,
          protein: null,
          fat: '0',
          carbs: null,
        }),
      ).toEqual([]);
    for (const value of [
      '0.005',
      '-0.005',
      '5e-3',
      '0.00500000000000000000001',
    ])
      expect(
        noticeableDifferences({
          calories: value,
          protein: null,
          fat: '0',
          carbs: null,
        }),
      ).toEqual(['calories']);
  });
  it('retains zero-valued entries, photo-only meals and nonzero nutrients while hiding empty meals', () => {
    const zero = { calories: '0', protein: '0', fat: '0', carbs: '0' };
    const contentDay = {
      ...day,
      totals: zero,
      meals: day.meals.map((meal) => ({
        ...meal,
        entries:
          meal.kind === 'lunch'
            ? [
                {
                  ...entry,
                  name: 'Нулевая синтетическая запись',
                  amount: '0',
                  massG: '0',
                  totals: zero,
                  issues: [],
                },
              ]
            : [],
        totals: meal.kind === 'breakfast' ? { ...zero, protein: '2' } : zero,
        knownTotals: zero,
        officialTotals: zero,
        delta: zero,
      })),
    };
    const html = renderToStaticMarkup(
      createElement(
        MantineProvider,
        {},
        createElement(DiaryView, {
          date: day.date,
          day: contentDay,
          photos: [
            {
              id: 'synthetic-photo',
              date: day.date,
              daytime: 'dinner',
              source: 'yazio',
              observedAt: day.fetchedAt,
              href: '/synthetic-photo',
            },
          ],
          source: 'demo',
        }),
      ),
    );
    for (const meal of ['Завтрак', 'Обед', 'Ужин'])
      expect(html).toContain(`aria-label="${meal}"`);
    expect(html).not.toContain('aria-label="Перекус"');
    for (const text of [
      'Нулевая синтетическая запись',
      '0 ккал',
      '2 г',
      'Масса: 0 г',
      'Фото YAZIO',
      'Демонстрационные данные',
    ])
      expect(html).toContain(text);
    expect(html).toContain('src="/synthetic-photo"');
    expect(html).not.toContain('За этот день нет записей питания.');
    expect(html).not.toContain('12:34:56');
  });
  it('renders the v1 data without event times or invented mass', () => {
    const html = renderToStaticMarkup(
      createElement(
        MantineProvider,
        {},
        createElement(DiaryView, {
          date: day.date,
          day,
          source: 'demo',
          commentsSlot: createElement('p', {}, 'Слот комментариев'),
        }),
      ),
    );
    for (const text of [
      'Обед',
      'Синтетический обед',
      'нет данных',
      '123,46 ккал',
      'Итого по записям',
      'Сравнить со сводкой YAZIO',
      'Итог по записям отличается от сводки YAZIO',
      'Оценка ИИ',
      'Неизвестен белок',
      'Слот комментариев',
      'Демонстрационные данные',
    ])
      expect(html).toContain(text);
    for (const emptyMeal of ['Завтрак', 'Ужин', 'Перекус'])
      expect(html).not.toContain(`aria-label="${emptyMeal}"`);
    expect(html).not.toContain('Масса: нет данных');
    expect(html).not.toContain('12:34:56');
    expect(html).not.toContain('Добавить фото');
  });
});

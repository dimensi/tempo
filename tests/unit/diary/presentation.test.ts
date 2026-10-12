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
      'Завтрак',
      'Обед',
      'Ужин',
      'Перекус',
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
    expect(html).not.toContain('12:34:56');
    expect(html).not.toContain('Добавить фото');
  });
});

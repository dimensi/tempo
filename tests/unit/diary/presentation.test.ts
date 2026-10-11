import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MantineProvider } from '@mantine/core';
import { DiaryView } from '@/features/nutrition';
import {
  displayValue,
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
      'Известная часть',
      'По сводке YAZIO',
      'Разница со сводкой',
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

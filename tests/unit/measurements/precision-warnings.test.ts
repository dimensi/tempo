import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { MeasurementPrecisionWarnings } from '@/features/measurements/precision-warnings';
import type { MeasurementPrecisionIssue } from '@/contracts/yazio-body';

it('renders one warning per value/day with count and every observation time/identity', () => {
  const first: MeasurementPrecisionIssue = {
    id: 'a1111111-1111-4111-8111-111111111111',
    metric: 'weight',
    date: '2026-10-07',
    dateTime: '2026-10-07 10:55:11',
    value: '80.12345',
  };
  const issues = [
    first,
    {
      ...first,
      id: 'b1111111-1111-4111-8111-111111111111',
      dateTime: '2026-10-07 10:55:43',
    },
    { ...first, id: 'c1111111-1111-4111-8111-111111111111', value: '80.12346' },
  ];
  const html = renderToStaticMarkup(
    createElement(
      MantineProvider,
      {},
      createElement(MeasurementPrecisionWarnings, { issues }),
    ),
  );
  expect([...html.matchAll(/Значение YAZIO сохранено отдельно/g)]).toHaveLength(
    2,
  );
  expect(html).toContain('Записей YAZIO: 2');
  for (const issue of issues) {
    expect(html).toContain(`data-observation-id="${issue.id}"`);
    expect(html).toContain(issue.dateTime.slice(11));
  }
  expect(html).toContain('80.12345');
  expect(html).toContain('80.12346');
});

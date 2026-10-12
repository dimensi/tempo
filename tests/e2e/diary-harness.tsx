import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { DiaryView, type DiaryPhoto } from '@/features/nutrition/ui/diary-view';
import { day, entry } from '../unit/diary/fixture';

const zero = { calories: '0', protein: '0', fat: '0', carbs: '0' };
const completeTotals = {
  calories: '200',
  protein: '10',
  fat: '5',
  carbs: '20',
};
const completeDay = {
  ...day,
  totals: completeTotals,
  knownTotals: completeTotals,
  officialTotals: completeTotals,
  delta: zero,
  meals: day.meals.map((meal) => ({
    ...meal,
    entries:
      meal.kind === 'lunch'
        ? [
            {
              ...entry,
              amount: '0',
              massG: '0',
              issues: [],
              totals: completeTotals,
            },
          ]
        : [],
    totals: meal.kind === 'lunch' ? completeTotals : zero,
    knownTotals: meal.kind === 'lunch' ? completeTotals : zero,
    officialTotals: meal.kind === 'lunch' ? completeTotals : zero,
    delta: zero,
  })),
};
const fixture = new URLSearchParams(location.search).get('fixture');
const empty = ['zero', 'null-empty', 'zero-entry', 'nutrient-only'].includes(
  fixture ?? '',
);
const previewDay = empty
  ? {
      ...day,
      totals: zero,
      knownTotals: zero,
      officialTotals: zero,
      delta: zero,
      meals: day.meals.map((meal) => ({
        ...meal,
        entries: [],
        totals: zero,
        knownTotals: zero,
        officialTotals: zero,
        delta: zero,
      })),
    }
  : {
      ...day,
      meals: day.meals.map((meal) =>
        meal.kind === 'lunch'
          ? {
              ...meal,
              totals:
                fixture === 'complete'
                  ? { calories: '200', protein: '10', fat: '5', carbs: '20' }
                  : day.totals,
              knownTotals: day.knownTotals,
              officialTotals: day.officialTotals,
              delta: day.delta,
            }
          : meal,
      ),
    };
const visibilityDay =
  fixture === 'null-empty'
    ? {
        ...previewDay,
        totals: { calories: null, protein: null, fat: null, carbs: null },
        meals: previewDay.meals.map((meal) => ({
          ...meal,
          totals: { calories: null, protein: null, fat: null, carbs: null },
        })),
      }
    : fixture === 'zero-entry'
      ? {
          ...previewDay,
          meals: previewDay.meals.map((meal) => ({
            ...meal,
            entries:
              meal.kind === 'lunch'
                ? [
                    {
                      ...entry,
                      name: 'Синтетическая нулевая запись',
                      totals: zero,
                      issues: [],
                      amount: '0',
                      massG: '0',
                    },
                  ]
                : [],
          })),
        }
      : fixture === 'nutrient-only'
        ? {
            ...previewDay,
            totals: { ...zero, protein: '2' },
            knownTotals: { ...zero, protein: '2' },
            meals: previewDay.meals.map((meal) =>
              meal.kind === 'breakfast'
                ? {
                    ...meal,
                    totals: { ...zero, protein: '2' },
                    knownTotals: { ...zero, protein: '2' },
                  }
                : meal,
            ),
          }
        : previewDay;
function Harness() {
  const [photos, setPhotos] = useState<DiaryPhoto[]>([
    {
      id: 'manual',
      date: day.date,
      daytime: 'lunch',
      source: 'manual',
      observedAt: day.fetchedAt,
      href: '/synthetic-photo',
    },
    {
      id: 'automatic',
      date: day.date,
      daytime: 'lunch',
      source: 'yazio',
      observedAt: day.fetchedAt,
      href: '/synthetic-photo',
    },
    {
      id: 'wrong-day',
      date: '2025-12-31',
      daytime: 'lunch',
      source: 'yazio',
      observedAt: day.fetchedAt,
      href: '/wrong-photo',
    },
    {
      id: 'dinner-photo',
      date: day.date,
      daytime: 'dinner',
      source: 'yazio',
      observedAt: day.fetchedAt,
      href: '/synthetic-photo',
    },
  ]);
  return (
    <MantineProvider>
      <DiaryView
        date={day.date}
        day={
          fixture === 'absent' || fixture === 'photo-only'
            ? null
            : fixture === 'complete'
              ? completeDay
              : visibilityDay
        }
        photos={
          fixture === 'photo-only'
            ? photos.filter((photo) => photo.id === 'dinner-photo')
            : fixture === 'absent' || empty
              ? []
              : photos
        }
        source="demo"
        commentsSlot={<p>Слот комментариев</p>}
        photoActions={{
          remove: async (id) =>
            setPhotos((previous) =>
              previous.filter((photo) => photo.id !== id),
            ),
        }}
      />
    </MantineProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);

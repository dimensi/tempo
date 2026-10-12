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
const empty = fixture === 'zero';
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
        day={fixture === 'complete' ? completeDay : previewDay}
        photos={empty ? [] : photos}
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

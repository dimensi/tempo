import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { DiaryView, type DiaryPhoto } from '@/features/nutrition/ui/diary-view';
import { day } from '../unit/diary/fixture';

const zero = { calories: '0', protein: '0', fat: '0', carbs: '0' };
const empty = new URLSearchParams(location.search).get('fixture') === 'zero';
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
              totals: day.totals,
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
  ]);
  return (
    <MantineProvider>
      <DiaryView
        date={day.date}
        day={previewDay}
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

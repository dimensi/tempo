import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { DiaryView, type DiaryPhoto } from '@/features/nutrition/ui/diary-view';
import { day } from '../unit/diary/fixture';

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
        day={day}
        photos={photos}
        source="demo"
        commentsSlot={<p>Слот комментариев</p>}
        photoActions={{
          upload: async (date, daytime) =>
            setPhotos((previous) => [
              ...previous,
              {
                id: 'uploaded',
                date,
                daytime,
                source: 'manual',
                observedAt: day.fetchedAt,
                href: '/synthetic-photo',
              },
            ]),
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

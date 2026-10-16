'use client';
import { offlineMessages as m } from '@/config/offline';
import { clearLocalData } from '@/lib/local-data';
import { Button, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';
export function OfflineSettings() {
  const [failed, setFailed] = useState(false);
  return (
    <section id="offline" tabIndex={-1} aria-label={m.title}>
      <Stack>
        <Title order={2}>{m.title}</Title>
        <Text>{m.description}</Text>
        <Button
          variant="subtle"
          onClick={() => {
            void clearLocalData()
              .then(() => {
                setFailed(false);
              })
              .catch(() => setFailed(true));
          }}
        >
          {m.disable}
        </Button>
        {failed && <Text role="alert">{m.unavailable}</Text>}
      </Stack>
    </section>
  );
}

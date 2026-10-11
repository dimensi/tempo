'use client';
import { Alert, Button, Stack } from '@mantine/core';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <Stack>
      <Alert color="red" title="Не удалось открыть раздел" role="alert">
        Попробуйте загрузить страницу ещё раз.
      </Alert>
      <Button onClick={reset}>Повторить</Button>
    </Stack>
  );
}

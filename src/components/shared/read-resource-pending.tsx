'use client';
import { readWorkspaceMessages as m } from '@/config/read-workspace';
import { Button, Skeleton, Stack, Text } from '@mantine/core';
export function ResourcePending({
  error,
  refresh,
}: {
  error?: string;
  refresh: () => Promise<void>;
}) {
  return error ? (
    <Stack>
      <Text>{m.actionUnavailable}</Text>
      <Button onClick={() => void refresh()}>{m.retry}</Button>
    </Stack>
  ) : (
    <Skeleton height={180} />
  );
}

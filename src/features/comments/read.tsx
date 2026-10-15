import type { ReactNode } from 'react';
import { Paper, Stack, Text } from '@mantine/core';
import { commentMessages as m } from './messages';
export function CommentReadContent({
  authorName,
  body,
  parentAuthor,
  children,
}: {
  authorName: string;
  body: string;
  parentAuthor?: string;
  children?: ReactNode;
}) {
  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <Text fw={600}>{authorName}</Text>
        {parentAuthor && (
          <Text size="xs" c="dimmed">
            {m.reply}: {parentAuthor}
          </Text>
        )}
        <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {body}
        </Text>
        {children}
      </Stack>
    </Paper>
  );
}

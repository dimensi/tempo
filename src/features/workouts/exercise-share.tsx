'use client';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  ActionIcon,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconCopy, IconShare } from '@tabler/icons-react';
import { exercisePageHref } from '@/lib/exercise-link';
import { workoutMessages as m } from './messages';

const subscribe = () => () => {};
const supportsShare = () => typeof navigator.share === 'function';
const serverSupportsShare = () => false;

export function ExerciseShare({
  exerciseId,
  name,
  compact = false,
  children,
}: {
  exerciseId: number;
  name: string;
  compact?: boolean;
  children?: ReactNode;
}) {
  const canShare = useSyncExternalStore(
    subscribe,
    supportsShare,
    serverSupportsShare,
  );
  const [manual, setManual] = useState('');
  const [status, setStatus] = useState('');
  const href = () =>
    new URL(exercisePageHref(exerciseId), location.origin).href;
  async function copy() {
    setStatus('');
    setManual('');
    const url = href();
    try {
      await navigator.clipboard.writeText(url);
      setStatus(m.exerciseLinkCopied);
    } catch {
      setManual(url);
    }
  }
  async function share() {
    if (!canShare) return copy();
    setStatus('');
    try {
      await navigator.share({ title: name, url: href() });
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError'))
        setStatus(m.exerciseShareFailed);
    }
  }
  return (
    <Stack gap="xs">
      {compact ? (
        <Group gap="xs" wrap="nowrap" justify="space-between">
          {children}
          <Group gap={0} wrap="nowrap" style={{ flexShrink: 0 }}>
            <ActionIcon
              size={44}
              variant="subtle"
              color="gray"
              title={m.copyExerciseLink}
              aria-label={`${m.copyExerciseLink}: ${name}`}
              onClick={() => void copy()}
            >
              <IconCopy size={20} />
            </ActionIcon>
            <ActionIcon
              size={44}
              variant="subtle"
              color="gray"
              title={m.shareExercise}
              aria-label={`${m.shareExercise}: ${name}`}
              onClick={() => void share()}
            >
              <IconShare size={20} />
            </ActionIcon>
          </Group>
        </Group>
      ) : (
        <Group gap="xs">
          <Button
            variant="default"
            mih={44}
            leftSection={<IconCopy size={18} />}
            onClick={() => void copy()}
          >
            {m.copyExerciseLink}
          </Button>
          {canShare && (
            <Button
              variant="subtle"
              mih={44}
              leftSection={<IconShare size={18} />}
              onClick={() => void share()}
            >
              {m.shareExercise}
            </Button>
          )}
        </Group>
      )}
      {status && (
        <Text size="sm" role="status">
          {status}
        </Text>
      )}
      {manual && (
        <TextInput
          label={m.exerciseLinkManual}
          value={manual}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </Stack>
  );
}

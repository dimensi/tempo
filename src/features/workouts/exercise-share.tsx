'use client';
import { useState, useSyncExternalStore } from 'react';
import { Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconCopy, IconShare } from '@tabler/icons-react';
import { exercisePageHref } from '@/lib/exercise-link';
import { workoutMessages as m } from './messages';

const subscribe = () => () => {};
const supportsShare = () => typeof navigator.share === 'function';
const serverSupportsShare = () => false;

export function ExerciseShare({
  exerciseId,
  name,
}: {
  exerciseId: number;
  name: string;
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

'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  NumberInput,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core';
import {
  stepsGoalSchema,
  stepsGoalMessages as m,
  type StepsGoal,
} from '@/contracts/steps-goal';

export function StepsGoalForm({ initial }: { initial: StepsGoal }) {
  const [enabled, setEnabled] = useState(initial.dailyStepsGoal !== null);
  const [amount, setAmount] = useState<string | number>(
    initial.dailyStepsGoal ?? 10000,
  );
  const [saved, setSaved] = useState(initial.dailyStepsGoal);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const candidate = enabled
    ? typeof amount === 'number'
      ? amount
      : /^\d+$/.test(amount)
        ? Number(amount)
        : NaN
    : null;
  const dirty = candidate !== saved;
  return (
    <section id="steps-goal" tabIndex={-1} aria-labelledby="steps-goal-title">
      <Stack gap="md" maw={560}>
        <Stack gap="xs">
          <Title order={2} id="steps-goal-title">
            {m.title}
          </Title>
          <Text c="dimmed">{m.description}</Text>
        </Stack>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const parsed = stepsGoalSchema.safeParse({
              dailyStepsGoal: candidate,
            });
            setNotice(null);
            if (!parsed.success) {
              setError(m.invalid);
              return;
            }
            setPending(true);
            setError(null);
            try {
              const response = await fetch('/api/settings/steps-goal', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(parsed.data),
              });
              if (!response.ok)
                throw new Error(
                  response.status === 401 || response.status === 403
                    ? m.denied
                    : m.failed,
                );
              const result = stepsGoalSchema.parse(await response.json());
              setSaved(result.dailyStepsGoal);
              setNotice(result.dailyStepsGoal === null ? m.disabled : m.saved);
            } catch (failure) {
              setError(
                failure instanceof Error && failure.message === m.denied
                  ? m.denied
                  : m.failed,
              );
            } finally {
              setPending(false);
            }
          }}
        >
          <Stack gap="md">
            <Switch
              label={m.enabled}
              checked={enabled}
              disabled={pending}
              onChange={(event) => {
                setEnabled(event.currentTarget.checked);
                setNotice(null);
                setError(null);
              }}
              size="md"
            />
            {enabled && (
              <NumberInput
                label={m.amount}
                value={amount}
                onChange={(value) => {
                  setAmount(value);
                  setError(null);
                  setNotice(null);
                }}
                disabled={pending}
                allowDecimal={false}
                allowNegative={false}
                min={1}
                max={Number.MAX_SAFE_INTEGER}
                clampBehavior="none"
                inputMode="numeric"
                maw={280}
                styles={{ input: { fontSize: 16 } }}
                error={error === m.invalid ? error : undefined}
              />
            )}
            {error && error !== m.invalid && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
            {notice && (
              <Text role="status" size="sm">
                {notice}
              </Text>
            )}
            <Button
              type="submit"
              loading={pending}
              disabled={!dirty}
              style={{ alignSelf: 'flex-start' }}
            >
              {m.save}
            </Button>
          </Stack>
        </form>
      </Stack>
    </section>
  );
}

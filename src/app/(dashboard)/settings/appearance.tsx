'use client';
import {
  SegmentedControl,
  Stack,
  Title,
  useMantineColorScheme,
} from '@mantine/core';
import { ru } from '@/config/messages';
export function AppearanceSettings() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <section id="appearance" tabIndex={-1} aria-label={ru.appearance.title}>
      <Stack gap="sm">
        <Title order={2} size="h3">
          {ru.appearance.title}
        </Title>
        <SegmentedControl
          aria-label={ru.appearance.theme}
          value={colorScheme}
          onChange={(value) => {
            if (value === 'light' || value === 'dark' || value === 'auto')
              setColorScheme(value);
          }}
          data={[
            { value: 'light', label: ru.appearance.light },
            { value: 'dark', label: ru.appearance.dark },
            { value: 'auto', label: ru.appearance.system },
          ]}
          styles={{
            label: {
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
          }}
          fullWidth
        />
      </Stack>
    </section>
  );
}

'use client';
import Link from 'next/link';
import { IconChevronRight } from '@tabler/icons-react';
import { NavLink, Stack } from '@mantine/core';
import { PageHeader } from './page-header';
import { AccountControls } from './application-shell-frame';
import { moreSections } from './navigation';
import { ru } from '@/config/messages';
export function MorePage() {
  return (
    <Stack gap="xl" maw={600} mx="auto" w="100%">
      <PageHeader>{ru.mobileNavigation.more}</PageHeader>
      <Stack gap={0}>
        {moreSections.map((section) => {
          const Icon = section.icon;
          return (
            <NavLink
              key={section.href}
              component={Link}
              href={section.href}
              label={section.title}
              leftSection={<Icon size={22} />}
              rightSection={<IconChevronRight size={18} />}
              py="md"
              style={{
                borderBottom: '1px solid var(--mantine-color-default-border)',
              }}
            />
          );
        })}
      </Stack>
      <AccountControls />
    </Stack>
  );
}

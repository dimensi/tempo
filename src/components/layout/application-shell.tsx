'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  AppShell,
  Burger,
  Group,
  Text,
  NavLink,
  ActionIcon,
  Button,
  Stack,
  Badge,
  useMantineColorScheme,
  useComputedColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconSunMoon,
  IconLeaf,
  IconHome,
  IconToolsKitchen2,
  IconRuler,
  IconBarbell,
  IconChartLine,
  IconFileText,
  IconSettings,
} from '@tabler/icons-react';
import { authClient } from '@/lib/auth-client';
import { ru } from '@/config/messages';
const icons = [
  IconHome,
  IconToolsKitchen2,
  IconRuler,
  IconBarbell,
  IconChartLine,
  IconFileText,
  IconSettings,
];
export function ApplicationShell({
  children,
  role,
  demo,
}: {
  children: React.ReactNode;
  role: string;
  demo: boolean;
}) {
  const [opened, { toggle, close }] = useDisclosure();
  const pathname = usePathname();
  const router = useRouter();
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function logout() {
    setBusy(true);
    setError(false);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError(true);
        return;
      }
      router.replace('/login');
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <a className="skip-link" href="#main-content">
        Перейти к содержимому
      </a>
      <AppShell
        header={{ height: 68 }}
        navbar={{
          width: 250,
          breakpoint: 'sm',
          collapsed: { mobile: !opened },
        }}
        padding={{ base: 'md', sm: 'xl' }}
      >
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <Burger
                opened={opened}
                onClick={toggle}
                hiddenFrom="sm"
                size="sm"
                aria-label={ru.navigation}
                aria-expanded={opened}
                style={{ width: 44, height: 44 }}
              />
              <IconLeaf color="var(--mantine-color-teal-6)" aria-hidden />
              <Text fw={700} size="sm">
                {ru.appName}
              </Text>
            </Group>
            <ActionIcon
              variant="default"
              aria-label={ru.theme}
              onClick={() =>
                setColorScheme(scheme === 'dark' ? 'light' : 'dark')
              }
            >
              <IconSunMoon size={20} />
            </ActionIcon>
          </Group>
        </AppShell.Header>
        <AppShell.Navbar p="md">
          <Stack h="100%" justify="space-between">
            <nav aria-label={ru.navigation}>
              {ru.sections.map((section, index) => {
                const Icon = icons[index] ?? IconHome;
                return (
                  <NavLink
                    key={section.href}
                    component={Link}
                    href={section.href}
                    label={section.title}
                    leftSection={<Icon size={20} />}
                    active={pathname === section.href}
                    aria-current={
                      pathname === section.href ? 'page' : undefined
                    }
                    onClick={close}
                    py="sm"
                    mb={4}
                    style={{ borderRadius: 'var(--mantine-radius-md)' }}
                  />
                );
              })}
              {role === 'OWNER' &&
                [
                  { href: '/settings/trainers', title: ru.trainerSettings },
                  { href: '/settings/yazio', title: ru.yazioSettings },
                ].map((section) => (
                  <NavLink
                    key={section.href}
                    component={Link}
                    href={section.href}
                    label={section.title}
                    active={pathname === section.href}
                    aria-current={
                      pathname === section.href ? 'page' : undefined
                    }
                    onClick={close}
                    py="sm"
                    mb={4}
                  />
                ))}
            </nav>
            <Stack gap="xs">
              <Badge variant="light">
                {role === 'OWNER' ? 'Владелец' : 'Тренер'}
              </Badge>
              {demo && <Badge color="orange">Демо-режим</Badge>}
              {error && (
                <Text c="red" role="alert" size="sm">
                  Не удалось выйти. Повторите попытку.
                </Text>
              )}
              <Button variant="default" loading={busy} onClick={logout}>
                {ru.logout}
              </Button>
            </Stack>
          </Stack>
        </AppShell.Navbar>
        <AppShell.Main id="main-content">{children}</AppShell.Main>
      </AppShell>
    </>
  );
}

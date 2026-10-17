'use client';
import { useState, type ElementType } from 'react';
import {
  AppShell,
  Image,
  Burger,
  Group,
  Text,
  NavLink,
  ActionIcon,
  Button,
  Stack,
  Badge,
  UnstyledButton,
  useMantineColorScheme,
  useComputedColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconSunMoon,
  IconHome,
  IconToolsKitchen2,
  IconRuler,
  IconBarbell,
  IconChartLine,
  IconFileText,
  IconSettings,
} from '@tabler/icons-react';
import { offlineDeviceMessages } from '@/lib/offline-device';
import { ru } from '@/config/messages';
import { PageHeaderTarget, PageActionsTarget } from './page-header';
const icons = [
  IconHome,
  IconToolsKitchen2,
  IconRuler,
  IconBarbell,
  IconChartLine,
  IconFileText,
  IconSettings,
];
export function ApplicationShellFrame({
  children,
  role,
  demo,
  pathname,
  onLogout,
  logoutDisabled = false,
  brandSrc = '/branding/mark.svg',
  linkComponent = 'a',
  cleanupError = false,
}: {
  children: React.ReactNode;
  role: string;
  demo: boolean;
  pathname: string;
  onLogout?: () => Promise<void>;
  logoutDisabled?: boolean;
  brandSrc?: string;
  linkComponent?: ElementType;
  cleanupError?: boolean;
}) {
  const [opened, { toggle, close }] = useDisclosure();
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [headerTarget, setHeaderTarget] = useState<HTMLDivElement | null>(null);
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(
    null,
  );
  async function logout() {
    if (!onLogout) return;
    setBusy(true);
    setError(false);
    try {
      await onLogout();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <PageHeaderTarget.Provider value={headerTarget}>
      <PageActionsTarget.Provider value={actionsTarget}>
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
            <Group
              h="100%"
              px="md"
              gap={4}
              justify="space-between"
              wrap="nowrap"
            >
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
              </Group>
              <div ref={setHeaderTarget} style={{ flex: 1, minWidth: 0 }} />
              <Group ref={setActionsTarget} gap={4} wrap="nowrap" />
            </Group>
          </AppShell.Header>
          <AppShell.Navbar p="md">
            <Stack h="100%" gap="md">
              <Group gap="sm">
                <UnstyledButton
                  component={linkComponent as 'a'}
                  href="/"
                  onClick={close}
                  mih={44}
                >
                  <Group gap="sm" wrap="nowrap">
                    <Image src={brandSrc} w={28} h={28} alt="" />
                    <Text fw={700}>{ru.appName}</Text>
                  </Group>
                </UnstyledButton>
                <ActionIcon
                  ml="auto"
                  size={44}
                  variant="subtle"
                  aria-label={ru.theme}
                  onClick={() =>
                    setColorScheme(scheme === 'dark' ? 'light' : 'dark')
                  }
                >
                  <IconSunMoon size={20} />
                </ActionIcon>
              </Group>
              <nav aria-label={ru.navigation} style={{ flex: 1 }}>
                {ru.sections.map((section, index) => {
                  if (role === 'TRAINER' && section.href === '/settings')
                    return null;
                  const Icon = icons[index] ?? IconHome;
                  return (
                    <div key={section.href}>
                      <NavLink
                        key={section.href}
                        component={linkComponent as 'a'}
                        href={section.href}
                        label={section.title}
                        leftSection={<Icon size={20} />}
                        active={
                          pathname === section.href ||
                          (section.href !== '/' &&
                            pathname.startsWith(`${section.href}/`))
                        }
                        aria-current={
                          pathname === section.href ? 'page' : undefined
                        }
                        onClick={close}
                        py="sm"
                        mb={4}
                        style={{ borderRadius: 'var(--mantine-radius-md)' }}
                      />
                    </div>
                  );
                })}
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
                {cleanupError && (
                  <Text role="status" size="sm">
                    {offlineDeviceMessages.cleanupWarning}
                  </Text>
                )}
                <Button
                  variant="default"
                  loading={busy}
                  disabled={logoutDisabled || !onLogout}
                  onClick={logout}
                >
                  {ru.logout}
                </Button>
              </Stack>
            </Stack>
          </AppShell.Navbar>
          <AppShell.Main component="div" id="main-content">
            {children}
          </AppShell.Main>
        </AppShell>
      </PageActionsTarget.Provider>
    </PageHeaderTarget.Provider>
  );
}

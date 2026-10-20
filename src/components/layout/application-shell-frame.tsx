'use client';
import { createContext, useContext, useState, type ElementType } from 'react';
import {
  AppShell,
  Image,
  Group,
  Text,
  NavLink,
  Button,
  Stack,
  Badge,
  UnstyledButton,
} from '@mantine/core';
import {
  sections,
  mobileSections,
  isSectionActive,
  exerciseCatalogSection,
} from './navigation';
import classes from './application-shell.module.css';
import { offlineDeviceMessages } from '@/lib/offline-device';
import { ru } from '@/config/messages';
import { PageHeaderTarget, PageActionsTarget } from './page-header';
const AccountControlsContext = createContext<React.ReactNode>(null);
export function AccountControls() {
  return useContext(AccountControlsContext);
}
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
  const roleBadge = (
    <Badge variant="light" size="xs">
      {role === 'OWNER' ? 'Владелец' : 'Тренер'}
    </Badge>
  );
  const accountControls = (
    <Stack gap="xs">
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
  );
  return (
    <AccountControlsContext.Provider value={accountControls}>
      <PageHeaderTarget.Provider value={headerTarget}>
        <PageActionsTarget.Provider value={actionsTarget}>
          <a className="skip-link" href="#main-content">
            Перейти к содержимому
          </a>
          <AppShell
            header={{ height: 'var(--tempo-header-height)' }}
            navbar={{
              width: 250,
              breakpoint: 'sm',
              collapsed: { mobile: true },
            }}
            padding={{ base: 'md', sm: 'xl' }}
          >
            <AppShell.Header className={classes.header}>
              <Group
                h="100%"
                px="md"
                gap={4}
                justify="space-between"
                wrap="nowrap"
              >
                <UnstyledButton
                  component={linkComponent as 'a'}
                  href="/"
                  className={classes.mobileBrand}
                >
                  <Image src={brandSrc} w={28} h={28} alt="" />
                  <Stack gap={2} align="flex-start">
                    <Text fw={700} lh={1.2}>
                      {ru.appName}
                    </Text>
                    {roleBadge}
                  </Stack>
                </UnstyledButton>
                <div ref={setHeaderTarget} className={classes.desktopTitle} />
                <Group visibleFrom="sm">{roleBadge}</Group>
                <Group ref={setActionsTarget} gap={4} wrap="nowrap" />
              </Group>
            </AppShell.Header>
            <AppShell.Navbar
              p="md"
              pl="calc(var(--mantine-spacing-md) + var(--tempo-safe-left))"
              className={classes.sidebar}
            >
              <Stack h="100%" gap="md">
                <Group gap="sm">
                  <UnstyledButton
                    component={linkComponent as 'a'}
                    href="/"

                    mih={44}
                  >
                    <Group gap="sm" wrap="nowrap">
                      <Image src={brandSrc} w={28} h={28} alt="" />
                      <Text fw={700}>{ru.appName}</Text>
                    </Group>
                  </UnstyledButton>
                </Group>
                <nav aria-label={ru.navigation} style={{ flex: 1 }}>
                  {sections.map((section) => {
                    const Icon = section.icon;
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

                          py="sm"
                          mb={4}
                          style={{ borderRadius: 'var(--mantine-radius-md)' }}
                        />
                        {section.href === '/workouts' && (
                          <NavLink
                            component={linkComponent as 'a'}
                            href={exerciseCatalogSection.href}
                            label={exerciseCatalogSection.title}
                            leftSection={
                              <exerciseCatalogSection.icon size={18} />
                            }
                            active={
                              pathname === exerciseCatalogSection.href ||
                              pathname.startsWith(
                                `${exerciseCatalogSection.href}/`,
                              )
                            }
                            aria-current={
                              pathname === exerciseCatalogSection.href
                                ? 'page'
                                : undefined
                            }
                            pl="xl"
                            mih={44}
                            mb={4}
                            style={{ borderRadius: 'var(--mantine-radius-md)' }}
                          />
                        )}
                      </div>
                    );
                  })}
                </nav>
                {accountControls}
              </Stack>
            </AppShell.Navbar>
            <AppShell.Main
              component="div"
              id="main-content"
              className={classes.main}
            >
              {children}
            </AppShell.Main>
            <nav className={classes.mobileNav} aria-label={ru.navigation}>
              {mobileSections.map((section) => {
                const Icon = section.icon;
                const active = isSectionActive(pathname, section.href);
                return (
                  <UnstyledButton
                    key={section.href}
                    component={linkComponent as 'a'}
                    href={section.href}
                    className={classes.tab}
                    data-active={active || undefined}
                    aria-current={
                      active
                        ? pathname === section.href
                          ? 'page'
                          : 'location'
                        : undefined
                    }
                  >
                    <Icon size={22} aria-hidden />
                    <span>{section.title}</span>
                  </UnstyledButton>
                );
              })}
            </nav>
          </AppShell>
        </PageActionsTarget.Provider>
      </PageHeaderTarget.Provider>
    </AccountControlsContext.Provider>
  );
}

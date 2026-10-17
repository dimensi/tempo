'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import classes from './page-header.module.css';

export const PageHeaderTarget = createContext<HTMLElement | null>(null);
export const PageActionsTarget = createContext<HTMLElement | null>(null);

export function PageActions({ children }: { children: ReactNode }) {
  const target = useContext(PageActionsTarget);
  return target ? createPortal(children, target) : children;
}

/** The page owns its title and controls; the shell owns their placement. */
export function PageHeader({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  const desktopTarget = useContext(PageHeaderTarget);
  const desktop = useMediaQuery('(min-width: 48em)');
  const target = desktop ? desktopTarget : null;
  const title = (
    <Title order={1} size="h3" className={classes.title}>
      {children}
    </Title>
  );
  return (
    <>
      {target ? createPortal(title, target) : title}
      {actions && <PageActions>{actions}</PageActions>}
    </>
  );
}

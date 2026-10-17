'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Group, Title } from '@mantine/core';
import Link from 'next/link';

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
  const target = useContext(PageHeaderTarget);
  const content = (
    <Group justify="space-between" wrap="nowrap" w="100%" gap="xs">
      <Title
        order={1}
        size="h3"
        style={{
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        <Link href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
          {children}
        </Link>
      </Title>
      {actions && (
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          {actions}
        </Group>
      )}
    </Group>
  );
  return target ? createPortal(content, target) : content;
}

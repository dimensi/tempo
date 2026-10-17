'use client';

import type { ReactNode } from 'react';
import { Drawer } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';

// Drawer's default scroll wrapper fixes its height to the viewport. Content-fit
// sheets instead let Drawer.Content own the height limit and native scrolling.
function SheetScroll({ children }: { children?: ReactNode }) {
  return <div>{children}</div>;
}

export function BottomSheet({
  opened,
  onClose,
  title,
  closeLabel,
  children,
}: {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={title}
      position="bottom"
      padding="md"
      scrollAreaComponent={SheetScroll}
      closeButtonProps={{ 'aria-label': closeLabel, size: 44 }}
      transitionProps={{ duration: reducedMotion ? 0 : 180 }}
      styles={{
        content: {
          height: 'auto',
          maxHeight: '85dvh',
          overflowY: 'auto',
          borderRadius: '20px 20px 0 0',
        },
        title: { fontSize: 18, fontWeight: 600, lineHeight: 1.4 },
        body: { paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' },
      }}
    >
      {children}
    </Drawer>
  );
}

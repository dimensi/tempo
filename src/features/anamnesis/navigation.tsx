'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button, Group } from '@mantine/core';
import { anamnesisMessages as m } from './messages';

export function AnamnesisUploadLink() {
  return (
    <Button component={Link} href="/anamnesis/documents" mih={44}>
      {m.documents.upload}
    </Button>
  );
}

export function AnamnesisNavigation({ owner }: { owner: boolean }) {
  const pathname = usePathname();
  const items = [
    { href: '/anamnesis', label: m.overview.title },
    { href: '/anamnesis/documents', label: m.documents.title },
    { href: '/anamnesis/markers', label: m.markers.title },
    { href: '/anamnesis/imports', label: m.imports.title },
    { href: '/anamnesis/reports', label: m.reports.title },
    ...(owner
      ? [
          { href: '/anamnesis/reviews', label: m.reviews.title },
          { href: '/anamnesis/access', label: m.access.title },
        ]
      : []),
  ];

  return (
    <Group component="nav" aria-label={m.title} gap="xs">
      {items.map(({ href, label }) => {
        const active =
          pathname === href ||
          (href !== '/anamnesis' && pathname.startsWith(`${href}/`));
        return (
          <Button
            key={href}
            component={Link}
            href={href}
            variant={active ? 'light' : 'subtle'}
            aria-current={active ? 'page' : undefined}
            mih={44}
          >
            {label}
          </Button>
        );
      })}
    </Group>
  );
}

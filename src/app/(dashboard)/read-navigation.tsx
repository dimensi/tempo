'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { installReadNavigation } from '@/components/shared/read-link';
import { interceptOfflineLinks } from '@/lib/offline-routing';
export function ReadNavigation() {
  const router = useRouter();
  useEffect(() => installReadNavigation((href) => router.push(href)), [router]);
  useEffect(() => interceptOfflineLinks((href) => router.push(href)), [router]);
  return null;
}

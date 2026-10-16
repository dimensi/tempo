'use client';
import { ReadLink as Link } from '@/components/shared/read-link';
import { Overview as OverviewContent } from './Overview';
export function Overview() {
  return <OverviewContent linkComponent={Link} />;
}

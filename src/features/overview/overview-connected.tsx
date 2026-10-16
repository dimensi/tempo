'use client';
import Link from 'next/link';
import { Overview as OverviewContent } from './Overview';
export function Overview() {
  return <OverviewContent linkComponent={Link} />;
}

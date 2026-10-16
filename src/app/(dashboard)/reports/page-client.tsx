'use client';
import { ReportForm } from '@/features/reports';
import { useReadContext } from '@/lib/client-session';
export function ReportsPage() {
  const context = useReadContext();
  return <ReportForm ownerId={context.ownerId} />;
}

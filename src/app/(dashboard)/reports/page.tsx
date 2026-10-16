'use client';
import { ReportForm } from '@/features/reports';
import { useReadContext } from '@/lib/client-session';
export default function Page() {
  const context = useReadContext();
  return <ReportForm ownerId={context.ownerId} />;
}

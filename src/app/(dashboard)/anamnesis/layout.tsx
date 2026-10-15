import { requireSession } from '@/server/auth/guards';
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
  return children;
}

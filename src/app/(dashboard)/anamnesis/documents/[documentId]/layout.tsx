import type { ReactNode } from 'react';
import { anamnesisMessages as m } from '@/config/anamnesis-messages';
export const metadata = { title: m.documents.title };
export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

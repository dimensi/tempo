import { anamnesisMessages as m } from '@/config/anamnesis-messages';
import { DocumentPage } from './page-client';
export function generateMetadata() {
  return { title: m.documents.title };
}
export default async function Page({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const value = await params;
  return <DocumentPage documentId={value.documentId} />;
}

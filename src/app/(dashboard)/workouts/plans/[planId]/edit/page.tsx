import { EditorPage } from '../../../editor-page';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <EditorPage planId={(await params).planId} query={await searchParams} />
  );
}

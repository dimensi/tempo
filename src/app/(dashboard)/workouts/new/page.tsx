import { EditorPage } from '../editor-page';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <EditorPage query={await searchParams} />;
}

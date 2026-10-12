import { DetailPage } from '../../detail-page';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const value = await params;
  return (
    <DetailPage
      resource={{ kind: 'link', id: value.id }}
      query={await searchParams}
    />
  );
}

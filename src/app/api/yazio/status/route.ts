import { authorize } from '@/server/auth/guards';
import { readServerEnv } from '@/server/env';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const access = await authorize(request.headers, 'yazio:manage');
  if (!access.ok)
    return Response.json(
      { error: 'Доступ запрещён' },
      { status: access.status },
    );
  const env = readServerEnv();
  return Response.json(
    { configured: Boolean(env.YAZIO_TOKEN_FILE) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

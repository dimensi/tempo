import {
  getOfflineController,
  type OfflineController,
} from '@/lib/offline-controller';
// Identity reachability alone cannot prove the failing page is available.
// Recovery is one explicit attempt, never a reaction to cache status polling.
export async function recoverOnlineRoute(
  href: string,
  controller: OfflineController = getOfflineController(),
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const target = new URL(href);
  if (target.pathname === '/offline/index.html') target.pathname = '/';
  await controller.activate(true, true);
  try {
    const response = await fetcher(target.href, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(10000),
    });
    if (
      response.ok &&
      response.headers.get('content-type')?.includes('text/html')
    ) {
      await response.body?.cancel();
      return true;
    }
    await response.body?.cancel();
  } catch {
    /* Keep the current saved route available. */
  }
  await controller.activate(false, true);
  return false;
}

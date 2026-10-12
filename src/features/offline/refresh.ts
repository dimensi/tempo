import { concealOfflineContent } from '@/lib/offline-device';
import type { OfflineController } from './controller';
export function attachOfflineRefresh(controller: OfflineController) {
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    concealOfflineContent();
    clearTimeout(scheduled);
    scheduled = setTimeout(
      () => void controller.activate(navigator.onLine, true),
      200,
    );
  };
  const visible = () => {
    if (document.visibilityState === 'visible') refresh();
    else hide();
  };
  const hide = () => {
    concealOfflineContent();
    controller.invalidate();
    clearTimeout(scheduled);
  };
  const offline = () => {
    hide();
    refresh();
  };
  refresh();
  window.addEventListener('online', refresh);
  window.addEventListener('offline', offline);
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  window.addEventListener('pagehide', hide);
  document.addEventListener('visibilitychange', visible);
  const interval = setInterval(() => {
    if (document.visibilityState === 'visible')
      void controller.activate(navigator.onLine);
  }, 60000);
  return () => {
    clearTimeout(scheduled);
    clearInterval(interval);
    window.removeEventListener('online', refresh);
    window.removeEventListener('offline', offline);
    window.removeEventListener('focus', refresh);
    window.removeEventListener('pageshow', refresh);
    window.removeEventListener('pagehide', hide);
    document.removeEventListener('visibilitychange', visible);
  };
}

import { concealOfflineContent } from '@/lib/offline-device';
import type { OfflineController } from '@/lib/offline-controller';
export function attachOfflineRefresh(controller: OfflineController) {
  let sourceTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let lastSourceSave = 0;
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
  const sourceLoaded = () => {
    clearTimeout(sourceTimer);
    const save = () => {
      if (
        disposed ||
        !navigator.onLine ||
        document.visibilityState !== 'visible'
      )
        return;
      const state = controller.getSnapshot();
      if (state.status === 'checking' || state.status === 'saving') {
        sourceTimer = setTimeout(save, 1500);
        return;
      }
      const delay = 5000 - (Date.now() - lastSourceSave);
      if (delay > 0) {
        sourceTimer = setTimeout(save, delay);
        return;
      }
      lastSourceSave = Date.now();
      void controller.save();
    };
    sourceTimer = setTimeout(save, 750);
  };
  refresh();
  window.addEventListener('tempo:offline-source-loaded', sourceLoaded);
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
    disposed = true;
    clearTimeout(sourceTimer);
    window.removeEventListener('tempo:offline-source-loaded', sourceLoaded);
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

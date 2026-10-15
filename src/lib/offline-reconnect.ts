import { getOfflineController } from './offline-controller';
import { syncDeviceWrites } from './offline-write-client';
import { prepareMedicalReads, revalidateVisibleReads } from './client-read';
let flight: Promise<void> | undefined;
/** Connection recovery never owns navigation or form state. */
export function reconnectReads() {
  if (flight) return flight;
  flight = (async () => {
    const controller = getOfflineController();
    await controller.activate(true, true);
    if (controller.getSnapshot().status === 'disabled')
      await controller.activate(true, true);
    if (controller.getSnapshot().status !== 'ready') return;
    if (controller.getSnapshot().bundle?.snapshot.role === 'OWNER')
      await syncDeviceWrites().catch(() => {});
    await controller.save();
    if (controller.getSnapshot().status !== 'ready') return;
    await prepareMedicalReads(true);
    revalidateVisibleReads();
  })().finally(() => {
    flight = undefined;
  });
  return flight;
}

import { productionConfig } from '../ci/production-config';
export default productionConfig('offline', [
  'e2e/offline.spec.ts',
  'offline/service-worker.spec.ts',
  'offline/application.spec.ts',
  'smoke/slow-install.spec.ts',
]);

import { productionConfig } from '../ci/production-config';
export default productionConfig('transformmate', [
  'transformmate-sync/*.e2e.ts',
]);

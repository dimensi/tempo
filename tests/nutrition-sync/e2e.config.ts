import { productionConfig } from '../ci/production-config';
export default productionConfig(
  'nutrition',
  ['nutrition-sync/*.e2e.ts'],
  false,
);

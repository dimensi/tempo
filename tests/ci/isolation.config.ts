import { productionConfig } from './production-config';
export default productionConfig('isolation', ['ci/isolation.spec.ts'], false);

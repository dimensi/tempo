import { productionConfig } from '../ci/production-config';
const config = {
  ...productionConfig('smoke', [
    'smoke/*.spec.ts',
    'e2e/offline.spec.ts',
    'offline/application.spec.ts',
  ]),
  grep: /production real login|two tabs hide private DOM|refill holds a shared lock/,
};
export default config;
